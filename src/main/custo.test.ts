import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { NaoEncontradoErro } from "../nucleo/dominio";
import type { IndiceProjeto } from "../nucleo/metodo/tipos";
import type { EventoCusto } from "../compartilhado/custo";
import type { PortaDelegar } from "../nucleo/board";
import { criarBarramento, type Agendador } from "./barramento";
import { ligarCusto, sanearErroDeCusto, type LigacaoCusto } from "./custo";

const abertos: Banco[] = [];
const pastas: string[] = [];
afterEach(() => {
  abertos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
const AGORA = new Date("2026-06-10T12:00:00.000Z");

function agendadorFalso() {
  const tarefas: Array<{ fn: () => void; ativa: boolean }> = [];
  const agendador: Agendador = { setTimeout: (fn) => (tarefas.push({ fn, ativa: true }), tarefas.length - 1), clearTimeout: (id) => void (tarefas[id as number] && ((tarefas[id as number] as { ativa: boolean }).ativa = false)) };
  return { agendador, correr: () => tarefas.filter((t) => t.ativa).forEach((t) => ((t.ativa = false), t.fn())) };
}
const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, titulo: `T ${id}`, fase: "F1", status, depende_de: [], paralelizavel: false, suite: "nao_executada", concluida_em: null, objetivo: "obj", criterio_aceite: "crit", teste_integracao: null, teste_funcional: null, teste_regressao: null, arquivo: `docs/sprintx/${id}.md`, duracao_observada_ms: null, ...extra });
function indice(tasks: ReturnType<typeof task>[], extra: Record<string, unknown> = {}): IndiceProjeto {
  return { trabalhos: [{ id: "w1", tipo: "feature", titulo: "Trabalho 1", veredito_qa: null, veredito_auditoria: null, violacoes: [], ultima_atividade: "2026-06-10T00:00:00.000Z", sprints: [{ id: "s1", fases: [{ id: "F1", tasks }] }], ...extra }] } as unknown as IndiceProjeto;
}

function montar(opc: { tasks?: ReturnType<typeof task>[]; raiz?: string; delegar?: PortaDelegar | null; rastro?: Array<Record<string, unknown>> } = {}) {
  const banco = abrirBanco(":memory:");
  abertos.push(banco);
  migrar(banco);
  const r = criarRepositorios(banco);
  const ws = r.workspace.criar({ nome: "w", raiz: opc.raiz ?? "/w" });
  const mis = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M1", trabalho_id: "w1" });
  const exec = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", papel: "executor" });
  const { agendador, correr } = agendadorFalso();
  const barramento = criarBarramento(agendador);
  const rendererEventos: Array<{ canal: string; payload: unknown }> = [];
  const tasks = opc.tasks ?? [task("T-01.01", "concluida"), task("T-01.02", "pendente"), task("T-01.03", "pendente", { depende_de: ["T-01.02"] })];
  const metodoChamadas = { garantir: 0, indices: 0 };
  const l: LigacaoCusto = ligarCusto({
    banco,
    workspace: (id) => {
      if (id !== ws.id) throw new NaoEncontradoErro("Workspace", id);
      return { id: ws.id, raiz: opc.raiz ?? "/w" };
    },
    metodo: {
      garantir: async () => void metodoChamadas.garantir++,
      indices: async () => (metodoChamadas.indices++, new Map([[opc.raiz ?? "/w", indice(tasks)]])),
      rastro: async () => ({ eventos: (opc.rastro ?? []) as never, proximo: 0 }),
    },
    barramento,
    emitirRenderer: (canal, payload) => void rendererEventos.push({ canal, payload }),
    abrirCaminho: async () => true,
    relogio: () => AGORA,
    ...(opc.delegar === undefined ? {} : { delegar: () => opc.delegar as PortaDelegar | null }),
  });
  return { banco, r, ws, mis, exec, l, barramento, correr, rendererEventos, metodoChamadas };
}
const tk = (entrada: number, saida = 0) => ({ entrada, cache_escrita: 0, cache_leitura: 0, saida });

describe("ligação do custo", () => {
  it("nada nasce no boot: sem uso, nenhum preço semeado nem assinatura de ingestão até iniciar/usar", () => {
    const m = montar();
    expect(m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM preco_modelo")?.n).toBe(0);
    m.l.servico();
    expect(m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM preco_modelo")?.n).toBeGreaterThan(0);
  });
  it("usage.observed do proxy vira registro medido e chega ao renderer coalescido (1 evento para a rajada)", () => {
    const m = montar();
    m.l.iniciar();
    m.l.iniciar(); // idempotente: não assina duas vezes
    for (let i = 0; i < 50; i++) m.barramento.emitir("usage.observed", { pane_id: m.exec.id, provedor: "openrouter", modelo: "v/m", tokens_in: 10, tokens_out: 5, usd: 0.01, ts: `2026-06-10T10:00:${String(i).padStart(2, "0")}.000Z`, id: `g${i}` });
    expect(m.l.resumo({ escopo: "pane", chave: m.exec.id })).toMatchObject({ registros: 50, aproximado: false });
    expect((m.l.resumo({ escopo: "pane", chave: m.exec.id }) as { usd: number }).usd).toBeCloseTo(0.5, 6);
    m.barramento.descarregar();
    const atualizados = m.rendererEventos.filter((e) => (e.payload as EventoCusto).tipo === "atualizado");
    expect(atualizados).toHaveLength(1);
    expect(((atualizados[0]?.payload as EventoCusto).escopos ?? []).some((e) => e.escopo === "pane" && e.chave === m.exec.id)).toBe(true);
  });
  it("payload inválido de usage.observed é ignorado sem lançar nem criar o serviço", () => {
    const m = montar();
    m.l.iniciar();
    m.barramento.emitir("usage.observed", { pane_id: 1 });
    m.barramento.emitir("usage.observed", null);
    expect(m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n).toBe(0);
  });
  it("teto: aviso ao renderer e domínio, uma vez; evento fica no log de domínio sem conteúdo", () => {
    const m = montar();
    const s = m.l.servico();
    const f = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "a.jsonl", pane_id: m.exec.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    m.l.tetoGravar(m.mis.id, 1);
    s.ingerir(f.id, [{ chave: "a", ts: "2026-06-10T10:00:00.000Z", modelo: "claude-sonnet-4-5", tokens: tk(1_000_000) }]);
    s.ingerir(f.id, [{ chave: "b", ts: "2026-06-10T10:01:00.000Z", modelo: "claude-sonnet-4-5", tokens: tk(1_000_000) }]);
    expect(m.rendererEventos.filter((e) => (e.payload as EventoCusto).tipo === "teto")).toHaveLength(1);
    expect(m.banco.consultar<{ tipo: string }>("SELECT tipo FROM evento_dominio WHERE tipo = 'cost.ceiling_reached'")).toHaveLength(1);
  });
  it("erros: domínio e ErroBoard passam nominais; o resto vira texto genérico sem caminho", () => {
    expect(sanearErroDeCusto(new NaoEncontradoErro("Mission", "x")).message).toMatch(/^not_found: /);
    expect(sanearErroDeCusto(new Error("falhou em /Users/fulano/segredo")).message).toBe("unavailable: falha ao executar a operação de custo");
    const m = montar();
    expect(() => m.l.resumo({ escopo: "workspace", chave: "ws_nao_existe0000" })).toThrow(NaoEncontradoErro);
    expect(() => m.l.resumo({ escopo: "sprint", chave: "x" })).toThrow();
  });
  it("preços: gravar, listar, apagar e reprecificar com simulação; config e teto validados", () => {
    const m = montar();
    const p = m.l.precoGravar({ padrao: "meu-*", entrada_por_mtok: 1, saida_por_mtok: 2 });
    expect(m.l.precosListar().some((x) => x.id === p.id)).toBe(true);
    expect(m.l.reprecificar({ simular: true })).toEqual({ registros_reprecificados: 0 });
    expect(m.l.precoApagar(p.id)).toEqual({ ok: true });
    expect(m.l.configLer()).toMatchObject({ retencao_bruta_dias: 90, teto_padrao_missao_usd: null });
    expect(m.l.configGravar({ ...m.l.configLer(), cambio_brl: 5.5 }).cambio_brl).toBe(5.5);
    expect(m.l.configLer().cambio_brl).toBe(5.5);
    expect(() => m.l.tetoGravar(m.mis.id, 0)).toThrow();
    expect(m.l.diagnostico().texto).toContain("registros brutos");
  });
  it("porta da Fase 18 devolve null sem dado e tokens quando há", async () => {
    const m = montar();
    expect(await m.l.paraAgil().janelas(m.ws.id, "w1", "T-01.01")).toBeNull();
  });
  it("porta da Fase 18: colunas e limite de WIP do board", async () => {
    const m = montar();
    const porta = m.l.paraAgil();
    expect(await porta.colunas(m.ws.id)).toEqual(["backlog", "a_fazer", "em_andamento", "em_revisao", "concluido", "validado"]);
    expect(await porta.limiteWip(m.ws.id, "em_andamento")).toBeNull();
    m.l.board().configGravar(m.ws.id, { wip: { em_andamento: 4 } });
    expect(await porta.limiteWip(m.ws.id, "em_andamento")).toBe(4);
    expect(await porta.limiteWip(m.ws.id, "coluna_inexistente")).toBeNull();
  });
  it("custo da sprint sem tabelas/itens: sem custo, nunca 0", () => {
    const m = montar();
    expect(m.l.custoSprint(m.ws.id, "sp1")).toMatchObject({ itens: 0, custo: { usd: null } });
    m.banco.executar("DROP TABLE agil_sprint_item");
    expect(m.l.custoSprint(m.ws.id, "sp1").itens).toBe(0);
  });
  it("previsão de período por workspace usa o agregado (sem base ⇒ null)", () => {
    const m = montar();
    expect(m.l.previsaoPeriodo(m.ws.id, "2026-06-01", "2026-06-30")).toMatchObject({ base: "sem_base", projecao_fim_periodo_usd: null });
  });
});

describe("board no main", () => {
  const filtros = (ws: string) => ({ workspace_id: ws });
  it("snapshot: colunas do método; repetido sem mudança devolve o MESMO objeto (sem recomputar o disco); evento invalida e coalesce (500 toques = 1 board:evento)", async () => {
    const m = montar();
    const a = await m.l.board().snapshot(filtros(m.ws.id));
    expect(a.colunas.concluido.map((c) => c.task_id)).toEqual(["T-01.01"]);
    expect(a.colunas.a_fazer.map((c) => c.task_id)).toEqual(["T-01.02"]);
    expect(a.colunas.backlog.map((c) => c.task_id)).toEqual(["T-01.03"]);
    const b = await m.l.board().snapshot(filtros(m.ws.id));
    expect(b).toBe(a);
    expect(m.metodoChamadas.indices).toBe(1);
    for (let i = 0; i < 500; i++) m.barramento.emitir("metodo:mudou", { workspace_id: m.ws.id });
    for (let i = 0; i < 500; i++) m.barramento.emitirCoalescido("x", "y", i, 300); // ruído irrelevante
    m.barramento.descarregar();
    expect(m.rendererEventos.filter((e) => e.canal === "board:evento")).toHaveLength(1);
    const c = await m.l.board().snapshot(filtros(m.ws.id));
    expect(c).not.toBe(a);
    expect(c.versao).toBeGreaterThan(a.versao);
    expect(m.metodoChamadas.indices).toBe(2);
  });
  it("cost.updated também invalida o board; custo do card entra pelo agregado", async () => {
    const m = montar();
    const s = m.l.servico();
    const t = m.r.task.criar({ mission_id: m.mis.id, task_ref: "T-01.02", titulo: "x", papel: "executor" });
    m.r.task.mudarEstado(t.id, "reivindicada", { pane_id: m.exec.id });
    m.banco.executar("UPDATE task SET reivindicada_em = '2026-06-10T09:00:00.000Z' WHERE id = ?", [t.id]);
    s.sincronizarJanelasDoBanco(m.ws.id, "w1");
    const f = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "a.jsonl", pane_id: m.exec.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    const antes = await m.l.board().snapshot(filtros(m.ws.id));
    s.ingerir(f.id, [{ chave: "a", ts: "2026-06-10T10:00:00.000Z", modelo: "claude-sonnet-4-5", tokens: tk(1_000_000) }]);
    const depois = await m.l.board().snapshot(filtros(m.ws.id));
    expect(depois).not.toBe(antes);
    const card = depois.colunas.em_andamento.find((c) => c.task_id === "T-01.02");
    expect(card).toMatchObject({ coluna: "em_andamento", custo: { usd: 3, aproximado: true }, executor: { cli: "claude" } });
    expect(depois.custo.usd).toBe(3);
  });
  it("sem workspace_id o snapshot é recusado; workspace inexistente é not_found", async () => {
    const m = montar();
    await expect(m.l.board().snapshot({ workspace_id: null })).rejects.toMatchObject({ codigo: "invalid" });
    await expect(m.l.board().snapshot({ workspace_id: "ws_naoexiste00000" })).rejects.toBeInstanceOf(NaoEncontradoErro);
  });
  it("detalhe: contrato, custo por modelo, painel de movimentos derivados e rastro sem caminho absoluto", async () => {
    const m = montar({ rastro: [{ ts: "2026-06-10T09:00:00.000Z", evento: "task_iniciada", task: "T-01.02", detalhe: "abriu /Users/x/p/y" }] });
    const d = await m.l.board().cardDetalhe({ workspace_id: m.ws.id, trabalho_id: "w1", task_id: "T-01.02" });
    expect(d.card).toMatchObject({ task_id: "T-01.02", coluna: "a_fazer", selos: ["pronta"] });
    expect(d.contrato).toMatchObject({ objetivo: "obj", criterio_aceite: "crit" });
    expect(d.movimentos[0]).toMatchObject({ para: "em_andamento", permitido: true, acao: "delegar", grava_no_metodo: false });
    expect(d.movimentos[0]?.comando).toBe("/expx:sprintx w1");
    expect(JSON.stringify(d)).not.toContain("/Users/");
    expect(d.custo).toMatchObject({ usd: null, registros: 0 });
    await expect(m.l.board().cardDetalhe({ workspace_id: m.ws.id, trabalho_id: "w1", task_id: "ZZ" })).rejects.toMatchObject({ codigo: "not_found" });
  });
  it("abrir arquivo: abre só sob docs/ do worktree; fora de docs, extensão e symlink recusados", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "expxv-custo-"));
    pastas.push(raiz);
    mkdirSync(join(raiz, "docs", "sprintx"), { recursive: true });
    writeFileSync(join(raiz, "docs", "sprintx", "T-01.01.md"), "x");
    writeFileSync(join(raiz, "docs", "sprintx", "T-01.02.exe"), "x");
    const abrir = vi.fn(async () => true);
    const m = montar({ raiz, tasks: [task("T-01.01", "concluida"), task("T-01.02", "pendente", { arquivo: "docs/sprintx/T-01.02.exe" }), task("T-01.03", "pendente", { arquivo: "../fora.md" }), task("T-01.04", "pendente", { arquivo: "segredo.md" })] });
    const l = ligarCusto({ banco: m.banco, workspace: () => ({ id: m.ws.id, raiz }), metodo: { indices: async () => new Map([[raiz, indice([task("T-01.01", "concluida"), task("T-01.02", "pendente", { arquivo: "docs/sprintx/T-01.02.exe" }), task("T-01.03", "pendente", { arquivo: "../fora.md" }), task("T-01.04", "pendente", { arquivo: "segredo.md" })])]]), rastro: async () => ({ eventos: [], proximo: 0 }) }, barramento: m.barramento, emitirRenderer: () => undefined, abrirCaminho: abrir });
    const p = (t: string) => ({ workspace_id: m.ws.id, trabalho_id: "w1", task_id: t });
    expect(await l.board().abrirArquivo(p("T-01.01"))).toEqual({ ok: true });
    expect(abrir).toHaveBeenCalledTimes(1);
    for (const t of ["T-01.02", "T-01.03", "T-01.04"]) await expect(l.board().abrirArquivo(p(t))).rejects.toMatchObject({ codigo: "forbidden" });
    expect(abrir).toHaveBeenCalledTimes(1);
  });
  it("delegar: sem porta ⇒ unavailable (nada criado); com porta e confirmar ⇒ briefing/task/worker e o board passa a mostrar 'delegada'", async () => {
    const sem = montar();
    await expect(sem.l.board().delegar({ workspace_id: sem.ws.id, trabalho_id: "w1", task_id: "T-01.02", mission_id: sem.mis.id, confirmar: true })).rejects.toMatchObject({ codigo: "unavailable", subcodigo: "no_router" });
    const chamadas: string[] = [];
    let m!: ReturnType<typeof montar>;
    const porta: PortaDelegar = {
      missao: (id) => ({ id, workspace_id: m.ws.id, modo: "agentico", estado: "executando", trabalho_id: "w1", tem_worktree: true }),
      gravarBriefing: async (d) => (chamadas.push("briefing"), `.expxv/missoes/${d.mission_id}/briefing-${d.task_ref}.md`),
      criarTask: (d) => (chamadas.push("task"), { id: m.r.task.criar({ mission_id: d.mission_id, task_ref: d.task_ref, titulo: d.titulo, papel: "executor", briefing_path: d.briefing_path }).id }),
      abrirWorker: async () => (chamadas.push("worker"), { pane_id: m.exec.id, recibo: "rota ok" }),
      descartarTask: () => undefined,
    };
    m = montar({ delegar: porta });
    const pedido = { workspace_id: m.ws.id, trabalho_id: "w1", task_id: "T-01.02", mission_id: m.mis.id, confirmar: true as const };
    expect(await m.l.board().delegar(pedido)).toMatchObject({ pane_id: m.exec.id, task_ref: "T-01.02", recibo: "rota ok", estimativa: { confianca: "sem_historico" } });
    expect(chamadas).toEqual(["briefing", "task", "worker"]);
    const b = await m.l.board().snapshot({ workspace_id: m.ws.id });
    expect(b.colunas.a_fazer.find((c) => c.task_id === "T-01.02")?.selos).toContain("delegada");
    await expect(m.l.board().delegar(pedido)).rejects.toMatchObject({ codigo: "conflict" });
    expect(chamadas).toEqual(["briefing", "task", "worker"]);
  });
  it("WIP: configuração por workspace aparece no snapshot e é validada", async () => {
    const m = montar({ tasks: [task("A", "em_andamento"), task("B", "em_andamento"), task("C", "pendente")] });
    expect(m.l.board().configGravar(m.ws.id, { wip: { em_andamento: 1 } })).toEqual({ wip: { em_andamento: 1 } });
    const b = await m.l.board().snapshot(filtros(m.ws.id));
    expect(b.wip.em_andamento).toEqual({ total: 2, limite: 1, excedido: true });
    expect(() => m.l.board().configGravar(m.ws.id, { wip: { em_andamento: 0 } })).toThrow();
    expect(() => m.l.board().configGravar(m.ws.id, { wip: { inexistente: 1 } as never })).toThrow();
    expect(m.l.board().configLer(m.ws.id)).toEqual({ wip: { em_andamento: 1 } });
  });
  it("previsão da Missão e estimativa histórica: sem histórico nunca chuta; com 3+ cards concluídos completos usa a mediana", async () => {
    const tasks = [task("A", "concluida"), task("B", "concluida"), task("C", "concluida"), task("D", "pendente"), task("E", "pendente")];
    const m = montar({ tasks });
    expect(await m.l.estimativa({ workspace_id: m.ws.id })).toMatchObject({ confianca: "sem_historico", mediana_usd: null });
    expect(await m.l.estimativa({})).toMatchObject({ confianca: "sem_historico" });
    expect(await m.l.previsaoMissao(m.mis.id)).toMatchObject({ base: "sem_base", cards_restantes: 2 });
    const s = m.l.servico();
    for (const t of ["A", "B", "C"]) {
      m.r.task.criar({ mission_id: m.mis.id, task_ref: t, titulo: t, papel: "executor" });
    }
    m.banco.executar("UPDATE task SET reivindicada_em = '2026-06-10T08:00:00.000Z', entregue_em = '2026-06-10T09:00:00.000Z', pane_id = ?", [m.exec.id]);
    m.banco.executar("UPDATE task SET reivindicada_em = '2026-06-10T08:00:00.000Z', entregue_em = '2026-06-10T09:00:00.000Z' WHERE task_ref = 'A'");
    m.banco.executar("UPDATE task SET reivindicada_em = '2026-06-10T09:00:00.000Z', entregue_em = '2026-06-10T10:00:00.000Z' WHERE task_ref = 'B'");
    m.banco.executar("UPDATE task SET reivindicada_em = '2026-06-10T10:00:00.000Z', entregue_em = '2026-06-10T11:00:00.000Z' WHERE task_ref = 'C'");
    s.sincronizarJanelasDoBanco(m.ws.id, "w1");
    const f = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "a.jsonl", pane_id: m.exec.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    s.ingerir(f.id, [{ chave: "a", ts: "2026-06-10T08:30:00.000Z", modelo: "claude-sonnet-4-5", tokens: tk(1_000_000) }, { chave: "b", ts: "2026-06-10T09:30:00.000Z", modelo: "claude-sonnet-4-5", tokens: tk(2_000_000) }, { chave: "c", ts: "2026-06-10T10:30:00.000Z", modelo: "claude-sonnet-4-5", tokens: tk(1_000_000) }]);
    expect(await m.l.estimativa({ workspace_id: m.ws.id })).toMatchObject({ amostras: 3, mediana_usd: 3, confianca: "baixa" });
    const p = await m.l.previsaoMissao(m.mis.id);
    expect(p).toMatchObject({ base: "historico", cards_restantes: 2, restante_estimado_usd: 6, total_projetado_usd: 18 });
    expect((await m.l.board().snapshot({ workspace_id: m.ws.id })).colunas.concluido.find((c) => c.task_id === "B")?.custo.usd).toBe(6);
  });
});
