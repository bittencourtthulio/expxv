import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DetectorFerramentas } from "../terminais/deteccao";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco } from "../../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "./contas";
import { criarServicoProvedores } from "./servico";

afterEach(limpar);

function montar(detector: { detectar(): Promise<never[]> | Promise<ReturnType<typeof ferramenta>[]>; invalidar(): void }) {
  const { banco, repos } = novoBanco();
  const contas = criarServicoContas({ banco, repos, pastaDeDados: criarTmp("dados-") });
  return { contas, servico: criarServicoProvedores({ detector: detector as never, contas, autoPadrao: false }) };
}

describe("provedores", () => {
  it("lista as ferramentas detectadas com as contas de cada uma", async () => {
    const { contas, servico } = montar(detectorFalso());
    contas.criar("claude", "Pessoal");
    contas.criar("claude", "Trabalho");
    contas.criar("codex", "Codex 1");
    const lista = await servico.listar(false);
    const claude = lista.find((p) => p.ferramenta.id === "claude");
    expect(claude?.contas.map((c) => c.rotulo).sort()).toEqual(["Pessoal", "Trabalho"]);
    expect(lista.find((p) => p.ferramenta.id === "codex")?.contas).toHaveLength(1);
    expect(lista.find((p) => p.ferramenta.id === "opencode")?.contas).toEqual([]);
  });

  it("forçar invalida a detecção", async () => {
    const det = detectorFalso();
    const { servico } = montar(det);
    await servico.listar(false);
    expect(det.invalidacoes).toBe(0);
    await servico.listar(true);
    expect(det.invalidacoes).toBe(1);
  });

  it("a UI vê contas desabilitadas (para reabilitar) mas provider_list não", async () => {
    const { contas, servico } = montar(detectorFalso());
    const a = contas.criar("claude", "Ativa");
    const b = contas.criar("claude", "Parada");
    contas.habilitar(b.id, false);
    const ui = await servico.listar(false);
    expect(ui.find((p) => p.ferramenta.id === "claude")?.contas.map((c) => [c.rotulo, c.habilitada])).toEqual([["Ativa", true], ["Parada", false]]);
    const mcp = await servico.providerList();
    const claude = mcp.find((p) => p.provider === "claude");
    expect(claude?.accounts.map((c) => c.account_id)).toEqual([a.id]);
    expect(claude).toMatchObject({ cli: "claude", enabled: true });
  });

  it("provider_list só traz CLIs instaladas; sem conta habilitada a CLI continua usável (login é da CLI)", async () => {
    const det = detectorFalso([ferramenta("claude"), ferramenta("codex", false), ferramenta("terminal")]);
    const { servico } = montar(det);
    const mcp = await servico.providerList();
    expect(mcp.map((p) => p.provider)).toEqual(["claude"]);
    expect(mcp[0]?.accounts).toEqual([]);
    expect(mcp[0]?.enabled).toBe(true);
  });

  it.skipIf(process.platform === "win32")("versão com timeout: uma CLI travada não trava a lista e fica sem versão", async () => {
    const dir = criarTmp("bin-");
    writeFileSync(join(dir, "claude"), "#!/bin/sh\nsleep 20\n");
    writeFileSync(join(dir, "codex"), "#!/bin/sh\necho 'codex-cli 2.3.4'\n");
    chmodSync(join(dir, "claude"), 0o755);
    chmodSync(join(dir, "codex"), 0o755);
    const detector = new DetectorFerramentas({ path: dir, diretorios_convencionais: [], timeout_versao_ms: 1_500 });
    const { servico } = montar(detector);
    const t0 = Date.now();
    const lista = await servico.listar(true);
    expect(Date.now() - t0).toBeLessThan(6_000);
    expect(lista.find((p) => p.ferramenta.id === "claude")?.ferramenta).toMatchObject({ instalado: true, versao: null });
    expect(lista.find((p) => p.ferramenta.id === "codex")?.ferramenta.versao).toBe("2.3.4");
  });

  it("diagnóstico copiável só traz metadados (sem caminhos de conta nem rótulos)", async () => {
    const { contas, servico } = montar(detectorFalso());
    contas.criar("claude", "Segredo de Família");
    const { texto } = await servico.diagnostico();
    const d = JSON.parse(texto) as { ferramentas: unknown[]; contas: { por_provedor: Record<string, { total: number; habilitadas: number }> } };
    expect(d.ferramentas.length).toBeGreaterThan(0);
    expect(d.contas.por_provedor["claude"]).toEqual({ total: 1, habilitadas: 1 });
    expect(texto).not.toContain("Segredo de Família");
    expect(texto).not.toContain("contas/");
  });
});
