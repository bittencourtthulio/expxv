// E2E do ciclo de vida do painel do worker (D-520) no Electron real, com a CLI falsa `cli-orq.mjs` (MCP de verdade). Prova: (1) três workers em paralelo concluem e o app fecha os painéis SEM
// deixar "Sessão encerrada" pendurada nem processo vivo, e o orquestrador ainda lê estado, saída e relatório; (2) worker que morre com erro (ninguém pediu) FICA visível e o orquestrador é avisado;
// (3) `pane_close` do orquestrador tira o painel da grade na hora e encerra o processo. Escrito para rodar com `npm run build` pronto (`npm run test:e2e`); NÃO rodar com o `npm run dev` do dono ativo.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, esperar, processosDeWorker, type AmbienteOrq, type JanelaOrq } from "./fixtures/mcp/ambiente-orq";

let amb: AmbienteOrq;
beforeAll(async () => { amb = await criarAmbienteOrq(); }, 120_000);
afterEach(async () => { await amb.abortarCriadas(); });
afterAll(async () => { await amb?.fechar(); });

/** Chama uma tool MCP com a credencial do PILOTO (a mesma que a CLI dele leria de `mcp.json`, 0600). */
async function comoPiloto(missaoId: string, tool: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; dados: any }> {
  const d = await amb.detalhe(missaoId);
  const piloto = d!.panes.find((p) => p.eh_piloto)!;
  const cfg = JSON.parse(readFileSync(join(amb.app.pastaDados, "panes", piloto.id, "mcp.json"), "utf8")) as { mcpServers: Record<string, { url: string; headers: { Authorization: string } }> };
  const s = Object.values(cfg.mcpServers)[0]!;
  let id = 0;
  const rpc = async (metodo: string, params: unknown): Promise<any> => {
    const r = await fetch(s.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: s.headers.Authorization, "mcp-protocol-version": "2025-03-26" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: metodo, params }) });
    const t = await r.text();
    return t.trim().startsWith("{") ? JSON.parse(t) : JSON.parse(/data: (.*)/.exec(t)?.[1] ?? "{}");
  };
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  const r = await rpc("tools/call", { name: tool, arguments: args });
  const texto = r.result?.content?.[0]?.text;
  return { ok: r.result?.isError !== true, dados: texto === undefined ? null : JSON.parse(texto) };
}
const sessoes = (): Promise<Array<{ estado: string; sessao_id: string }>> => amb.app.pagina.evaluate(() => (window as unknown as JanelaOrq).ade.terminais.listarSessoes());

describe("ciclo de vida do painel do worker no Electron real", () => {
  it("três workers em paralelo concluem: painéis fecham sozinhos, nada de 'Sessão encerrada' pendurada nem processo órfão, e estado/relatório continuam legíveis", async () => {
    const missao = await amb.iniciarMissao("Três em paralelo", {
      esperar_wake: true,
      chamadas: [1, 2, 3].map((n) => amb.spawnWorker({ worker: "handoff", resumo: `agente ${n}` })),
    });
    await esperar(async () => (await amb.eventos(missao.id)).filter((l) => l.evento === "handoff" && l["ok"] === true).length === 3, 60_000);
    // cada um continua vivo até entregar; depois o app fecha o painel (3 s) e nada fica na lista de sessões
    await esperar(async () => (await amb.detalhe(missao.id))?.panes.filter((p) => !p.eh_piloto).every((p) => p.estado === "encerrado"), 30_000);
    await esperar(() => processosDeWorker() === 0, 15_000);
    await esperar(async () => (await sessoes()).every((s) => s.estado === "executando"), 15_000); // só o piloto: nenhuma sessão "encerrada"/"erro" pendurada
    expect((await sessoes()).filter((s) => s.estado === "executando")).toHaveLength(1);

    const lista = await comoPiloto(missao.id, "pane_list");
    const fechados = (lista.dados as Array<Record<string, unknown>>).filter((p) => p["role"] === "executor");
    expect(fechados).toHaveLength(3);
    expect(fechados.every((p) => p["state"] === "done" && p["closed_by"] === "auto")).toBe(true);
    for (const f of fechados) {
      const h = await comoPiloto(missao.id, "handoff_read", { pane_id: f["pane_id"] });
      expect(h.ok).toBe(true);
      expect(h.dados.report).toContain("Resultado: agente");
      const lido = await comoPiloto(missao.id, "pane_read", { pane_id: f["pane_id"] });
      expect(lido.dados.state).toBe("done");
    }
  }, 120_000);

  it("TESTE A do coordenador: 3 workers respondem uma linha SEM nenhum pane_close do orquestrador — viva depois do handoff, entrega e sai, só sai: fecham sozinhos e a grade volta ao orquestrador", async () => {
    const missao = await amb.iniciarMissao("Teste A", {
      esperar_wake: true,
      chamadas: [
        amb.spawnWorker({ worker: "handoff-vivo", resumo: "viva" }),
        amb.spawnWorker({ worker: "handoff", resumo: "entrega e sai" }),
        amb.spawnWorker({ worker: "sair" }),
      ],
    });
    await esperar(async () => (await amb.eventos(missao.id)).filter((l) => l.evento === "handoff" && l["ok"] === true).length === 2, 60_000);
    // o app fecha os três (a viva é encerrada por SIGINT→SIGTERM→SIGKILL depois do prazo, sem 143): nenhum processo, nenhuma sessão pendurada
    await esperar(async () => (await amb.detalhe(missao.id))?.panes.filter((p) => !p.eh_piloto).length === 3 && (await amb.detalhe(missao.id))?.panes.filter((p) => !p.eh_piloto).every((p) => p.estado === "encerrado"), 40_000);
    await esperar(() => processosDeWorker() === 0, 20_000);
    await esperar(async () => (await sessoes()).every((s) => s.estado === "executando"), 20_000);
    expect((await sessoes()).filter((s) => s.estado === "executando")).toHaveLength(1); // a grade volta ao orquestrador
    // o orquestrador (fake) nunca chamou pane_close
    expect((await amb.chamadasDoPiloto(missao.id)).filter((c) => c["tool"] === "pane_close")).toEqual([]);
    const d = (await amb.detalhe(missao.id))!;
    expect(d.panes.filter((p) => !p.eh_piloto).every((p) => p.encerrado_motivo !== "pilot_request")).toBe(true);
    const fechados = ((await comoPiloto(missao.id, "pane_list")).dados as Array<Record<string, unknown>>).filter((p) => p["role"] === "executor");
    expect(fechados).toHaveLength(3);
    expect(fechados.every((p) => p["state"] === "done" && p["closed_by"] === "auto")).toBe(true);
  }, 150_000);

  it("worker que MORRE com erro sem ninguém pedir: o painel FICA (sessão em erro), o orquestrador é avisado e `pane_list` traz `failed` com o final da saída", async () => {
    const missao = await amb.iniciarMissao("Falha que ninguém pediu", {
      esperar_wake: true,
      chamadas: [amb.spawnWorker({ worker: "falhar", codigo: 2 })],
    });
    const wake = await esperar(async () => (await amb.eventos(missao.id)).find((l) => l.evento === "wake"), 40_000);
    expect(String(wake["texto"])).toMatch(/\(falhou\).*código 2/);
    const d = (await amb.detalhe(missao.id))!;
    const worker = d.panes.find((p) => !p.eh_piloto)!;
    expect(worker.estado).toBe("encerrado");
    // o painel continua na grade: a sessão fica como `erro` até o dono fechar (ou 60 s sem interação)
    const viva = await esperar(async () => (await sessoes()).find((s) => s.sessao_id === worker.sessao_pty_id), 10_000);
    expect(viva.estado).toBe("erro");
    const item = ((await comoPiloto(missao.id, "pane_list")).dados as Array<Record<string, any>>).find((p) => p["pane_id"] === worker.id)!;
    expect(item).toMatchObject({ state: "failed", closed_by: "error", exit_code: 2 });
    expect(String(item["last_output"])).toContain("ECONNRESET");
    // o dono fecha: some da lista de sessões
    await amb.app.pagina.evaluate((s) => (window as unknown as JanelaOrq).ade.terminais.descartar(s), worker.sessao_pty_id as string);
    await esperar(async () => !(await sessoes()).some((s) => s.sessao_id === worker.sessao_pty_id), 10_000);
  }, 120_000);

  it("`pane_close` do orquestrador: o painel sai da grade NA HORA, o processo termina (SIGINT→SIGTERM→SIGKILL) e a cauda continua legível (`closed_by: orchestrator`)", async () => {
    const missao = await amb.iniciarMissao("Fechar antes", { chamadas: [amb.spawnWorker({ worker: "ocioso" })] });
    const worker = await esperar(async () => (await amb.detalhe(missao.id))?.panes.find((p) => !p.eh_piloto && p.estado !== "encerrado"), 40_000);
    await esperar(() => processosDeWorker() === 1, 15_000);
    const r = await comoPiloto(missao.id, "pane_close", { pane_id: worker.id });
    expect(r.dados).toEqual({ ok: true });
    await esperar(async () => !(await sessoes()).some((s) => s.sessao_id === worker.sessao_pty_id), 5_000);
    await esperar(() => processosDeWorker() === 0, 15_000);
    const lido = await comoPiloto(missao.id, "pane_read", { pane_id: worker.id });
    expect(lido.dados).toMatchObject({ state: "closed", closed_by: "orchestrator" });
    const naoDono = await comoPiloto(missao.id, "pane_close", { pane_id: worker.id });
    expect(naoDono.dados).toEqual({ ok: false }); // já fechado: idempotente
  }, 120_000);
});
