// "CLI falsa" do painel que orquestra: um cliente MCP de verdade com o token do painel (lido do mcp.json 0600, como a CLI faria) pede 6 agentes pelo `pane_spawn`.
// Cobre a lista mínima de tools, os 6 painéis na Missão avulsa, o teto de 8 por painel, a profundidade 1 e a recusa do que não está no token (D-420 a D-427).
import { readFileSync } from "node:fs";
import { MessageChannel } from "node:worker_threads";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { TOOLS_AVULSO } from "../nucleo/mcp/catalogo";
import { criarBarramento } from "./barramento";
import { iniciarServidorRemoto, type ThreadMcp } from "./mcp-remoto";
import { montarServidorDoWorker } from "./mcp-worker";
import { criarOrquestracao, type Orquestracao } from "./orquestracao";

afterEach(limpar);
const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};
function threadEmProcesso(dados: Parameters<NonNullable<Parameters<typeof iniciarServidorRemoto>[0]["criarThread"]>>[0]): ThreadMcp {
  const { port1, port2 } = new MessageChannel();
  void montarServidorDoWorker(port2, dados, () => undefined);
  return { postMessage: (m) => port1.postMessage(m), on: (e, f) => port1.on(e, f), off: (e, f) => port1.off(e, f), once: (e, f) => port1.once(e === "exit" ? "close" : e, f as never), terminate: async () => { port1.close(); port2.close(); } };
}
const abertas: Orquestracao[] = [];
const clientes: Client[] = [];
afterEach(async () => { while (clientes.length) await clientes.pop()?.close().catch(() => undefined); while (abertas.length) await abertas.pop()?.encerrar(); });

function montar() {
  const { banco, repos } = novoBanco();
  const dados = criarTmp("avm-dados-");
  const raiz = criarTmp("avm-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados, casa: dados, env: {} });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes }, banco, barramento: criarBarramento(), sessoes: async () => sessoes as never, dirApp: dados,
    executavelNode: "/app/Electron", electronComoNode: true, ativos: ATIVOS, atrasoFechamentoMs: 10, intervaloSegurancaMs: 50,
    iniciarServidor: (deps, ganchos) => iniciarServidorRemoto({ caminhoWorker: "-", deps, ganchos, criarThread: threadEmProcesso }),
  });
  abertas.push(orq);
  return { orq, repos, dados, ws, sessoes, panes };
}
const token = (m: ReturnType<typeof montar>, paneId: string): string => readFileSync(join(m.dados, "panes", paneId, "mcp.json"), "utf8").match(/Bearer ([^"]+)/)?.[1] as string;
async function conectar(m: ReturnType<typeof montar>, t: string): Promise<Client> {
  const c = new Client({ name: "cli-falsa", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(m.orq.servidor()!.url), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }) as never);
  clientes.push(c);
  return c;
}
async function chamar(c: Client, nome: string, args: Record<string, unknown>): Promise<{ erro: boolean; dados: Record<string, any> }> {
  const r = await c.callTool({ name: nome, arguments: args });
  return { erro: r.isError === true, dados: JSON.parse((r.content as Array<{ text: string }>)[0]?.text ?? "null") as Record<string, any> };
}

async function abrirPainel(m: ReturnType<typeof montar>) {
  m.orq.avulso.definirPreferencia(m.ws.id, true);
  const missao = m.orq.avulso.criarMissao({ workspace_id: m.ws.id, rotulo: "claude 10:00", permissao: "seguro" });
  const aberto = await m.panes.abrirPane({ missao_id: missao.id, cli: "claude", papel: "piloto", contexto: { avulso: true } });
  m.orq.avulso.vincularPane(missao.id, aberto.pane.id);
  return { missao, pane: aberto.pane };
}

describe("CLI falsa do painel avulso, MCP real", () => {
  it("lista SÓ as tools do mínimo; 6 pane_spawn viram 6 painéis worker na Missão avulsa; maestro, troca de conta e conclusão não existem", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, pane } = await abrirPainel(m);
    const c = await conectar(m, token(m, pane.id));
    expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual([...TOOLS_AVULSO].sort());
    // pedido do dono: "abre 6 agentes para buscar notícias..."
    const pedidos = await Promise.all(Array.from({ length: 6 }, (_, i) => chamar(c, "pane_spawn", { provider: "claude", role: "scout", title: `Notícias ${i + 1}`, prompt: `Busque notícias de IA de hoje (fonte ${i + 1}) e entregue o resumo.` })));
    expect(pedidos.every((p) => !p.erro)).toBe(true);
    const ids = pedidos.map((p) => p.dados["pane_id"] as string);
    expect(new Set(ids).size).toBe(6);
    const workers = m.repos.pane.listarPorMissao(missao.id).filter((p) => !p.eh_piloto);
    expect(workers.map((w) => w.id).sort()).toEqual([...ids].sort());
    expect(workers.every((w) => w.papel === "explorador" && w.mission_id === missao.id)).toBe(true);
    // cada worker tem o card com o título pedido
    expect(m.repos.task.listarPorMissao(missao.id, { limite: 20 }).itens.map((t) => t.titulo).sort()).toEqual(["Notícias 1", "Notícias 2", "Notícias 3", "Notícias 4", "Notícias 5", "Notícias 6"]);
    const lista = await chamar(c, "pane_list", {});
    expect((lista.dados as unknown as unknown[]).length).toBeGreaterThanOrEqual(6);
    // o que NÃO está no token falha, mesmo chamando pelo nome
    for (const proibida of ["maestro_request", "account_switch", "harness_set", "mission_complete", "handoff_submit", "mcp_store_list"]) {
      const r = await chamar(c, proibida, {}).catch(() => ({ erro: true, dados: {} }));
      expect(r.erro).toBe(true);
    }
  });

  it("o 9º worker do painel é recusado (limit_reached) e um worker NÃO abre worker (a tool nem existe para ele)", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { pane } = await abrirPainel(m);
    const c = await conectar(m, token(m, pane.id));
    // 8 em duas levas (a taxa é de 12/min por painel)
    for (let leva = 0; leva < 2; leva++) {
      const r = await Promise.all(Array.from({ length: 4 }, (_, i) => chamar(c, "pane_spawn", { provider: "claude", role: "scout", prompt: `tarefa ${leva}-${i}` })));
      expect(r.every((x) => !x.erro)).toBe(true);
    }
    const nona = await chamar(c, "pane_spawn", { provider: "claude", role: "scout", prompt: "a nona" });
    expect(nona.erro).toBe(true);
    expect(nona.dados).toMatchObject({ code: "rule_violation", subcode: "limit_reached" });
    // profundidade 1: o token de um worker só tem `handoff_submit`
    const idWorker = m.repos.pane.listarPorMissao((await abrirPainelVazio(m)).id).length; // garante que a função existe
    expect(idWorker).toBeGreaterThanOrEqual(0);
    const worker = m.repos.pane.listarPorWorkspace(m.ws.id, { somenteAtivos: true, limite: 100 }).itens.find((p) => !p.eh_piloto)!;
    const w = await conectar(m, token(m, worker.id));
    expect((await w.listTools()).tools.map((t) => t.name)).toEqual(["handoff_submit"]);
    const tentativa = await chamar(w, "pane_spawn", { provider: "claude", prompt: "recursão" }).catch(() => ({ erro: true, dados: {} }));
    expect(tentativa.erro).toBe(true);
  });

  it("rajada de 10 pane_spawn simultâneos: exatamente 8 abrem e 2 recebem limit_reached (limite reconferido dentro da abertura serializada)", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { pane, missao } = await abrirPainel(m);
    const c = await conectar(m, token(m, pane.id));
    const r = await Promise.all(Array.from({ length: 10 }, (_, i) => chamar(c, "pane_spawn", { provider: "claude", role: "scout", prompt: `tarefa ${i}` })));
    expect(r.filter((x) => !x.erro)).toHaveLength(8);
    expect(r.filter((x) => x.erro).every((x) => x.dados["subcode"] === "limit_reached")).toBe(true);
    expect(m.repos.pane.listarPorMissao(missao.id).filter((p) => !p.eh_piloto)).toHaveLength(8);
  });

  it("fechar o painel orquestrador revoga o token: a CLI falsa perde o acesso e os workers somem", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { pane, missao } = await abrirPainel(m);
    const t = token(m, pane.id);
    const c = await conectar(m, t);
    const r = await chamar(c, "pane_spawn", { provider: "claude", role: "scout", prompt: "x" });
    await m.orq.portas.panes.fechar(pane.id, "teste");
    await new Promise((res) => setTimeout(res, 50));
    expect(m.repos.pane.exigir(r.dados["pane_id"] as string).estado).toBe("encerrado");
    expect(m.repos.mission.exigir(missao.id).estado).toBe("abortada");
    const depois = await chamar(c, "pane_list", {}).catch(() => ({ erro: true, dados: {} }));
    expect(depois.erro).toBe(true);
  });
});

async function abrirPainelVazio(m: ReturnType<typeof montar>): Promise<{ id: string }> {
  const missao = m.orq.avulso.criarMissao({ workspace_id: m.ws.id, rotulo: "vazio", permissao: "seguro" });
  return { id: missao.id };
}
