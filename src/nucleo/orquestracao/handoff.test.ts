import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErroMcp } from "../mcp/erros";
import type { PedidoHandoff } from "../mcp/portas";
import { PRODUTO } from "../produto";
import { criarServicoHandoff, type PersistenciaHandoff } from "./handoff";
import { criarFilaWake } from "./wake";

function montar(opcoes: { falhaNoBanco?: boolean } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "hof-"));
  const log: string[] = [];
  const persistencia: PersistenciaHandoff = {
    async gravar(d) {
      log.push("banco");
      if (opcoes.falhaNoBanco) throw new ErroMcp("not_found", "task inexistente");
      return { handoff_id: "hof_1", para_pane_id: "pane_p", task_ref: "T-01.01" };
    },
    async doPane() { return null; },
    async temRevisorOk() { return false; },
  };
  const enviados: string[] = [];
  const fila = criarFilaWake({ enviar: async (_p, t) => { log.push("wake"); enviados.push(t); return true; }, estado: () => "pronto" });
  const originalEnfileirar = fila.enfileirar.bind(fila);
  fila.enfileirar = (i) => { log.push("wake_enfileirado"); originalEnfileirar(i); };
  const fechamentos: string[] = [];
  const agendados: Array<() => void> = [];
  const servico = criarServicoHandoff({
    raiz: async () => raiz,
    persistencia,
    fila,
    fecharPane: async (p, motivo) => { fechamentos.push(`${p}:${motivo}`); },
    agendar: (fn) => agendados.push(fn),
  });
  const pedido = (p: Partial<PedidoHandoff> = {}): PedidoHandoff => ({
    workspace_id: "ws_1", mission_id: "mis_1", pane_id: "w1", papel: "executor", task_id: "tsk_1", resumo: "feito", relatorio_path: "rel/r.md", artefatos: [], status: "ok", ...p,
  });
  const gravarRelatorio = (rel: string, conteudo = "# ok\n") => { mkdirSync(join(raiz, rel, ".."), { recursive: true }); writeFileSync(join(raiz, rel), conteudo); };
  return { servico, raiz, log, enviados, fila, fechamentos, agendados, pedido, gravarRelatorio };
}

describe("handoff: relatório → banco → wake", () => {
  it("ordem obrigatória quando tudo dá certo; Pane do worker é fechado depois", async () => {
    const t = montar();
    t.gravarRelatorio("rel/r.md");
    const r = await t.servico.registrar(t.pedido());
    expect(r).toEqual({ handoff_id: "hof_1" });
    await t.fila.ociosa();
    expect(t.log).toEqual(["banco", "wake_enfileirado", "wake"]);
    expect(t.enviados[0]).toContain("T-01.01");
    expect(t.fechamentos).toEqual([]); // fechamento é agendado, não síncrono
    t.agendados[0]?.();
    await Promise.resolve();
    expect(t.fechamentos).toEqual(["w1:handoff_done"]);
  });

  it.each([
    ["ausente", undefined],
    ["vazio", "   \n"],
  ])("relatório %s → handoff_missing; nada de banco nem wake", async (_n, conteudo) => {
    const t = montar();
    if (conteudo !== undefined) t.gravarRelatorio("rel/r.md", conteudo);
    await expect(t.servico.registrar(t.pedido())).rejects.toMatchObject({ code: "rule_violation", subcode: "handoff_missing" });
    await t.fila.ociosa();
    expect(t.log).toEqual([]);
    expect(t.agendados).toHaveLength(0);
  });

  it("relatório ilegível (diretório) ou fora da raiz (traversal/symlink) → handoff_missing", async () => {
    const t = montar();
    mkdirSync(join(t.raiz, "pasta"));
    const fora = mkdtempSync(join(tmpdir(), "fora-"));
    writeFileSync(join(fora, "x.md"), "conteudo");
    symlinkSync(fora, join(t.raiz, "atalho"));
    for (const caminho of ["pasta", "../x.md", "atalho/x.md", "/etc/hosts", "a\0b"]) {
      await expect(t.servico.registrar(t.pedido({ relatorio_path: caminho }))).rejects.toMatchObject({ subcode: "handoff_missing" });
    }
    expect(t.log).toEqual([]);
  });

  it("AUD-22: só relatório Markdown de tamanho razoável vale (nada de arquivo qualquer do worktree nem gigante)", async () => {
    const t = montar();
    writeFileSync(join(t.raiz, "segredo.txt"), "conteudo");
    mkdirSync(join(t.raiz, "rel"), { recursive: true });
    writeFileSync(join(t.raiz, "rel", "grande.md"), "x".repeat(2 * 1024 * 1024 + 1));
    for (const caminho of ["segredo.txt", "rel/grande.md"]) {
      await expect(t.servico.registrar(t.pedido({ relatorio_path: caminho }))).rejects.toMatchObject({ subcode: "handoff_missing" });
    }
    expect(t.log).toEqual([]);
  });

  it("falha no banco: sem wake, sem fechar o Pane", async () => {
    const t = montar({ falhaNoBanco: true });
    t.gravarRelatorio("rel/r.md");
    await expect(t.servico.registrar(t.pedido())).rejects.toMatchObject({ code: "not_found" });
    await t.fila.ociosa();
    expect(t.log).toEqual(["banco"]);
    expect(t.enviados).toEqual([]);
    expect(t.agendados).toHaveLength(0);
  });

  it("resumo > 400 → summary_too_long antes de qualquer etapa", async () => {
    const t = montar();
    t.gravarRelatorio("rel/r.md");
    await expect(t.servico.registrar(t.pedido({ resumo: "x".repeat(401) }))).rejects.toMatchObject({ code: "invalid_argument", subcode: "summary_too_long" });
    expect(t.log).toEqual([]);
  });

  it("piloto/modo livre (papel não-worker) não tem Pane fechado pelo sistema", async () => {
    const t = montar();
    t.gravarRelatorio("rel/r.md");
    await t.servico.registrar(t.pedido({ papel: "nenhum" }));
    expect(t.agendados).toHaveLength(0);
  });

  it("registrarFalha grava relatório-stub, persiste como falhou e acorda o piloto", async () => {
    const t = montar();
    const r = await t.servico.registrarFalha({ workspace_id: "ws_1", mission_id: "mis_1", pane_id: "w1", papel: "executor", task_id: "tsk_1", task_ref: "T-01.01", motivo: "3 tentativas sem handoff" });
    expect(r.handoff_id).toBe("hof_1");
    await t.fila.ociosa();
    expect(t.log).toEqual(["banco", "wake_enfileirado", "wake"]);
    expect(t.enviados[0]).toContain("falhou");
    expect(await t.servico.relatorioLegivel("ws_1", "mis_1", join(PRODUTO.pastaNoProjeto, "missoes", "mis_1", "relatorios", "T-01.01.md"))).toBe(true);
    t.agendados[0]?.();
    await Promise.resolve();
    expect(t.fechamentos).toEqual(["w1:handoff_failed"]);
  });

  it("relatorioLegivel: null/ausente/vazio = false", async () => {
    const t = montar();
    t.gravarRelatorio("ok.md");
    t.gravarRelatorio("vazio.md", "");
    expect(await t.servico.relatorioLegivel("ws_1", "mis_1", "ok.md")).toBe(true);
    expect(await t.servico.relatorioLegivel("ws_1", "mis_1", "vazio.md")).toBe(false);
    expect(await t.servico.relatorioLegivel("ws_1", "mis_1", "nada.md")).toBe(false);
    expect(await t.servico.relatorioLegivel("ws_1", "mis_1", null)).toBe(false);
  });
});
