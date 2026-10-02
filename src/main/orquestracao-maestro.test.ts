// Maestro no lançamento dos Panes (Fase 16, T-16.27/28): a orquestração real com um Maestro FALSO. Cobre: hook só em painel livre do Claude
// (Pane de etapa e Missão agêntica sem hook), tool `maestro_*` só no piloto fora de etapa, porta lazy do MCP e soma do hook com a Loja.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { DENY_GIT } from "../nucleo/maestro/rigidez/piso";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { PRODUTO, variavelDeAmbiente } from "../nucleo/produto";
import type { DepsDoServidorRemoto } from "./mcp-remoto";
import { criarBarramento } from "./barramento";
import { criarOrquestracao, type MaestroDaOrquestracao, type Orquestracao } from "./orquestracao";

afterEach(() => limpar());
const abertas: Orquestracao[] = [];
afterEach(async () => { while (abertas.length) await abertas.pop()?.encerrar(); });

const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};

interface Estado { hookAtivo: boolean; tudoDoMaestro: boolean }
function montar(maestro: "ausente" | "presente" = "presente") {
  const b = novoBanco();
  const { banco, repos } = b;
  const dados = criarTmp("orq-maestro-dados-");
  const raiz = criarTmp("orq-maestro-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex"), ferramenta("opencode")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const estado: Estado = { hookAtivo: true, tudoDoMaestro: false };
  const chamadas: string[] = [];
  const falso: MaestroDaOrquestracao = {
    portaMcp: { pedir: async () => { chamadas.push("pedir"); return { plan_id: "mpl_1", intent: "bug", confidence: 0.9, pipeline: "runx", stages: [], state: "proposed", needs_user_confirmation: true, message: "m" }; }, status: async () => ({ pipelines: [] }), permitido: async () => !estado.tudoDoMaestro },
    ehPaneDoMaestro: () => estado.tudoDoMaestro,
    hookAtivo: () => estado.hookAtivo,
    gancho: async () => ({ saida: { decision: "block", reason: "r" } }),
  };
  const tokens: Array<{ pane_id: string; role: string; mode: string; maestro?: boolean; tools_allow?: readonly string[] }> = [];
  let depsServidor: DepsDoServidorRemoto | null = null;
  let ganchosServidor: { tratar(e: string, c: unknown, b: unknown): Promise<{ saida: unknown }> } | null = null;
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes },
    banco, barramento: criarBarramento(), sessoes: async () => sessoes as never, dirApp: dados, executavelNode: "/app/Electron", electronComoNode: true,
    ativos: ATIVOS, atrasoFechamentoMs: 10, intervaloSegurancaMs: 50,
    ...(maestro === "presente" ? { maestro: () => falso } : {}),
    iniciarServidor: (d, g) => {
      depsServidor = d;
      ganchosServidor = g as never;
      return Promise.resolve({
        url: "http://127.0.0.1:1/mcp", urlGanchos: "http://127.0.0.1:1/hooks", porta: 1, portaAnterior: null, portaReutilizada: true,
        emitirToken: (p) => { tokens.push(p as never); return `token-${p.pane_id}`; }, revogar: () => undefined, fechar: async () => undefined,
      });
    },
  });
  abertas.push(orq);
  return { orq, repos, dados, ws, sessoes, missoes, panes, tokens, estado, chamadas, deps: () => depsServidor as DepsDoServidorRemoto, ganchos: () => ganchosServidor! };
}
const ultimaSessao = (m: ReturnType<typeof montar>) => [...m.sessoes.sessoes.values()].at(-1)!;
const livre = (m: ReturnType<typeof montar>, cli = "claude") => m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "L", pedido: "", clis: { executor: cli } });

describe("hook do Maestro no Pane livre do Claude", () => {
  it("Maestro ativo: --settings só com UserPromptSubmit (script ao lado do gancho), variáveis de ambiente de loopback, token sem tools", async () => {
    const m = montar();
    await m.orq.iniciar();
    await livre(m);
    const pane = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    const s = ultimaSessao(m);
    const args = s.pedido["argumentos"] as string[];
    const arquivo = join(m.dados, "panes", pane.id, "claude-settings.json");
    expect(args[args.indexOf("--settings") + 1]).toBe(arquivo);
    // a tool: --mcp-config com o servidor do app e token SÓ com as duas tools do Maestro (nunca as do modo livre inteiro)
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(join(m.dados, "panes", pane.id, "mcp.json"));
    expect(JSON.parse(readFileSync(join(m.dados, "panes", pane.id, "mcp.json"), "utf8"))).toMatchObject({ mcpServers: { [PRODUTO.id]: { type: "http", url: "http://127.0.0.1:1/mcp" } } });
    const j = JSON.parse(readFileSync(arquivo, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>> };
    expect(Object.keys(j.hooks)).toEqual(["UserPromptSubmit"]);
    expect(j.hooks["UserPromptSubmit"]![0]!.hooks[0]!.command).toContain(join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "maestro-prompt.mjs"));
    expect(s.ambiente[variavelDeAmbiente("GANCHOS_URL")]).toBe("http://127.0.0.1:1/hooks");
    expect(s.ambiente[variavelDeAmbiente("MCP_TOKEN")]).toBe(`token-${pane.id}`);
    expect(m.tokens.at(-1)).toMatchObject({ pane_id: pane.id, role: "nenhum", mode: "livre", tools_allow: ["maestro_request", "maestro_status"], maestro: true });
  });
  it("sem Maestro criado (ou hook desligado) o lançamento é IDÊNTICO ao de antes: sem args, sem ambiente, sem token, sem arquivo", async () => {
    for (const modo of ["ausente", "desligado"] as const) {
      const m = montar(modo === "ausente" ? "ausente" : "presente");
      m.estado.hookAtivo = false;
      await m.orq.iniciar();
      await livre(m);
      const s = ultimaSessao(m);
      expect(s.pedido["argumentos"], modo).toEqual([]);
      expect(Object.keys(s.ambiente), modo).toEqual([]);
      expect(m.tokens, modo).toEqual([]);
      expect(existsSync(join(m.dados, "panes")), modo).toBe(false);
    }
  });
  it("só Claude: Codex e OpenCode livres não recebem hook", async () => {
    const m = montar();
    await m.orq.iniciar();
    await livre(m, "codex");
    expect(ultimaSessao(m).pedido["argumentos"]).toEqual([]);
    await livre(m, "opencode");
    expect(ultimaSessao(m).pedido["argumentos"]).toEqual([]);
    expect(m.tokens).toEqual([]);
  });
  it("Pane de etapa do Maestro (contexto.maestro_etapa) NÃO recebe hook nem token; no Claude só leva permissions.deny com o git destrutivo (piso I4)", async () => {
    const m = montar();
    await m.orq.iniciar();
    await m.panes.abrirPane({ workspace_id: m.ws.id, cli: "claude", contexto: { maestro_etapa: true, pipeline_id: "mpl_1", etapa_id: "runx.e1" } });
    const s = ultimaSessao(m);
    const pane = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    const arquivo = join(m.dados, "panes", pane.id, "claude-settings.json");
    expect(s.pedido["argumentos"]).toEqual(["--settings", arquivo]);
    const j = JSON.parse(readFileSync(arquivo, "utf8")) as Record<string, unknown>;
    expect(j["permissions"]).toEqual({ deny: [...DENY_GIT] });
    expect(j["hooks"]).toBeUndefined();
    expect(Object.keys(s.ambiente)).toEqual([]);
    expect(m.tokens).toEqual([]);
    // as demais CLIs não ganham nada (a CLI não impõe permissions.deny: isolamento parcial)
    await m.panes.abrirPane({ workspace_id: m.ws.id, cli: "codex", contexto: { maestro_etapa: true, pipeline_id: "mpl_1", etapa_id: "runx.e2" } });
    expect(ultimaSessao(m).pedido["argumentos"]).toEqual([]);
  });
  it("Pane que o serviço já conhece como do Maestro também fica sem hook", async () => {
    const m = montar();
    m.estado.tudoDoMaestro = true;
    await m.orq.iniciar();
    await livre(m);
    expect(ultimaSessao(m).pedido["argumentos"]).toEqual([]);
    expect(m.tokens).toEqual([]);
  });
  it("Missão agêntica: o terminal avulso e os workers não recebem o hook", async () => {
    const m = montar();
    await m.orq.iniciar();
    await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "A", pedido: "x", clis: { piloto: "claude" } });
    for (const t of m.tokens) expect(JSON.stringify(t)).not.toContain("UserPromptSubmit");
    const piloto = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    const settings = JSON.parse(readFileSync(join(m.dados, "panes", piloto.id, "claude-settings.json"), "utf8")) as { hooks: Record<string, unknown> };
    expect(Object.keys(settings.hooks)).not.toContain("UserPromptSubmit");
  });
});

describe("tool maestro_* no token do piloto", () => {
  it("piloto agêntico fora de etapa: `maestro: true` na emissão; Pane de etapa e sem Maestro: nunca", async () => {
    const m = montar();
    await m.orq.iniciar();
    await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "A", pedido: "x", clis: { piloto: "claude" } });
    const piloto = m.tokens.find((t) => t.role === "piloto");
    expect(piloto?.maestro).toBe(true);

    const sem = montar("ausente");
    await sem.orq.iniciar();
    await sem.missoes.criar({ workspace_id: sem.ws.id, modo: "agentico", origem: "livre", titulo: "A", pedido: "x", clis: { piloto: "claude" } });
    expect(sem.tokens.find((t) => t.role === "piloto")?.maestro).toBeUndefined();
  });
  it("workers nunca recebem `maestro: true` (o catálogo ainda os limita a handoff_submit)", async () => {
    const m = montar();
    await m.orq.iniciar();
    expect(m.tokens.filter((t) => t.role !== "piloto" && t.maestro === true)).toEqual([]);
  });
});

describe("porta lazy do MCP e gancho", () => {
  it("o servidor MCP sempre recebe a porta `maestro`; sem Maestro as chamadas dão `unavailable`, com Maestro delegam; `permitido` sem Maestro é false", async () => {
    const com = montar();
    await com.orq.iniciar();
    await livre(com);
    const claims = { workspace_id: com.ws.id, mission_id: null, pane_id: "p", role: "nenhum" as const, mode: "livre" as const };
    await com.deps().maestro!.pedir(claims, { text: "x", files: [], excerpt: null, level: null });
    expect(com.chamadas).toEqual(["pedir"]);
    expect(await com.deps().maestro!.permitido("p")).toBe(true);

    const sem = montar("ausente");
    await sem.orq.iniciar();
    await livre(sem, "codex");
    await sem.orq.iniciar();
    // força o servidor a subir (piloto) para capturar as deps
    await sem.missoes.criar({ workspace_id: sem.ws.id, modo: "agentico", origem: "livre", titulo: "A", pedido: "x", clis: { piloto: "claude" } });
    await expect(sem.deps().maestro!.pedir(claims, { text: "x", files: [], excerpt: null, level: null })).rejects.toMatchObject({ code: "unavailable" });
    expect(await sem.deps().maestro!.permitido("p")).toBe(false);
  });
  it("gancho `maestro-prompt` chega ao Maestro; sem Maestro o prompt segue", async () => {
    const com = montar();
    await com.orq.iniciar();
    await livre(com);
    expect(await com.ganchos().tratar("maestro-prompt", { workspace_id: com.ws.id, mission_id: null, pane_id: "p" }, {})).toEqual({ saida: { decision: "block", reason: "r" } });
    const sem = montar("ausente");
    await sem.orq.iniciar();
    await sem.missoes.criar({ workspace_id: sem.ws.id, modo: "agentico", origem: "livre", titulo: "A", pedido: "x", clis: { piloto: "claude" } });
    expect(await sem.ganchos().tratar("maestro-prompt", { workspace_id: sem.ws.id, mission_id: null, pane_id: "p" }, {})).toEqual({ saida: null });
  });
});
