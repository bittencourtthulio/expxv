// Gateway MCP no lançamento dos Panes (Fase 7C) + R-1 (token do lançador escopado): a orquestração real + Loja real + gateway real (SQLite, tudo FALSO fora do banco).
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
import { criarGatewayMain } from "./gateway";

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
  const tokens: Array<{ pane_id: string; role: string; mode: string; tools_allow?: readonly string[]; aud?: readonly string[] }> = [];
  const gateway = criarGatewayMain({
    repo: repos.gateway, loja: () => loja.loja,
    paneAtivo: (id) => { const p = repos.pane.obter(id); return p !== undefined && p.estado !== "encerrado"; },
    raizDoWorkspace: (id) => { try { return repos.workspace.exigir(id).raiz; } catch { return null; } },
    emitirRenderer: () => undefined,
  });
  const avisos: string[] = [];
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes },
    banco, barramento: criarBarramento(), sessoes: async () => sessoes as never, dirApp: dados, executavelNode: "/app/Electron", electronComoNode: true,
    ativos: ATIVOS, avisar: (x) => void avisos.push(x), atrasoFechamentoMs: 10, intervaloSegurancaMs: 50,
    loja: () => loja.loja,
    gateway: () => gateway,
    iniciarServidor: () => {
      servidoresSubidos++;
      return Promise.resolve({
        url: "http://127.0.0.1:1/mcp", urlGanchos: "http://127.0.0.1:1/hooks", porta: 1, portaAnterior: null, portaReutilizada: true,
        emitirToken: (p) => { tokens.push(p); return `token-${(p.aud ?? ["mcp"]).join("+")}-${p.pane_id}`; }, revogar: () => undefined, fechar: async () => undefined,
      });
    },
  });
  abertas.push(orq);
  return { orq, loja, gateway, repos, dados, raiz, ws, sessoes, missoes, panes, servidoresSubidos: () => servidoresSubidos, tokens, avisos };
}

/** habilita o falso-ok (sem variável) no workspace da montagem. */
async function habilitarNoWorkspace(m: ReturnType<typeof montar>): Promise<void> {
  await m.loja.instalar("falso-ok");
  expect(await m.loja.loja.habilitar("falso-ok", "workspace", m.ws.id, true)).toMatchObject({ ok: true });
}
const ligarGateway = (m: ReturnType<typeof montar>, extra: Partial<{ modo_superficie: "completo" | "reduzido" | "busca" }> = {}): void => {
  m.repos.gateway.gravarConfig({ workspace_id: m.ws.id, ativo: true, modo_superficie: extra.modo_superficie ?? "completo", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 }, "2026-10-01T00:00:00.000Z");
};
const ultimaSessao = (m: ReturnType<typeof montar>) => [...m.sessoes.sessoes.values()].at(-1)!;
const modeloLivre = { modo: "livre", origem: "livre", titulo: "L", pedido: "" } as const;

describe("R-1: o lançador recebe um token PRÓPRIO; o token geral do Pane (ambiente do agente) não lê segredo", () => {
  it("Pane livre com a Loja direta: LOJA_TOKEN tem audiência `loja-launcher`; MCP_TOKEN (hooks) é o geral, sem essa audiência", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    await m.missoes.criar({ workspace_id: m.ws.id, ...modeloLivre, clis: { executor: "claude" } });
    const pane = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    const s = ultimaSessao(m);
    expect(s.ambiente[variavelDeAmbiente("LOJA_TOKEN")]).toBe(`token-loja-launcher-${pane.id}`);
    expect(s.ambiente[variavelDeAmbiente("MCP_TOKEN")]).toBe(`token-mcp-${pane.id}`);
    const emitidos = m.tokens.filter((t) => t.pane_id === pane.id);
    expect(emitidos.some((t) => t.aud?.includes("loja-launcher") === true && t.tools_allow?.length === 0)).toBe(true);
    expect(emitidos.filter((t) => t.aud === undefined).length).toBeGreaterThan(0);
  });
});

describe("Gateway no lançamento do Pane", () => {
  it("desligado (padrão): nada de snapshot do gateway; a Loja injeta direto como antes", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    await m.missoes.criar({ workspace_id: m.ws.id, ...modeloLivre, clis: { executor: "claude" } });
    const pane = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    const mcp = JSON.parse(readFileSync(join(m.dados, "panes", pane.id, "mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(mcp.mcpServers)).toEqual(["ev_falso_ok"]);
    expect(m.repos.gateway.obterPane(pane.id)).toBeNull(); // sem snapshot do gateway (o da Loja só persiste com a ligação do main)
    expect(m.gateway.gate(pane.id, "mcp__ev_gateway__x").permitido).toBe(false);
  });

  it("ligado, Pane livre Claude: UMA entrada `ev_gateway` (cabeçalho com token de audiência gateway), nenhum servidor direto, nenhuma credencial do lançador, gate pre-mcp, snapshot do gateway", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    ligarGateway(m);
    await m.missoes.criar({ workspace_id: m.ws.id, ...modeloLivre, clis: { executor: "claude" } });
    const pane = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    const s = ultimaSessao(m);
    const args = s.pedido["argumentos"] as string[];
    const pasta = join(m.dados, "panes", pane.id);
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(join(pasta, "mcp.json"));
    const mcp = JSON.parse(readFileSync(join(pasta, "mcp.json"), "utf8")) as { mcpServers: Record<string, { type: string; url: string; headers: { Authorization: string } }> };
    expect(Object.keys(mcp.mcpServers)).toEqual(["ev_gateway"]);
    expect(mcp.mcpServers["ev_gateway"]!.url).toBe("http://127.0.0.1:1/gateway");
    expect(mcp.mcpServers["ev_gateway"]!.headers.Authorization).toBe(`Bearer token-gateway-${pane.id}`);
    expect(statSync(join(pasta, "mcp.json")).mode & 0o777).toBe(0o600);
    // o Pane não recebe credencial do lançador (os servidores rodam no main) nem segredo
    expect(s.ambiente[variavelDeAmbiente("LOJA_TOKEN")]).toBeUndefined();
    expect(s.ambiente[variavelDeAmbiente("LOJA_URL")]).toBeUndefined();
    expect(JSON.stringify([args, s.ambiente, mcp])).not.toContain(SEGREDO_VAZADO_SENTINELA);
    const settings = JSON.parse(readFileSync(join(pasta, "claude-settings.json"), "utf8")) as { hooks: { PreToolUse: Array<{ matcher: string }> } };
    expect(settings.hooks.PreToolUse.map((x) => x.matcher)).toContain("mcp__ev_.*");
    const emitidos = m.tokens.filter((t) => t.pane_id === pane.id);
    expect(emitidos.some((t) => t.aud?.join() === "gateway" && t.tools_allow?.length === 0)).toBe(true);
    expect(emitidos.some((t) => t.aud?.includes("loja-launcher") === true)).toBe(false);
    // snapshot do gateway (persistido) e gate
    expect(JSON.parse(m.repos.gateway.obterPane(pane.id)!.dados_json)).toMatchObject({ via: "gateway", ids: ["falso-ok"] });
    expect(m.gateway.gate(pane.id, "mcp__ev_gateway__falso_ok__eco").permitido).toBe(true);
    // o servidor MCP do app SOBE por causa do gateway (ele mora lá), uma vez
    expect(m.servidoresSubidos()).toBe(1);
  });

  it("ligado, Pane livre Codex: gateway por -c/URL com o token SÓ em variável de ambiente; sem servidor direto", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    ligarGateway(m);
    await m.missoes.criar({ workspace_id: m.ws.id, ...modeloLivre, clis: { executor: "codex" } });
    const pane = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    const s = ultimaSessao(m);
    const args = s.pedido["argumentos"] as string[];
    expect(args.some((a) => a.startsWith("mcp_servers.ev_gateway.url="))).toBe(true);
    expect(args.some((a) => a.includes("mcp_servers.ev_falso_ok"))).toBe(false);
    expect(args.join(" ")).not.toContain("token-gateway");
    expect(s.ambiente[variavelDeAmbiente("GATEWAY_TOKEN")]).toBe(`token-gateway-${pane.id}`);
    expect(s.ambiente[variavelDeAmbiente("LOJA_TOKEN")]).toBeUndefined();
  });

  it("ligado mas SEM servidor habilitado: nada muda (nem servidor MCP nem arquivo)", async () => {
    const m = montar();
    await m.orq.iniciar();
    ligarGateway(m);
    await m.missoes.criar({ workspace_id: m.ws.id, ...modeloLivre, clis: { executor: "claude" } });
    const s = ultimaSessao(m);
    expect(s.pedido["argumentos"]).toEqual([]);
    expect(Object.keys(s.ambiente)).toEqual([]);
    expect(m.tokens.filter((t) => t.aud?.includes("gateway") === true)).toEqual([]);
  });

  it("piloto agêntico com allow-list da Missão e gateway ligado: o MCP do app + `ev_gateway` no MESMO --mcp-config, estrito; token do app sem audiência gateway", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    ligarGateway(m);
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "L", pedido: "x", clis: { piloto: "claude" } });
    const antigo = missao.piloto_pane_id as string;
    await m.loja.loja.habilitar("falso-ok", "missao", missao.id, true);
    await m.panes.encerrarPane(antigo, "teste");
    const r = await m.panes.respawn(antigo);
    const sessao = m.sessoes.sessoes.get(r.sessao_id)!;
    const args = sessao.pedido["argumentos"] as string[];
    expect(args.filter((a) => a === "--mcp-config")).toHaveLength(1);
    expect(args).toContain("--strict-mcp-config");
    const mcp = JSON.parse(readFileSync(join(m.dados, "panes", r.pane.id, "mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(mcp.mcpServers).sort()).toEqual([PRODUTO.id, "ev_gateway"].sort());
    expect(sessao.ambiente[variavelDeAmbiente("LOJA_TOKEN")]).toBeUndefined();
    expect(sessao.ambiente[variavelDeAmbiente("MCP_TOKEN")]).toBe(`token-mcp-${r.pane.id}`);
    expect(m.gateway.gate(r.pane.id, "mcp__ev_gateway__x").permitido).toBe(true);
  });

  it("fechar o Pane apaga o snapshot persistido do gateway e o gate passa a negar", async () => {
    const m = montar();
    await m.orq.iniciar();
    await habilitarNoWorkspace(m);
    ligarGateway(m);
    await m.missoes.criar({ workspace_id: m.ws.id, ...modeloLivre, clis: { executor: "claude" } });
    const pane = m.repos.pane.listarPorWorkspace(m.ws.id).itens.at(-1)!;
    await m.panes.encerrarPane(pane.id, "fim");
    m.gateway.liberar(pane.id);
    expect(m.repos.gateway.obterPane(pane.id)).toBeNull();
    expect(m.gateway.gate(pane.id, "mcp__ev_gateway__x").permitido).toBe(false);
  });
});
