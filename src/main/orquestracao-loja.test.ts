// Loja de MCPs no lançamento dos Panes (Fase 7B, onda C): a orquestração real + o serviço da Loja real (SQLite, catálogo e npm FALSOS).
// Cobre: injeção no piloto (um só --mcp-config), Pane livre só com a Loja, gate pre-mcp no settings, ambiente de loopback sem segredo,
// nada habilitado = nada muda (e o servidor MCP nem sobe).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { SEGREDO_VAZADO_SENTINELA, aguardar, montarLoja } from "../../tests/fixtures/mcp-loja/apoio-main";
import { limparPastas } from "../../tests/fixtures/mcp-loja/apoio-ciclo";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { PRODUTO } from "../nucleo/produto";
import { variavelDeAmbiente } from "../nucleo/produto";
import { criarBarramento } from "./barramento";
import { criarOrquestracao, type Orquestracao } from "./orquestracao";

afterEach(() => { limpar(); limparPastas(); });
const abertas: Orquestracao[] = [];
afterEach(async () => { while (abertas.length) await abertas.pop()?.encerrar(); });

const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};

function montar() {
  const b = novoBanco();
  const { banco, repos } = b;
  const dados = criarTmp("orq-loja-dados-");
  const raiz = criarTmp("orq-loja-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex"), ferramenta("opencode"), ferramenta("gemini")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const loja = montarLoja({
    repo: repos.lojaMcp, userData: dados,
    paneAtivo: (id) => { const p = repos.pane.obter(id); return p !== undefined && p.estado !== "encerrado"; },
    raizDoWorkspace: (id) => { try { return repos.workspace.exigir(id).raiz; } catch { return null; } },
  });
  let servidoresSubidos = 0;
  const tokens: Array<{ pane_id: string; role: string; mode: string; tools_allow?: readonly string[] }> = [];
  const avisos: string[] = [];
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes },
    banco, barramento: criarBarramento(), sessoes: async () => sessoes as never, dirApp: dados, executavelNode: "/app/Electron", electronComoNode: true,
    ativos: ATIVOS, avisar: (x) => void avisos.push(x), atrasoFechamentoMs: 10, intervaloSegurancaMs: 50,
    loja: () => loja.loja,
    iniciarServidor: () => {
      servidoresSubidos++;
      return Promise.resolve({
        url: "http://127.0.0.1:1/mcp", urlGanchos: "http://127.0.0.1:1/hooks", porta: 1, portaAnterior: null, portaReutilizada: true,
        emitirToken: (p) => { tokens.push(p); return `token-${p.pane_id}`; }, revogar: () => undefined, fechar: async () => undefined,
      });
    },
  });
  abertas.push(orq);
  return { orq, loja, repos, dados, raiz, ws, sessoes, missoes, panes, servidoresSubidos: () => servidoresSubidos, tokens, avisos };
}

/** habilita o falso-ok (sem variável) no workspace da montagem. */
async function habilitarNoWorkspace(m: ReturnType<typeof montar>): Promise<void> {
  await m.loja.instalar("falso-ok");
  expect(await m.loja.loja.habilitar("falso-ok", "workspace", m.ws.id, true)).toMatchObject({ ok: true });
}

const ultimaSessao = (m: ReturnType<typeof montar>) => [...m.sessoes.sessoes.values()].at(-1)!;

describe("Loja no piloto", () => {
  it("piloto agêntico: um só --mcp-config com o MCP do app E o servidor da Loja; gate pre-mcp no settings; loopback no ambiente; sem segredo", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    await m.loja.loja.habilitar("falso-ok", "missao", "mis_nao_importa", true);
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "L", pedido: "x", clis: { piloto: "claude" } });
    // modo agêntico é deny-by-default: sem a allow-list da Missão a Loja não entra no piloto
    const sessao = ultimaSessao(m);
    const args = sessao.pedido["argumentos"] as string[];
    expect(args.filter((a) => a === "--mcp-config")).toHaveLength(1);
    const pasta = join(m.dados, "panes", missao.piloto_pane_id as string);
    const semLoja = JSON.parse(readFileSync(join(pasta, "mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(semLoja.mcpServers)).toEqual([PRODUTO.id]);
    expect(args).not.toContain("--strict-mcp-config");
    expect(sessao.ambiente[variavelDeAmbiente("LOJA_URL")]).toBeUndefined();
    const settings = JSON.parse(readFileSync(join(pasta, "claude-settings.json"), "utf8")) as { hooks: { PreToolUse: Array<{ matcher: string }> } };
    expect(settings.hooks.PreToolUse.map((x) => x.matcher)).not.toContain("mcp__ev_.*");
  });

  it("Missão agêntica COM allow-list da Missão (respawn do piloto): a Loja entra no MESMO --mcp-config, estrito; gate liga; ambiente só com URL/token de loopback", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "L", pedido: "x", clis: { piloto: "claude" } });
    const antigo = missao.piloto_pane_id as string;
    await m.loja.loja.habilitar("falso-ok", "missao", missao.id, true);
    await m.panes.encerrarPane(antigo, "teste");
    const r = await m.panes.respawn(antigo);
    const sessao = m.sessoes.sessoes.get(r.sessao_id)!;
    const args = sessao.pedido["argumentos"] as string[];
    expect(args.filter((a) => a === "--mcp-config")).toHaveLength(1);
    expect(args).toContain("--strict-mcp-config");
    const pasta = join(m.dados, "panes", r.pane.id);
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(join(pasta, "mcp.json"));
    const mcp = JSON.parse(readFileSync(join(pasta, "mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(mcp.mcpServers).sort()).toEqual([PRODUTO.id, "ev_falso_ok"].sort());
    const settings = JSON.parse(readFileSync(join(pasta, "claude-settings.json"), "utf8")) as { hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> } };
    expect(settings.hooks.PreToolUse.map((x) => x.matcher)).toContain("mcp__ev_.*");
    expect(settings.hooks.PreToolUse.find((x) => x.matcher === "mcp__ev_.*")!.hooks[0]!.command).toContain("pre-mcp");
    expect(sessao.ambiente[variavelDeAmbiente("LOJA_URL")]).toBe("http://127.0.0.1:1/loja/segredos");
    expect(sessao.ambiente[variavelDeAmbiente("LOJA_TOKEN")]).toBe(`token-${r.pane.id}`);
    expect(sessao.ambiente[variavelDeAmbiente("MCP_TOKEN")]).toBe(`token-${r.pane.id}`);
    expect(m.loja.loja.gate(r.pane.id, "mcp__ev_falso_ok__eco").permitido).toBe(true);
    expect(JSON.stringify([args, sessao.ambiente])).not.toContain(SEGREDO_VAZADO_SENTINELA);
  });
});

describe("Loja em Pane sem orquestração", () => {
  it("nada habilitado: lançamento idêntico (sem args, sem ambiente), nenhum token emitido e nenhum arquivo criado", async () => {
    const m = montar();
    await m.orq.iniciar();
    await m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "L", pedido: "", clis: { executor: "claude" } });
    const s = ultimaSessao(m);
    expect(s.pedido["argumentos"]).toEqual([]);
    expect(Object.keys(s.ambiente)).toEqual([]);
    expect(m.tokens).toEqual([]); // nenhum token emitido: o Pane livre sem Loja não pede nada ao servidor MCP
    expect(existsSync(join(m.dados, "panes"))).toBe(false);
    expect(m.loja.cofreAbertoVezes()).toBe(0);
  });

  it("Pane livre Claude com servidor habilitado: --mcp-config + --settings (só gate pre-mcp), arquivos 0600, ambiente de loopback, sem segredo", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    await m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "L", pedido: "", clis: { executor: "claude" } });
    const pane = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    const s = ultimaSessao(m);
    const args = s.pedido["argumentos"] as string[];
    const pasta = join(m.dados, "panes", pane.id);
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(join(pasta, "mcp.json"));
    expect(args).not.toContain("--strict-mcp-config");
    expect(args[args.indexOf("--settings") + 1]).toBe(join(pasta, "claude-settings.json"));
    expect(statSync(join(pasta, "mcp.json")).mode & 0o777).toBe(0o600);
    const mcp = JSON.parse(readFileSync(join(pasta, "mcp.json"), "utf8")) as { mcpServers: Record<string, { command: string }> };
    expect(Object.keys(mcp.mcpServers)).toEqual(["ev_falso_ok"]);
    const settings = JSON.parse(readFileSync(join(pasta, "claude-settings.json"), "utf8")) as { hooks: Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>> };
    expect(Object.keys(settings.hooks)).toEqual(["PreToolUse"]);
    expect(settings.hooks["PreToolUse"]![0]!.matcher).toBe("mcp__ev_.*");
    expect(settings.hooks["PreToolUse"]![0]!.hooks[0]!.command).toContain("pre-mcp");
    expect(s.ambiente[variavelDeAmbiente("LOJA_URL")]).toBe("http://127.0.0.1:1/loja/segredos");
    expect(s.ambiente[variavelDeAmbiente("LOJA_TOKEN")]).toBe(`token-${pane.id}`);
    expect(s.ambiente[variavelDeAmbiente("GANCHOS_URL")]).toBe("http://127.0.0.1:1/hooks");
    expect(JSON.stringify([args, s.ambiente, mcp, settings])).not.toContain(SEGREDO_VAZADO_SENTINELA);
    // o token do Pane livre não dá tool nenhuma: só serve à rota de segredos
    expect(m.tokens.at(-1)).toMatchObject({ pane_id: pane.id, role: "nenhum", mode: "livre", tools_allow: [] });
    // o gate vê o snapshot do Pane
    expect(m.loja.loja.gate(pane.id, "mcp__ev_falso_ok__eco").permitido).toBe(true);
    expect(m.loja.loja.gate(pane.id, "mcp__ev_outro__x").permitido).toBe(false);
  });

  it("Pane livre Codex: só argumentos -c (sem arquivo, sem settings); Gemini e shell: lançamento comum", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    await m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "C", pedido: "", clis: { executor: "codex" } });
    const codex = ultimaSessao(m);
    const args = codex.pedido["argumentos"] as string[];
    expect(args.some((a) => a.startsWith("mcp_servers.ev_falso_ok.command="))).toBe(true);
    expect(args).not.toContain("--settings");
    expect(codex.ambiente[variavelDeAmbiente("LOJA_TOKEN")]).toContain("token-");
    await m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "G", pedido: "", clis: { executor: "gemini" } });
    const gemini = ultimaSessao(m);
    expect(gemini.pedido["argumentos"]).toEqual([]);
    expect(Object.keys(gemini.ambiente)).toEqual([]);
  });

  it("falha da Loja nunca impede o Pane de abrir (aviso, lançamento comum)", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    const original = m.loja.loja.resolver;
    m.loja.loja.resolver = async () => { throw new Error("catálogo quebrou"); };
    await m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "F", pedido: "", clis: { executor: "claude" } });
    m.loja.loja.resolver = original;
    expect(ultimaSessao(m).pedido["argumentos"]).toEqual([]);
    await aguardar(() => m.avisos.some((a) => a.includes("Loja de MCPs")));
  });
});
