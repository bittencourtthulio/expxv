// Ciclo de vida do painel do worker (D-520 em diante). Reproduz o relato do dono ("três painéis ficaram em 'Sessão encerrada, código 143' e o orquestrador não achou texto"): CLI falsa
// de orquestrador com MCP REAL em processo pede 3 workers em paralelo, cada um entrega o handoff pelo MCP; conferimos quando o app encerra os workers, o que sobra na grade e o que o
// orquestrador ainda consegue ler (`pane_read`, `pane_list`, `handoff_read`) depois que o painel fecha.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { MessageChannel } from "node:worker_threads";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { PRODUTO } from "../nucleo/produto";
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
afterEach(async () => { vi.useRealTimers(); while (clientes.length) await clientes.pop()?.close().catch(() => undefined); while (abertas.length) await abertas.pop()?.encerrar(); });

function montar(extra: { atrasoFechamentoMs?: number; gracaTurnoMs?: number; ttlCaudaMs?: number; relogio?: { agora(): number } } = {}) {
  const { banco, repos } = novoBanco();
  const dados = criarTmp("cw-dados-");
  const raiz = criarTmp("cw-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados, casa: dados, env: {} });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const barramento = criarBarramento();
  const eventos: Array<{ tipo: string; payload: unknown }> = [];
  for (const tipo of ["handoff.submitted", "wake.queued", "wake.delivered", "worker.fechado", "worker.falhou"]) barramento.assinar(tipo, (payload) => void eventos.push({ tipo, payload }));
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes }, banco, barramento, sessoes: async () => sessoes as never, dirApp: dados,
    executavelNode: "/app/Electron", electronComoNode: true, ativos: ATIVOS, atrasoFechamentoMs: extra.atrasoFechamentoMs ?? 10, intervaloSegurancaMs: 50,
    ...(extra.ttlCaudaMs === undefined ? {} : { ttlCaudaMs: extra.ttlCaudaMs }),
    ...(extra.gracaTurnoMs === undefined ? {} : { gracaTurnoMs: extra.gracaTurnoMs }),
    ...(extra.relogio === undefined ? {} : { relogio: { ...extra.relogio, agora: () => extra.relogio?.agora() ?? Date.now() } as never }),
    iniciarServidor: (deps, ganchos) => iniciarServidorRemoto({ caminhoWorker: "-", deps, ganchos, criarThread: threadEmProcesso }),
  });
  abertas.push(orq);
  return { orq, repos, dados, ws, raiz, sessoes, panes, eventos, barramento };
}
type M = ReturnType<typeof montar>;
const token = (m: M, paneId: string): string => readFileSync(join(m.dados, "panes", paneId, "mcp.json"), "utf8").match(/Bearer ([^"]+)/)?.[1] as string;
async function conectar(m: M, t: string): Promise<Client> {
  const c = new Client({ name: "cli-falsa", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(m.orq.servidor()!.url), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }) as never);
  clientes.push(c);
  return c;
}
async function chamar(c: Client, nome: string, args: Record<string, unknown>): Promise<{ erro: boolean; dados: any }> {
  const r = await c.callTool({ name: nome, arguments: args });
  return { erro: r.isError === true, dados: JSON.parse((r.content as Array<{ text: string }>)[0]?.text ?? "null") };
}
const espera = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
async function ate(cond: () => boolean, ms = 3_000): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await espera(5);
}

async function abrirPainel(m: M) {
  m.orq.avulso.definirPreferencia(m.ws.id, true);
  const missao = m.orq.avulso.criarMissao({ workspace_id: m.ws.id, rotulo: "grok 15:06", permissao: "seguro" });
  const aberto = await m.panes.abrirPane({ missao_id: missao.id, cli: "claude", papel: "piloto", contexto: { avulso: true } });
  m.orq.avulso.vincularPane(missao.id, aberto.pane.id);
  const orquestrador = await conectar(m, token(m, aberto.pane.id));
  return { missao, pane: aberto.pane, orquestrador };
}

/** O pedido do dono: "abra 3 agentes em paralelo; cada um responde uma linha com o seu número e a hora". */
async function tresWorkers(m: M) {
  const p = await abrirPainel(m);
  const pedidos = await Promise.all([1, 2, 3].map((n) => chamar(p.orquestrador, "pane_spawn", { provider: "claude", role: "scout", title: `Agente ${n}`, prompt: `Responda uma linha com o seu número (${n}) e a hora.` })));
  expect(pedidos.every((x) => !x.erro)).toBe(true);
  const ids = pedidos.map((x) => x.dados.pane_id as string);
  // o orquestrador (Claude falso) já está ocioso: é o ponto seguro dos avisos
  const sessaoOrq = m.repos.pane.exigir(p.pane.id).sessao_pty_id as string;
  m.sessoes.emitir(sessaoOrq, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
  return { ...p, ids };
}
const sessaoDe = (m: M, paneId: string): string => m.repos.pane.exigir(paneId).sessao_pty_id as string;

/** O worker produz saída por um tempo, grava o relatório e entrega o handoff pelo MCP com o token dele. */
async function entregar(m: M, paneId: string, n: number, status: "ok" | "failed" = "ok"): Promise<void> {
  const sessao = sessaoDe(m, paneId);
  m.sessoes.emitir(sessao, { tipo: "saida", dados: `\u001b[1mAgente ${n}: 1 linha, 15:0${n}\u001b[0m\r\n` });
  const task = m.repos.task.listarPorMissao(m.repos.pane.exigir(paneId).mission_id as string, { limite: 20 }).itens.find((t) => t.pane_id === paneId)!;
  const rel = `${PRODUTO.pastaNoProjeto}/relatorios/w${n}.md`;
  mkdirSync(join(m.raiz, PRODUTO.pastaNoProjeto, "relatorios"), { recursive: true });
  writeFileSync(join(m.raiz, rel), `# Relatório ${n}\nAgente ${n}: 15:0${n}\n`);
  const w = await conectar(m, token(m, paneId));
  const r = await chamar(w, "handoff_submit", { task_id: task.id, summary: `agente ${n} ok`, report_path: rel, status });
  expect(r.erro).toBe(false);
}

describe("REPRODUÇÃO do 143: três workers concluem e o app os encerra", () => {
  it("o app fecha cada worker 1,5 s depois do handoff (handoff_done); o painel NÃO pode ficar pendurado e a saída NÃO pode sumir", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids } = await tresWorkers(m);
    const sessoes = ids.map((id) => sessaoDe(m, id));
    for (const [i, id] of ids.entries()) await entregar(m, id, i + 1);
    await ate(() => ids.every((id) => m.repos.pane.exigir(id).estado === "encerrado"));
    // causa confirmada em produção: motivo `handoff_done`, 1,5 s depois de cada handoff
    expect(ids.map((id) => m.repos.pane.exigir(id).encerrado_motivo)).toEqual(["handoff_done", "handoff_done", "handoff_done"]);
    // o defeito: a sessão ficava na grade como "Sessão encerrada (código 143)"
    await ate(() => sessoes.every((s) => !m.sessoes.sessoes.has(s)));
    expect(sessoes.every((s) => !m.sessoes.sessoes.has(s))).toBe(true);
    expect(m.sessoes.fechadasPelaApp.map((f) => f.id).sort()).toEqual([...sessoes].sort());
  });

  it("depois do fechamento, `pane_read` do worker devolve a cauda da saída (sem escapes) e `pane_list` mostra o worker concluído", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    for (const [i, id] of ids.entries()) await entregar(m, id, i + 1);
    await ate(() => ids.every((id) => m.repos.pane.exigir(id).estado === "encerrado"));
    const lido = await chamar(orquestrador, "pane_read", { pane_id: ids[1] });
    expect(lido.erro).toBe(false);
    expect((lido.dados.lines as string[]).join("\n")).toContain("Agente 2: 1 linha, 15:02");
    expect((lido.dados.lines as string[]).join("\n")).not.toContain("\u001b");
    expect(lido.dados.state).toBe("done");
    const lista = await chamar(orquestrador, "pane_list", {});
    const fechados = (lista.dados as Array<Record<string, unknown>>).filter((p) => ids.includes(p["pane_id"] as string));
    expect(fechados).toHaveLength(3);
    expect(fechados.every((p) => p["state"] === "done" && p["closed_by"] === "auto")).toBe(true);
  });
});

const lista = async (o: Client): Promise<Array<Record<string, any>>> => (await chamar(o, "pane_list", {})).dados as Array<Record<string, any>>;
const doPane = (l: Array<Record<string, any>>, id: string): Record<string, any> | undefined => l.find((p) => p["pane_id"] === id);

describe("fechado_por: orquestrador, dono, auto e erro (por tabela)", () => {
  it("orquestrador: `pane_close` fecha o painel NA HORA (some da grade), a cauda continua legível e o estado é `closed` (fechado antes de entregar)", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    const [a] = ids as [string, string, string];
    const sessao = sessaoDe(m, a);
    m.sessoes.emitir(sessao, { tipo: "saida", dados: "parcial: procurando...\r\n" });
    const r = await chamar(orquestrador, "pane_close", { pane_id: a });
    expect(r.dados).toEqual({ ok: true });
    expect(m.sessoes.sessoes.has(sessao)).toBe(false); // painel fora da grade imediatamente
    expect(m.sessoes.fechadasPelaApp.map((f) => f.id)).toEqual([sessao]);
    expect(m.repos.pane.exigir(a).encerrado_motivo).toBe("pilot_request");
    const lido = await chamar(orquestrador, "pane_read", { pane_id: a });
    expect(lido.dados).toMatchObject({ state: "closed", closed_by: "orchestrator" });
    expect((lido.dados.lines as string[]).join("\n")).toContain("parcial: procurando...");
    expect(doPane(await lista(orquestrador), a)).toMatchObject({ state: "closed", closed_by: "orchestrator" });
    // fechar de novo é inofensivo
    expect((await chamar(orquestrador, "pane_close", { pane_id: a })).dados).toEqual({ ok: false });
  });

  it("dono: fechar o painel pelo X (descartar a sessão) guarda a cauda e marca `closed_by: owner`", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    const b = ids[1]!;
    const sessao = sessaoDe(m, b);
    m.sessoes.emitir(sessao, { tipo: "saida", dados: "o dono vai fechar isto\r\n" });
    m.panes.marcarDescartada(sessao); // o IPC `terminais:descartar` do renderer
    m.barramento.emitir("missoes:mudou", {});
    const lido = await chamar(orquestrador, "pane_read", { pane_id: b });
    expect(lido.dados).toMatchObject({ state: "closed", closed_by: "owner" });
    expect((lido.dados.lines as string[]).join("\n")).toContain("o dono vai fechar isto");
  });

  it("auto: entregou o handoff, o app fecha o painel sozinho (`done`/`auto`); o handoff continua legível por `handoff_read`", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    await entregar(m, ids[0]!, 1);
    await ate(() => m.repos.pane.exigir(ids[0]!).estado === "encerrado");
    expect(doPane(await lista(orquestrador), ids[0]!)).toMatchObject({ state: "done", closed_by: "auto" });
    const h = await chamar(orquestrador, "handoff_read", { pane_id: ids[0] });
    expect(h.erro).toBe(false);
    expect(h.dados).toMatchObject({ status: "ok", summary: "agente 1 ok", truncated: false });
    expect(h.dados.report).toContain("Agente 1: 15:01");
    expect(h.dados.report_path).toBe(`${PRODUTO.pastaNoProjeto}/relatorios/w1.md`);
  });

  it("erro: a CLI morre com código ≠ 0 SEM ninguém pedir: o painel FICA (falhou), o orquestrador recebe o aviso e `pane_list` traz `failed` + o final da saída", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador, pane } = await tresWorkers(m);
    const c = ids[2]!;
    const sessao = sessaoDe(m, c);
    m.sessoes.emitir(sessao, { tipo: "saida", dados: "Error: ECONNRESET\r\n" });
    m.sessoes.emitir(sessao, { tipo: "encerramento", codigo: 2, sinal: null });
    await ate(() => m.eventos.some((e) => e.tipo === "worker.falhou"));
    await espera(60); // mais que o prazo do fechamento automático: NÃO pode fechar
    expect(m.sessoes.sessoes.has(sessao)).toBe(true);
    expect(m.sessoes.fechadasPelaApp).toEqual([]);
    expect(m.eventos.find((e) => e.tipo === "worker.falhou")?.payload).toMatchObject({ pane_id: c, codigo: 2 });
    const item = doPane(await lista(orquestrador), c)!;
    expect(item).toMatchObject({ state: "failed", closed_by: "error", exit_code: 2 });
    expect(item["last_output"]).toContain("Error: ECONNRESET");
    // o orquestrador (ocioso) foi avisado pelo mesmo canal do wake
    const orq = m.sessoes.sessoes.get(sessaoDe(m, pane.id))!;
    await m.orq.fila.ociosa();
    expect(orq.escritas.some((e) => e.includes("[wake]") && e.includes("código 2") && e.includes(c))).toBe(true);
  });

  it("CLI sai com 0 sozinha (sem handoff): o painel fecha sozinho depois do prazo e o orquestrador é avisado de que não houve handoff", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador, pane } = await tresWorkers(m);
    const a = ids[0]!;
    const sessao = sessaoDe(m, a);
    m.sessoes.emitir(sessao, { tipo: "saida", dados: "tudo certo\r\n" });
    m.sessoes.emitir(sessao, { tipo: "encerramento", codigo: 0, sinal: null });
    await ate(() => m.sessoes.fechadasPelaApp.some((f) => f.id === sessao));
    expect(m.sessoes.sessoes.has(sessao)).toBe(false);
    expect(doPane(await lista(orquestrador), a)).toMatchObject({ state: "done", closed_by: "auto" });
    await m.orq.fila.ociosa();
    expect(m.sessoes.sessoes.get(sessaoDe(m, pane.id))!.escritas.some((e) => e.includes("sem entregar handoff"))).toBe(true);
    expect((await chamar(orquestrador, "pane_read", { pane_id: a })).dados.lines.join("\n")).toContain("tudo certo");
  });
});

describe("\"Fechar workers ao terminar\" desligado (manter abertos para inspeção)", () => {
  it("o handoff NÃO fecha o painel; o orquestrador fecha depois (`done`/`orchestrator`); saída com 0 também mantém o painel", async () => {
    const m = montar();
    await m.orq.iniciar();
    expect(m.orq.avulso.fecharWorkers(m.ws.id)).toBe(true); // padrão: ligado
    m.orq.avulso.definirFecharWorkers(m.ws.id, false);
    expect(m.orq.avulso.fecharWorkers(m.ws.id)).toBe(false);
    const { ids, orquestrador } = await tresWorkers(m);
    await entregar(m, ids[0]!, 1);
    await espera(120);
    expect(m.repos.pane.exigir(ids[0]!).estado).not.toBe("encerrado");
    expect(m.sessoes.fechadasPelaApp).toEqual([]);
    // CLI do segundo sai com 0: painel fica como "concluído"
    const s2 = sessaoDe(m, ids[1]!);
    m.sessoes.emitir(s2, { tipo: "encerramento", codigo: 0, sinal: null });
    await espera(120);
    expect(m.sessoes.sessoes.has(s2)).toBe(true);
    expect(m.sessoes.fechadasPelaApp).toEqual([]);
    // o orquestrador leu o relatório e fecha
    await chamar(orquestrador, "pane_close", { pane_id: ids[0] });
    expect(doPane(await lista(orquestrador), ids[0]!)).toMatchObject({ state: "done", closed_by: "orchestrator" });
  });

  it("religar o interruptor volta a fechar sozinho", async () => {
    const m = montar();
    await m.orq.iniciar();
    m.orq.avulso.definirFecharWorkers(m.ws.id, false);
    m.orq.avulso.definirFecharWorkers(m.ws.id, true);
    const { ids } = await tresWorkers(m);
    await entregar(m, ids[0]!, 1);
    await ate(() => m.repos.pane.exigir(ids[0]!).estado === "encerrado");
    expect(m.repos.pane.exigir(ids[0]!).encerrado_motivo).toBe("handoff_done");
  });
});

describe("handoff que falhou, 143 e cauda", () => {
  it("handoff `falhou` mantém o painel aberto (o orquestrador lê e decide) e o aviso chega ao orquestrador", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, pane } = await tresWorkers(m);
    await entregar(m, ids[0]!, 1, "failed");
    await espera(120);
    expect(m.repos.pane.exigir(ids[0]!).estado).not.toBe("encerrado");
    expect(m.sessoes.fechadasPelaApp).toEqual([]);
    await m.orq.fila.ociosa();
    expect(m.sessoes.sessoes.get(sessaoDe(m, pane.id))!.escritas.some((e) => e.includes("(falhou)"))).toBe(true);
  });

  it("o 143 de um fechamento SOLICITADO nunca vira falha: nem painel mantido, nem alerta, nem aviso ao orquestrador", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador, pane } = await tresWorkers(m);
    const a = ids[0]!;
    const sessao = sessaoDe(m, a);
    await chamar(orquestrador, "pane_close", { pane_id: a });
    // o processo só termina depois (SIGTERM → 143), marcado como solicitado pelo gerenciador
    m.sessoes.emitir(sessao, { tipo: "encerramento", codigo: 143, sinal: null, solicitado: true });
    await espera(80);
    expect(m.eventos.filter((e) => e.tipo === "worker.falhou")).toEqual([]);
    expect(doPane(await lista(orquestrador), a)).toMatchObject({ state: "closed", closed_by: "orchestrator" });
    await m.orq.fila.ociosa();
    expect(m.sessoes.sessoes.get(sessaoDe(m, pane.id))!.escritas.filter((e) => e.includes("[wake]"))).toEqual([]);
  });

  it("a cauda do worker fechado fica por 10 min e depois é descartada (`pane_read` vazio, fora de `pane_list`)", async () => {
    let t = 1_000_000;
    const m = montar({ relogio: { agora: () => t } });
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    const a = ids[0]!;
    m.sessoes.emitir(sessaoDe(m, a), { tipo: "saida", dados: "guarde isto\r\n" });
    await chamar(orquestrador, "pane_close", { pane_id: a });
    t += 599_000;
    expect((await chamar(orquestrador, "pane_read", { pane_id: a })).dados.lines.join("\n")).toContain("guarde isto");
    expect(doPane(await lista(orquestrador), a)).toBeDefined();
    t += 2_000;
    const depois = await chamar(orquestrador, "pane_read", { pane_id: a });
    expect(depois.dados.lines).toEqual([]);
    expect(doPane(await lista(orquestrador), a)).toBeUndefined();
  });

  it("a cauda é limpa de ANSI, redigida (segredo nunca fica) e limitada a 16 KB; o redator do cofre também vale", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    const a = ids[0]!;
    const sessao = sessaoDe(m, a);
    m.sessoes.emitir(sessao, { tipo: "saida", dados: "\u001b[32mapi_key=abc123SEGREDO\u001b[0m\r\nBearer abcdefghijklmnopqrstuvwxyz0123456789\r\n" });
    for (let i = 0; i < 1_500; i++) m.sessoes.emitir(sessao, { tipo: "saida", dados: `linha de enchimento número ${i} com bastante texto para passar de dezesseis kilobytes\r\n` });
    m.sessoes.emitir(sessao, { tipo: "saida", dados: "FIM-DA-SAIDA\r\n" });
    await chamar(orquestrador, "pane_close", { pane_id: a });
    const r = await chamar(orquestrador, "pane_read", { pane_id: a, last_n: 2000 });
    const texto = (r.dados.lines as string[]).join("\n");
    expect(Buffer.byteLength(texto)).toBeLessThanOrEqual(16 * 1024);
    expect(texto).toContain("FIM-DA-SAIDA");
    expect(texto).not.toContain("\u001b");
    // o segredo está no começo (já cortado), então prova a redação num worker curto
    const b = ids[1]!;
    m.sessoes.emitir(sessaoDe(m, b), { tipo: "saida", dados: "\u001b[32mapi_key=abc123SEGREDO\u001b[0m\r\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789\r\n" });
    await chamar(orquestrador, "pane_close", { pane_id: b });
    const rb = (await chamar(orquestrador, "pane_read", { pane_id: b })).dados.lines.join("\n");
    expect(rb).not.toContain("abc123SEGREDO");
    expect(rb).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(rb).toContain("[REDIGIDO]");
  });

  it("encerrar a orquestração apaga a cauda (nunca em disco): nada de conteúdo da saída sobra em dirApp nem no banco", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    m.sessoes.emitir(sessaoDe(m, ids[0]!), { tipo: "saida", dados: "TEXTO-UNICO-DA-SAIDA-123\r\n" });
    await chamar(orquestrador, "pane_close", { pane_id: ids[0] });
    const { readdirSync, statSync } = await import("node:fs");
    const varrer = (d: string): string[] => readdirSync(d).flatMap((n) => { const c = join(d, n); return statSync(c).isDirectory() ? varrer(c) : [c]; });
    for (const arq of [...varrer(m.dados), ...varrer(m.raiz)]) expect(readFileSync(arq, "utf8")).not.toContain("TEXTO-UNICO-DA-SAIDA-123");
    const banco = JSON.stringify(m.repos.pane.listarPorMissao(m.repos.pane.exigir(ids[0]!).mission_id as string));
    expect(banco).not.toContain("TEXTO-UNICO-DA-SAIDA-123");
  });
});

describe("pane_close só pelo orquestrador dono", () => {
  it("worker não tem a tool (e chamar pelo nome falha); outro orquestrador não fecha worker alheio; fechar piloto é recusado", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador, pane } = await tresWorkers(m);
    const w = await conectar(m, token(m, ids[0]!));
    expect((await w.listTools()).tools.map((t) => t.name)).toEqual(["handoff_submit"]);
    const tentativa = await chamar(w, "pane_close", { pane_id: ids[1] }).catch(() => ({ erro: true, dados: {} }));
    expect(tentativa.erro).toBe(true);
    expect(m.repos.pane.exigir(ids[1]!).estado).not.toBe("encerrado");
    // outro painel que orquestra (Missão avulsa própria)
    const outraMissao = m.orq.avulso.criarMissao({ workspace_id: m.ws.id, rotulo: "claude 15:09", permissao: "seguro" });
    const outroPane = await m.panes.abrirPane({ missao_id: outraMissao.id, cli: "claude", papel: "piloto", contexto: { avulso: true } });
    m.orq.avulso.vincularPane(outraMissao.id, outroPane.pane.id);
    const outro = await conectar(m, token(m, outroPane.pane.id));
    const alheio = await chamar(outro, "pane_close", { pane_id: ids[1] });
    expect(alheio.erro).toBe(true);
    expect(alheio.dados).toMatchObject({ code: "unauthorized" });
    expect(m.repos.pane.exigir(ids[1]!).estado).not.toBe("encerrado");
    // o próprio piloto nunca é fechado por esta tool
    const si = await chamar(orquestrador, "pane_close", { pane_id: pane.id });
    expect(si.erro).toBe(true);
    expect(si.dados).toMatchObject({ subcode: "forbidden_role" });
  });
});

describe("três workers em paralelo concluem sem serem mortos (fluxo real do MCP em processo)", () => {
  it("nenhum worker é encerrado enquanto trabalha; os três entregam handoff, o orquestrador recebe os três avisos e lê saída e relatório de cada um depois do fechamento", async () => {
    const m = montar({ atrasoFechamentoMs: 40 });
    await m.orq.iniciar();
    const { ids, orquestrador, pane, missao } = await tresWorkers(m);
    const sessoes = ids.map((id) => sessaoDe(m, id));
    // eles "trabalham" por um tempo: saída contínua, nenhuma sessão encerrada nem painel fechado
    for (let i = 0; i < 5; i++) {
      for (const [n, s] of sessoes.entries()) m.sessoes.emitir(s, { tipo: "saida", dados: `trabalhando ${n + 1} passo ${i}\r\n` });
      await espera(15);
    }
    expect(ids.every((id) => m.repos.pane.exigir(id).estado !== "encerrado")).toBe(true);
    expect(m.sessoes.fechadasPelaApp).toEqual([]);
    expect(sessoes.every((s) => m.sessoes.sessoes.get(s)?.estado === "executando")).toBe(true);
    await Promise.all(ids.map((id, i) => entregar(m, id, i + 1)));
    await m.orq.fila.ociosa();
    const avisos = m.sessoes.sessoes.get(sessaoDe(m, pane.id))!.escritas.filter((e) => e.includes("[wake]"));
    expect(avisos.join(" ")).toMatch(/agente 1 ok[\s\S]*|agente 2 ok|agente 3 ok/);
    for (const t of m.repos.task.listarPorMissao(missao.id, { limite: 20 }).itens) expect(t.estado).toBe("entregue");
    await ate(() => ids.every((id) => m.repos.pane.exigir(id).estado === "encerrado"));
    for (const [i, id] of ids.entries()) {
      const lido = await chamar(orquestrador, "pane_read", { pane_id: id });
      expect((lido.dados.lines as string[]).join("\n")).toContain(`Agente ${i + 1}: 1 linha, 15:0${i + 1}`);
      const h = await chamar(orquestrador, "handoff_read", { pane_id: id });
      expect(h.dados.report).toContain(`Agente ${i + 1}: 15:0${i + 1}`);
    }
    expect((await lista(orquestrador)).filter((p) => ids.includes(p["pane_id"]) && p["state"] === "done")).toHaveLength(3);
  }, 20_000);

  it("fechar o painel orquestrador fecha os workers que ainda vivem (`closed_by: owner`) e tira os painéis da grade", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, pane } = await tresWorkers(m);
    const sessoes = ids.map((id) => sessaoDe(m, id));
    await m.orq.portas.panes.fechar(pane.id, "painel_fechado_pelo_dono");
    await ate(() => sessoes.every((s) => !m.sessoes.sessoes.has(s)));
    expect(sessoes.every((s) => !m.sessoes.sessoes.has(s))).toBe(true);
    expect(m.sessoes.fechadasPelaApp.map((f) => f.id).sort()).toEqual([...sessoes].sort());
  });
});

describe("handoff_read", () => {
  it("worker sem handoff: `not_found` orientando a usar pane_read; escopo da Missão respeitado", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    const r = await chamar(orquestrador, "handoff_read", { pane_id: ids[0] });
    expect(r.erro).toBe(true);
    expect(r.dados).toMatchObject({ code: "not_found" });
    expect(r.dados.message).toContain("pane_read");
  });

  it("relatório grande é cortado em 32 KB (`truncated`) e redigido", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { ids, orquestrador } = await tresWorkers(m);
    const a = ids[0]!;
    const task = m.repos.task.listarPorMissao(m.repos.pane.exigir(a).mission_id as string, { limite: 20 }).itens.find((t) => t.pane_id === a)!;
    const rel = `${PRODUTO.pastaNoProjeto}/relatorios/grande.md`;
    mkdirSync(join(m.raiz, PRODUTO.pastaNoProjeto, "relatorios"), { recursive: true });
    writeFileSync(join(m.raiz, rel), `senha: hunter2hunter2\n${"x".repeat(60 * 1024)}`);
    const w = await conectar(m, token(m, a));
    expect((await chamar(w, "handoff_submit", { task_id: task.id, summary: "grande", report_path: rel, status: "ok" })).erro).toBe(false);
    const h = await chamar(orquestrador, "handoff_read", { pane_id: a });
    expect(h.dados.truncated).toBe(true);
    expect(Buffer.byteLength(h.dados.report as string)).toBeLessThanOrEqual(32 * 1024);
    expect(h.dados.report).not.toContain("hunter2hunter2");
  });
});

describe("TESTE A do coordenador: 3 workers respondem uma linha, SEM nenhuma chamada de pane_close do orquestrador", () => {
  it("(1) CLI viva esperando entrada depois do handoff, (2) CLI que entrega e sai com 0, (3) CLI que só sai com 0: os 3 painéis fecham SOZINHOS e a grade volta ao orquestrador", async () => {
    const m = montar({ atrasoFechamentoMs: 30 });
    await m.orq.iniciar();
    const { ids, orquestrador, pane } = await tresWorkers(m);
    const [viva, entregaESai, soSai] = ids as [string, string, string];
    const [sViva, sEntregaESai, sSoSai] = ids.map((id) => sessaoDe(m, id)) as [string, string, string];
    // o orquestrador (LLM) NÃO fecha nada: o espião vigia a tool
    const chamadasDeClose: unknown[] = [];
    const chamarOriginal = orquestrador.callTool.bind(orquestrador);
    (orquestrador as { callTool: Client["callTool"] }).callTool = ((p: { name: string }, ...r: unknown[]) => { if (p.name === "pane_close") chamadasDeClose.push(p); return (chamarOriginal as (...a: unknown[]) => unknown)(p, ...r); }) as Client["callTool"];

    // 1) imprime uma linha, entrega o handoff e PERMANECE VIVA (CLI interativa que não encerra sozinha)
    await entregar(m, viva, 1);
    // 2) imprime, entrega e a CLI sai com 0
    await entregar(m, entregaESai, 2);
    m.sessoes.emitir(sEntregaESai, { tipo: "encerramento", codigo: 0, sinal: null });
    // 3) imprime e sai com 0, sem handoff
    m.sessoes.emitir(sSoSai, { tipo: "saida", dados: "Agente 3: 1 linha, 15:03\r\n" });
    m.sessoes.emitir(sSoSai, { tipo: "encerramento", codigo: 0, sinal: null });

    await ate(() => [sViva, sEntregaESai, sSoSai].every((s) => !m.sessoes.sessoes.has(s)), 4_000);
    expect([sViva, sEntregaESai, sSoSai].every((s) => !m.sessoes.sessoes.has(s))).toBe(true); // grade vazia de workers: só o orquestrador sobra
    expect(m.sessoes.sessoes.has(sessaoDe(m, pane.id))).toBe(true);
    expect(m.sessoes.fechadasPelaApp.map((f) => f.id).sort()).toEqual([sViva, sEntregaESai, sSoSai].sort());
    expect(m.sessoes.fechadasPelaApp.every((f) => f.solicitado)).toBe(true); // a viva foi encerrada pelo app (sem "código 143")
    expect(chamadasDeClose).toEqual([]);
    expect(ids.every((id) => m.repos.pane.exigir(id).encerrado_motivo !== "pilot_request")).toBe(true);
    const l = await lista(orquestrador);
    expect(ids.map((id) => doPane(l, id))).toEqual([
      expect.objectContaining({ state: "done", closed_by: "auto" }),
      expect.objectContaining({ state: "done", closed_by: "auto" }),
      expect.objectContaining({ state: "done", closed_by: "auto" }),
    ]);
    // a saída e o relatório continuam legíveis para integrar
    expect((await chamar(orquestrador, "pane_read", { pane_id: viva })).dados.lines.join("\n")).toContain("Agente 1: 1 linha, 15:01");
    expect((await chamar(orquestrador, "pane_read", { pane_id: soSai })).dados.lines.join("\n")).toContain("Agente 3: 1 linha, 15:03");
    expect((await chamar(orquestrador, "handoff_read", { pane_id: entregaESai })).dados.report).toContain("Agente 2: 15:02");
    // sem a ação de ninguém, o orquestrador soube dos três (dois handoffs e o "saiu sem handoff")
    await m.orq.fila.ociosa();
    // o orquestrador acorda a cada aviso e volta a ficar ocioso: cada volta entrega o próximo
    for (let i = 0; i < 3; i++) {
      m.sessoes.emitir(sessaoDe(m, pane.id), { tipo: "atividade", atividade: "trabalhando" });
      m.sessoes.emitir(sessaoDe(m, pane.id), { tipo: "atividade", atividade: "pronto" });
      await m.orq.fila.ociosa();
    }
    const avisos = m.sessoes.sessoes.get(sessaoDe(m, pane.id))!.escritas.filter((e) => e.includes("[wake]")).join(" | ");
    expect(avisos).toContain("agente 1 ok");
    expect(avisos).toContain("agente 2 ok");
    expect(avisos).toContain("sem entregar handoff");
  }, 20_000);

  it("handoff entregue com o worker ainda NO MEIO do turno (trabalhando): o app espera o turno acabar (período de graça) e só então fecha", async () => {
    const m = montar({ atrasoFechamentoMs: 10, gracaTurnoMs: 5_000 });
    await m.orq.iniciar();
    const { ids } = await tresWorkers(m);
    const a = ids[0]!;
    const sessao = sessaoDe(m, a);
    m.sessoes.emitir(sessao, { tipo: "atividade", atividade: "trabalhando" });
    await entregar(m, a, 1);
    await espera(300); // bem além do atraso de 10 ms: continua aberto porque o turno não acabou
    expect(m.repos.pane.exigir(a).estado).toBe("trabalhando");
    expect(m.sessoes.sessoes.has(sessao)).toBe(true);
    m.sessoes.emitir(sessao, { tipo: "atividade", atividade: "pronto" }); // fim do turno (Stop)
    await ate(() => !m.sessoes.sessoes.has(sessao), 3_000);
    expect(m.sessoes.sessoes.has(sessao)).toBe(false);
    expect(m.repos.pane.exigir(a).estado).toBe("encerrado");
  }, 20_000);

  it("a graça tem teto: CLI que nunca sai de `trabalhando` é fechada ao fim dele (nunca fica aberta para sempre)", async () => {
    const m = montar({ atrasoFechamentoMs: 10, gracaTurnoMs: 120 });
    await m.orq.iniciar();
    const { ids } = await tresWorkers(m);
    const a = ids[0]!;
    const sessao = sessaoDe(m, a);
    m.sessoes.emitir(sessao, { tipo: "atividade", atividade: "trabalhando" });
    await entregar(m, a, 1);
    await ate(() => !m.sessoes.sessoes.has(sessao), 3_000);
    expect(m.sessoes.sessoes.has(sessao)).toBe(false);
  }, 20_000);
});
