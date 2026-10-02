// E2E do painel livre que orquestra (D-420 a D-427) no Electron real. A CLI falsa `cli-agente.mjs` grava o que cada Pane recebeu (argv, ambiente, arquivos):
// aqui se prova, sem CLI real, que (1) a opção nasce DESLIGADA, (2) ligada, o painel abre como piloto da Missão avulsa com o MCP e a instrução de descoberta e
// (3) desligar/fechar a Missão limpa. Escrito para rodar com `npm run build` pronto (`npm run test:e2e`); NÃO rodar com o `npm run dev` do dono ativo.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUTO } from "../src/nucleo/produto";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";

let amb: AmbienteOrq;

beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
}, 120_000);
afterAll(async () => {
  await amb?.fechar();
});

interface JanelaPL {
  ade: {
    painelLivre: {
      preferencia(ws: string, ativa?: boolean, orquestradorEdita?: boolean, fecharWorkers?: boolean): Promise<{ ativa: boolean; orquestrador_edita: boolean; fechar_workers: boolean }>;
      ponteGrok(ws: string, acao: "estado" | "aplicar" | "remover"): Promise<{ estado: "ausente" | "ativa" | "bloqueada"; arquivo: string; conteudo: string }>;
      abrir(p: { workspace_id: string; ferramenta_id: string; orquestrar: boolean }): Promise<{ sessao_id: string; pane_id: string; missao_id: string | null; orquestrando: boolean }>;
      orquestrar(p: { workspace_id: string; sessao_id: string; ligar: boolean }): Promise<{ sessao_id: string; pane_id: string | null; missao_id: string | null; orquestrando: boolean; retomado: boolean }>;
    };
    missoes: { detalhe(id: string): Promise<{ mission: { modo: string; estado: string; titulo: string }; panes: Array<{ id: string; eh_piloto: boolean; estado: string }> } | null>; abortar(id: string): Promise<unknown> };
  };
}
/** O prompt de sistema que a CLI recebeu: inline, ou lido do arquivo que o app passa quando o texto é longo. */
const promptDoRegistro = (argv: string[]): string => {
  const i = argv.indexOf("--append-system-prompt");
  if (i >= 0) return argv[i + 1] ?? "";
  const j = argv.indexOf("--append-system-prompt-file");
  return j >= 0 ? readFileSync(argv[j + 1] as string, "utf8") : "";
};
const noApp = <T, A>(fn: (w: JanelaPL, a: A) => Promise<T>, arg: A): Promise<T> => amb.app.pagina.evaluate(new Function("a", `return (${fn.toString()})(window, a)`) as never, arg) as Promise<T>;

describe("painel livre que orquestra no Electron real", () => {
  it("nasce DESLIGADO: abrir orquestrando é recusado e nenhuma Missão avulsa aparece", async () => {
    expect((await noApp((w, ws) => w.ade.painelLivre.preferencia(ws), amb.wsId)).ativa).toBe(false);
    const erro = await noApp(async (w, ws) => { try { await w.ade.painelLivre.abrir({ workspace_id: ws, ferramenta_id: "claude", orquestrar: true }); return null; } catch (e) { return String((e as Error).message); } }, amb.wsId);
    expect(erro).toMatch(/permita primeiro|não podem abrir agentes/i);
  });

  it("ligado: o painel abre como piloto da Missão avulsa com MCP escopado e instrução 'use pane_spawn'; desligar limpa a Missão", async () => {
    expect((await noApp((w, ws) => w.ade.painelLivre.preferencia(ws, true), amb.wsId)).ativa).toBe(true);
    const r = await noApp((w, ws) => w.ade.painelLivre.abrir({ workspace_id: ws, ferramenta_id: "claude", orquestrar: true }), amb.wsId);
    expect(r.orquestrando).toBe(true);
    const detalhe = await noApp((w, id) => w.ade.missoes.detalhe(id), r.missao_id as string);
    expect(detalhe?.mission).toMatchObject({ modo: "agentico", estado: "executando" });
    expect(detalhe?.mission.titulo).toContain("Missão avulsa");
    expect(detalhe?.panes.find((p) => p.eh_piloto)?.id).toBe(r.pane_id);

    const registro = await esperar(() => amb.registroDoPane(r.pane_id));
    expect(registro.argv).toContain("--mcp-config");
    const instrucao = promptDoRegistro(registro.argv);
    expect(instrucao).toContain("pane_spawn");
    expect(instrucao).toMatch(/subagentes internos/i);
    expect(registro.ambiente[`${PRODUTO.prefixoEnv}ORQUESTRACAO`]).toBe("painel-livre");

    const volta = await noApp((w, a) => w.ade.painelLivre.orquestrar({ workspace_id: a.ws, sessao_id: a.sessao, ligar: false }), { ws: amb.wsId, sessao: r.sessao_id });
    expect(volta.orquestrando).toBe(false);
    const depois = await esperar(async () => { const d = await noApp((w, id) => w.ade.missoes.detalhe(id), r.missao_id as string); return d?.mission.estado === "abortada" ? d : null; });
    expect(depois.panes.every((p) => p.estado === "encerrado")).toBe(true);
  }, 90_000);
});

describe("orquestrador de verdade no Electron real (D-510 a D-514)", () => {
  it("o painel abre com o prompt de orquestrador e os negadores: subagentes e edição negados por sessão; o opt-out do projeto solta só a edição", async () => {
    await noApp((w, ws) => w.ade.painelLivre.preferencia(ws, true), amb.wsId);
    const r = await noApp((w, ws) => w.ade.painelLivre.abrir({ workspace_id: ws, ferramenta_id: "claude", orquestrar: true }), amb.wsId);
    const registro = await esperar(() => amb.registroDoPane(r.pane_id));
    const settingsPath = registro.argv[registro.argv.indexOf("--settings") + 1] as string;
    const deny = (JSON.parse(readFileSync(settingsPath, "utf8")) as { permissions: { deny: string[] } }).permissions.deny;
    expect(deny).toEqual(expect.arrayContaining(["Agent", "Task", "Edit", "Write"]));
    expect(registro.argv).not.toContain("--dangerously-skip-permissions");
    const prompt = promptDoRegistro(registro.argv);
    expect(prompt).toMatch(/ORQUESTRADOR/);
    expect(prompt).toMatch(/PARALELO/);
    await noApp((w, ws) => w.ade.painelLivre.preferencia(ws, undefined, true), amb.wsId);
    const r2 = await noApp((w, ws) => w.ade.painelLivre.abrir({ workspace_id: ws, ferramenta_id: "claude", orquestrar: true }), amb.wsId);
    const registro2 = await esperar(() => amb.registroDoPane(r2.pane_id));
    const deny2 = (JSON.parse(readFileSync(registro2.argv[registro2.argv.indexOf("--settings") + 1] as string, "utf8")) as { permissions: { deny: string[] } }).permissions.deny;
    expect(deny2).toEqual(["Agent", "Task"]);
    await noApp((w, ws) => w.ade.painelLivre.preferencia(ws, undefined, false), amb.wsId);
  }, 90_000);

  it("ponte do Grok: nasce ausente; só 'aplicar' grava o arquivo de projeto (sem segredo) e 'remover' o apaga", async () => {
    const arquivo = join(amb.raiz, ".grok", "config.toml");
    expect((await noApp((w, ws) => w.ade.painelLivre.ponteGrok(ws, "estado"), amb.wsId)).estado).toBe("ausente");
    expect(existsSync(arquivo)).toBe(false);
    expect((await noApp((w, ws) => w.ade.painelLivre.ponteGrok(ws, "aplicar"), amb.wsId)).estado).toBe("ativa");
    const texto = readFileSync(arquivo, "utf8");
    expect(texto).toContain("${" + PRODUTO.prefixoEnv + "MCP_URL}");
    expect(texto).not.toMatch(/Bearer [A-Za-z0-9]{8,}/);
    expect((await noApp((w, ws) => w.ade.painelLivre.ponteGrok(ws, "remover"), amb.wsId)).estado).toBe("ausente");
    expect(existsSync(arquivo)).toBe(false);
  }, 60_000);
});
