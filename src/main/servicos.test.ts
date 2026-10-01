import { appendFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE } from "../compartilhado/ipc";
import { criarIndexador } from "../nucleo/metodo/indexador";
import { criarArmazemLayout } from "../nucleo/terminais/layout";
import { criarRepoGit, criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { gerarProjetoExpx } from "../../tests/fixtures/metodo/gerar";
import { criarBarramento } from "./barramento";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./ipc/registro";
import { registrarServicosDominio, type DependenciasServicosDominio } from "./servicos";

afterEach(limpar);

const aguardar = (ms: number) => new Promise((r) => setTimeout(r, ms));
// espera por evento real (fs.watch): o limite é só "não travou", não um orçamento (a suíte roda sob carga)
async function ate(cond: () => boolean, limiteMs = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > limiteMs) throw new Error("tempo esgotado esperando a condição");
    await aguardar(10);
  }
}

/**
 * O coalescer do domínio usa um atraso tão longo que o relógio real NUNCA dispara dentro do teste: quem entrega é
 * `entregar(m)` (barramento.descarregar). Assim "uma rajada = um evento" não depende de quanto a máquina demora entre
 * duas chamadas (o teste antigo, com 120 ms reais, falhava sob carga).
 */
const ATRASO_NUNCA_MS = 600_000;
const proximoTurno = () => new Promise<void>((r) => setImmediate(r));
/** deixa as continuações assíncronas (workspaces.estado().then) agendarem o coalescido e então o entrega. */
async function entregar(m: { barramento: { descarregar(): void } }): Promise<void> {
  for (let i = 0; i < 5; i++) await proximoTurno();
  m.barramento.descarregar();
}
/** espera a condição entregando o que estiver pendente a cada volta (eventos vindos de watchers reais). */
async function ateEntregue(m: { barramento: { descarregar(): void } }, cond: () => boolean): Promise<void> {
  await ate(() => { m.barramento.descarregar(); return cond(); });
}

function ipcFalso() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: (c) => void handlers.delete(c), removeAllListeners: () => undefined };
  return { ipc, handlers };
}

function montar(opcoes: { ferramentas?: ReturnType<typeof ferramenta>[]; autorizado?: boolean; banco?: ReturnType<typeof novoBanco>; dados?: string; sessoes?: ReturnType<typeof sessoesFalsas>; escolha?: string | null } = {}) {
  const { ipc, handlers } = ipcFalso();
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => opcoes.autorizado ?? true });
  const { banco } = opcoes.banco ?? novoBanco();
  const dados = opcoes.dados ?? criarTmp("dados-");
  const sessoes = opcoes.sessoes ?? sessoesFalsas();
  const emitidos: Array<{ canal: string; payload: unknown }> = [];
  const pedidoSessoes = vi.fn(async () => sessoes as never);
  const indexador = criarIndexador();
  const cliente = { indexar: vi.fn((r: string) => indexador.indexar(r)), descartar: vi.fn(async (r: string) => indexador.descartar(r)), encerrar: vi.fn(async () => undefined) };
  const criarCliente = vi.fn(() => cliente as never);
  const avisos: string[] = [];
  const barramento = criarBarramento();
  const deps: DependenciasServicosDominio = {
    registro, banco, barramento, sessoes: pedidoSessoes, detector: detectorFalso(opcoes.ferramentas),
    pastaDeDados: dados, escolherPasta: async () => opcoes.escolha ?? null,
    emitir: (canal, payload) => void emitidos.push({ canal, payload }),
    criarClienteWorker: criarCliente, aviso: (m) => void avisos.push(m), atrasoCoalescerMs: ATRASO_NUNCA_MS, debounceMetodoMs: 60, atrasosRestauracaoMs: [],
  };
  const dominio = registrarServicosDominio(deps);
  const invocar = (canal: string, payload?: unknown) => (handlers.get(canal) as (e: unknown, p?: unknown) => Promise<unknown>)({}, payload);
  const eventos = (canal: string) => emitidos.filter((e) => e.canal === canal).map((e) => e.payload);
  return { dominio, barramento, registro, invocar, emitidos, eventos, pedidoSessoes, criarCliente, cliente, sessoes, dados, avisos, banco, handlers };
}

describe("registro dos canais", () => {
  it("registra TODOS os canais workspaces:*, provedores:*, missoes:* e metodo:* do contrato", () => {
    const { registro } = montar();
    const esperados = CANAIS_INVOKE.filter((c) => /^(workspaces|provedores|missoes|metodo):(?!openrouter_)/.test(c));
    expect(registro.registrados().filter((c) => /^(workspaces|provedores|missoes|metodo):(?!openrouter_)/.test(c))).toEqual([...esperados].sort());
  });

  it("onda 1: registrar não abre worker, watcher nem pede o gerenciador de sessões", () => {
    const m = montar();
    expect(m.criarCliente).not.toHaveBeenCalled();
    expect(m.pedidoSessoes).not.toHaveBeenCalled();
    expect(m.eventos("workspaces:mudou")).toEqual([]);
  });

  it("remetente indevido é recusado em todos os canais de domínio", async () => {
    const m = montar({ autorizado: false });
    await expect(m.invocar("workspaces:estado")).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:detalhe", { mission_id: "mis_01J8ZXAMPLE0000000000000A1" })).rejects.toBeInstanceOf(CanalRecusadoErro);
  });
});

describe("eventos coalescidos", () => {
  it("workspaces:mudou: abrir duas pastas seguidas entrega UM evento com o estado final", async () => {
    const m = montar();
    const a = criarTmp();
    const b = criarTmp();
    await m.invocar("workspaces:abrir", { caminho: a });
    await m.invocar("workspaces:abrir", { caminho: b });
    await entregar(m);
    const ev = m.eventos("workspaces:mudou") as Array<{ atual: { raiz: string }; recentes: unknown[] }>;
    expect(ev).toHaveLength(1);
    expect(ev[0]?.atual.raiz).toBe(b);
    expect(ev[0]?.recentes).toHaveLength(2);
  });

  it("missoes:mudou: criar Missão avisa com workspace e Missão; várias na rajada viram mission_id null", async () => {
    const m = montar();
    const ws = (await m.invocar("workspaces:abrir", { caminho: criarTmp() })) as { id: string };
    const criada = (await m.invocar("missoes:criar", { workspace_id: ws.id, modo: "livre", origem: "livre", titulo: "A", pedido: "", clis: {} })) as { id: string };
    await entregar(m);
    expect(m.eventos("missoes:mudou")[0]).toEqual({ workspace_id: ws.id, mission_id: criada.id });
    m.emitidos.length = 0;
    const b = (await m.invocar("missoes:criar", { workspace_id: ws.id, modo: "livre", origem: "livre", titulo: "B", pedido: "", clis: {} })) as { id: string };
    await m.invocar("missoes:abortar", { mission_id: criada.id });
    await entregar(m);
    const ev = m.eventos("missoes:mudou") as Array<{ mission_id: string | null }>;
    expect(ev).toHaveLength(1);
    expect(ev[0]?.mission_id).toBeNull();
    expect(b.id).not.toBe(criada.id);
  });

  it("eventos de domínio vão ao barramento (mission.created / mission.closed)", async () => {
    const m = montar();
    const visto: Array<{ tipo: string; payload: Record<string, unknown> }> = [];
    for (const tipo of ["mission.created", "mission.closed"]) m.barramento.assinar<Record<string, unknown>>(tipo, (payload) => void visto.push({ tipo, payload }));
    const ws = (await m.invocar("workspaces:abrir", { caminho: criarTmp() })) as { id: string };
    const mis = (await m.invocar("missoes:criar", { workspace_id: ws.id, modo: "livre", origem: "livre", titulo: "A", pedido: "", clis: {} })) as { id: string };
    await m.invocar("missoes:abortar", { mission_id: mis.id });
    expect(visto.map((v) => v.tipo)).toEqual(["mission.created", "mission.closed"]);
    expect(visto[1]?.payload).toMatchObject({ mission_id: mis.id, estado: "abortada" });
  });
});

describe("fluxo ponta a ponta pelos canais", () => {
  it("criar Missão de feature em repo git: worktree, Pane no worktree e comando do método", async () => {
    const m = montar();
    const { raiz, pai } = criarRepoGit();
    const ws = (await m.invocar("workspaces:abrir", { caminho: raiz })) as { id: string; e_git: boolean };
    expect(ws.e_git).toBe(true);
    const mis = (await m.invocar("missoes:criar", { workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "Cobrança via PIX", pedido: "cobrar por pix", clis: { piloto: "claude" } })) as { id: string; worktree: string; branch: string };
    expect(mis).toMatchObject({ worktree: "../repo--cobranca-via-pix", branch: "feature/cobranca-via-pix" });
    expect(existsSync(join(pai, "repo--cobranca-via-pix"))).toBe(true);
    const sessao = [...m.sessoes.sessoes.values()][0];
    expect(sessao?.cwd).toBe(join(pai, "repo--cobranca-via-pix"));
    expect(sessao?.pedido["prompt_inicial"]).toBe("/expx:sprintx cobrar por pix");
    const det = (await m.invocar("missoes:detalhe", { mission_id: mis.id })) as { panes: unknown[] };
    expect(det.panes).toHaveLength(1);
    const lista = (await m.invocar("missoes:listar", { workspace_id: ws.id, estado: null, depois: null })) as { itens: unknown[] };
    expect(lista.itens).toHaveLength(1);
    await m.dominio.encerrar();
  });

  it("provedores: criar conta cria o config dir na pasta de dados e listar mostra as CLIs", async () => {
    const m = montar();
    const conta = (await m.invocar("provedores:contas_criar", { provedor: "claude", rotulo: "Pessoal" })) as { id: string; config_dir_ref: string };
    expect(existsSync(join(m.dados, conta.config_dir_ref))).toBe(true);
    const lista = (await m.invocar("provedores:listar", { forcar: false })) as Array<{ ferramenta: { id: string }; contas: unknown[] }>;
    expect(lista.find((p) => p.ferramenta.id === "claude")?.contas).toHaveLength(1);
    const off = (await m.invocar("provedores:contas_habilitar", { conta_id: conta.id, habilitada: false })) as { habilitada: boolean };
    expect(off.habilitada).toBe(false);
    expect(JSON.parse(((await m.invocar("provedores:diagnostico")) as { texto: string }).texto).contas.por_provedor.claude).toEqual({ total: 1, habilitadas: 0 });
  });

  it("método: metodo:estado indexa sob demanda; metodo:disparar abre o Pane com o comando", async () => {
    const m = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const ws = (await m.invocar("workspaces:abrir", { caminho: raiz })) as { id: string };
    const estado = (await m.invocar("metodo:estado", { workspace_id: ws.id })) as { trabalhos: Array<{ id: string }> };
    expect(estado.trabalhos.map((t) => t.id)).toContain("cobranca-pix");
    const r = (await m.invocar("metodo:disparar", { workspace_id: ws.id, trabalho_id: "cobranca-pix", gesto: "retomar", argumento: null, pane_id: null })) as { ok: boolean; comando: string };
    expect(r).toMatchObject({ ok: true, comando: "/expx:sprintx cobranca-pix" });
    const sug = (await m.invocar("metodo:comando_sugerido", { workspace_id: ws.id, trabalho_id: "cobranca-pix", gesto: "auditar", argumento: null })) as { pane_separado: boolean };
    expect(sug.pane_separado).toBe(true);
    const rastro = (await m.invocar("metodo:rastro", { workspace_id: ws.id, trabalho_id: "cobranca-pix", depois: 0 })) as { eventos: unknown[]; proximo: number };
    expect(rastro.proximo).toBe(6);
    expect(await m.invocar("metodo:estado", { workspace_id: "ws_01J8ZXAMPLE0000000000000A1" })).toBeNull();
    await m.dominio.encerrar();
  });
});

describe("iniciar (onda 2) e encerrar", () => {
  it("iniciar religa os Panes (sessão morta vira encerrado) e observa o workspace atual", async () => {
    const primeira = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const ws = (await primeira.invocar("workspaces:abrir", { caminho: raiz })) as { id: string };
    const p = await primeira.dominio.panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    const layout = criarArmazemLayout(primeira.dados, ws.id);
    layout.gravar({ versao: 2, ativa: p.sessao_id, abas: [{ arvore: { tipo: "terminal", sessao_id: p.sessao_id } }], fixadas: [] });
    // reabre o app: mesmo banco e dados; o daemon não tem mais a sessão
    const segunda = montar({ banco: { banco: primeira.banco, repos: primeira.dominio.repos }, dados: primeira.dados });
    await segunda.dominio.iniciar();
    expect(segunda.dominio.repos.pane.exigir(p.pane.id)).toMatchObject({ estado: "encerrado", encerrado_motivo: "sessao_morreu" });
    expect(criarArmazemLayout(primeira.dados, ws.id).ler()?.abas).toEqual([]);
    expect(segunda.criarCliente).toHaveBeenCalledTimes(1);
    expect(segunda.dominio.gerenciadorMetodo.estado(ws.id)?.trabalhos.length).toBeGreaterThan(5);
    await segunda.dominio.encerrar();
    await primeira.dominio.encerrar();
  });

  it("tocar arquivo do método depois de iniciar emite metodo:mudou (resumo) ao renderer", async () => {
    const m = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await m.invocar("workspaces:abrir", { caminho: raiz });
    await m.dominio.iniciar();
    appendFileSync(join(raiz, "docs/sprintx/features/cobranca-pix/sprint-01/tasks.md"), "\n<!-- toque -->\n");
    await ateEntregue(m, () => m.eventos("metodo:mudou").length > 0);
    expect(m.eventos("metodo:mudou")[0]).toMatchObject({ trabalhos: expect.any(Number), violacoes: expect.any(Number), gerado_em: expect.any(String) });
    await m.dominio.encerrar();
  });

  it("trocar de workspace solta o método do anterior (sem watcher sobrando)", async () => {
    const m = montar();
    const a = criarTmp();
    const b = criarTmp();
    gerarProjetoExpx(a);
    gerarProjetoExpx(b);
    const wa = (await m.invocar("workspaces:abrir", { caminho: a })) as { id: string };
    await m.dominio.iniciar();
    expect(m.dominio.gerenciadorMetodo.estado(wa.id)).not.toBeNull();
    const wb = (await m.invocar("workspaces:abrir", { caminho: b })) as { id: string };
    await ate(() => m.dominio.gerenciadorMetodo.estado(wb.id) !== null);
    expect(m.dominio.gerenciadorMetodo.estado(wa.id)).toBeNull();
    await m.dominio.encerrar();
  });

  it("encerrar libera worker e watchers e é idempotente; depois nada emite", async () => {
    const m = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await m.invocar("workspaces:abrir", { caminho: raiz });
    await m.dominio.iniciar();
    await m.dominio.encerrar();
    await m.dominio.encerrar();
    expect(m.cliente.encerrar).toHaveBeenCalledTimes(1);
    m.emitidos.length = 0;
    appendFileSync(join(raiz, "docs/sprintx/features/cobranca-pix/00-DECISOES.md"), "\n<!-- x -->");
    await aguardar(400);
    m.barramento.descarregar(); // se algo estivesse pendente, sairia agora
    expect(m.emitidos).toEqual([]);
  });

  it("falha de um serviço da onda 2 não impede o outro e vira aviso", async () => {
    const sessoes = sessoesFalsas();
    sessoes.recuperar = async () => { throw new Error("daemon fora"); };
    const m = montar({ sessoes });
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await m.invocar("workspaces:abrir", { caminho: raiz });
    await m.dominio.iniciar();
    expect(m.dominio.gerenciadorMetodo.estado((await m.dominio.workspaces.estado()).atual?.id as string)).not.toBeNull();
    await m.dominio.encerrar();
  });
});
