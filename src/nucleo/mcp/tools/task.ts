// Tools do board (Fase 10, T-10.20): `task_list` (leve) e `task_get` (completo). SOMENTE LEITURA: nenhum campo de escrita, nenhum campo de custo/tokens como ENTRADA (D-104).
// A thread do MCP valida o formato, descarta identidade (`workspace_id`, `mission_id`, `pane_id`... só do token) e chama o main pela porta. O escopo é o trabalho da Missão do
// token (ou do workspace do token, conforme a porta): outra Missão volta `not_found`. Resposta sempre ≤ 4 KB; custo desconhecido é `usd: null` + `incomplete`, nunca 0.
import { argumentoInvalido, indisponivel, ErroMcp, violacaoDeRegra } from "../erros";
import type { CardLeveMcp, ClaimsDeCusto, PortaCustoMcp } from "../portas";
import { LIMITE_RESPOSTA_BYTES, caberEm4Kb } from "./harness";
import { comoObjeto, identificador, identificadorOpcional, inteiroOpcional, textoOpcional, type ContextoTool, type DepsTools, type ImplTool } from "./comum";

/** coluna interna (PT) <-> contrato externo (EN). */
export const COLUNA_EXTERNA: Readonly<Record<CardLeveMcp["coluna"], string>> = {
  backlog: "backlog",
  a_fazer: "todo",
  em_andamento: "in_progress",
  em_revisao: "review",
  concluido: "done",
  validado: "validated",
};
const COLUNA_INTERNA: Readonly<Record<string, CardLeveMcp["coluna"]>> = Object.fromEntries(Object.entries(COLUNA_EXTERNA).map(([pt, en]) => [en, pt as CardLeveMcp["coluna"]]));
const ID_TASK = /^T-\d{2,3}\.\d{2,3}$/;
const LIMITE_PADRAO = 25;
const LIMITE_MAX = 50;

export function exigirCusto(deps: DepsTools): PortaCustoMcp {
  if (deps.custo === undefined) throw indisponivel("O board e o custo não estão disponíveis.");
  return deps.custo;
}
export const identidadeCusto = (c: ContextoTool["claims"]): ClaimsDeCusto => ({ workspace_id: c.workspace_id, mission_id: c.mission_id, pane_id: c.pane_id, role: c.role, mode: c.mode });

/** workers nunca veem estas tools (catálogo); aqui é a segunda barreira. Modo livre não tem Missão: nada a ler. */
export function soPilotoDeMissao(c: ContextoTool["claims"]): void {
  if (c.role === "executor" || c.role === "explorador" || c.role === "revisor") throw violacaoDeRegra("forbidden_role", "Workers só entregam: o board e o custo não estão disponíveis para este papel.");
  if (c.mode === "livre" || c.mission_id === null) throw violacaoDeRegra("forbidden_role", "O board e o custo só existem em Missões squad ou agênticas.");
}
export async function daPorta<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof ErroMcp) throw e;
    throw indisponivel("Falha interna ao executar a tool.");
  }
}
const arredondar = (v: number | null): number | null => (v === null ? null : Math.round(v * 1e6) / 1e6);

export const taskList: ImplTool = async (args, { claims, deps }) => {
  soPilotoDeMissao(claims);
  const a = comoObjeto(args);
  const project = identificadorOpcional(a, "project");
  const statusBruto = textoOpcional(a, "status", 20);
  let coluna: CardLeveMcp["coluna"] | null = null;
  if (statusBruto !== null) {
    coluna = COLUNA_INTERNA[statusBruto] ?? null;
    if (coluna === null) throw argumentoInvalido(`O campo "status" deve ser um de: ${Object.values(COLUNA_EXTERNA).join(", ")}.`);
  }
  const limit = inteiroOpcional(a, "limit", 1, LIMITE_MAX) ?? LIMITE_PADRAO;
  const cursor = textoOpcional(a, "cursor", 40);
  const r = await daPorta(() => exigirCusto(deps).listarTasks(identidadeCusto(claims), { trabalho_id: project, coluna, limite: limit, cursor }));
  const itens = r.itens.map((c) => ({ task_id: c.task_id, title: [...c.titulo].slice(0, 80).join(""), column: COLUNA_EXTERNA[c.coluna], ready: c.pronta, cost: { usd: arredondar(c.custo.usd), incomplete: c.custo.incompleto } }));
  // se o corte tirou itens, o `next` da porta pularia os cortados: sem `next` e com `truncated`, o agente refaz com `limit` menor
  return caberEm4Kb(itens, (parte, extra) => ({ tasks: parte, next: extra.truncated === true ? null : r.proximo, ...(extra.truncated === true ? { truncated: true, total: extra.total } : {}) }), LIMITE_RESPOSTA_BYTES);
};

export const taskGet: ImplTool = async (args, { claims, deps }) => {
  soPilotoDeMissao(claims);
  const a = comoObjeto(args);
  const task = identificador(a, "task");
  if (!ID_TASK.test(task)) throw argumentoInvalido('O campo "task" deve ser um id do método (T-NN.MM).');
  const project = identificadorOpcional(a, "project");
  const d = await daPorta(() => exigirCusto(deps).obterTask(identidadeCusto(claims), { task_id: task, trabalho_id: project }));
  const corta = (v: string | null, n: number): string | null => (v === null ? null : [...v].slice(0, n).join(""));
  const base = {
    task_id: d.task_id,
    title: [...d.titulo].slice(0, 120).join(""),
    column: COLUNA_EXTERNA[d.coluna],
    depends_on: d.depende_de.slice(0, 20),
    contract: { objective: corta(d.contrato.objetivo, 500), acceptance: corta(d.contrato.criterio_aceite, 500), tests: { integration: corta(d.contrato.teste_integracao, 300), functional: corta(d.contrato.teste_funcional, 300), regression: corta(d.contrato.teste_regressao, 300) } },
    window: d.janela === null ? null : { start: d.janela.inicio, end: d.janela.fim, source: d.janela.origem === "banco" ? "db" : "trace" },
    cost: { usd: arredondar(d.custo.usd), incomplete: d.custo.incompleto, approximate: d.custo.aproximado },
  };
  const porModelo = d.custo_por_modelo.map((m) => ({ model: m.modelo, tokens_in: m.tokens_entrada, tokens_out: m.tokens_saida, usd: arredondar(m.usd), approximate: m.aproximado }));
  const panes = d.panes.slice(0, 10).map((p) => ({ pane_id: p.pane_id, cli: p.cli, model: p.modelo, role: p.papel }));
  const handoffs = d.handoffs.slice(0, 10).map((h) => ({ id: h.id, status: h.status, summary: [...h.resumo].slice(0, 200).join(""), at: h.criado_em }));
  // o que sobra do orçamento de 4 KB é dividido: cada lista encolhe até caber
  let nm = porModelo.length;
  let np = panes.length;
  let nh = handoffs.length;
  const montar = (): Record<string, unknown> => ({ ...base, cost_by_model: porModelo.slice(0, nm), panes: panes.slice(0, np), handoffs: handoffs.slice(0, nh), ...(nm < porModelo.length || np < panes.length || nh < handoffs.length ? { truncated: true } : {}) });
  const tam = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");
  let saida = montar();
  while (tam(saida) > LIMITE_RESPOSTA_BYTES && (nm > 0 || np > 0 || nh > 0)) {
    if (nh > 0) nh -= 1;
    else if (np > 0) np -= 1;
    else nm -= 1;
    saida = montar();
  }
  if (tam(saida) > LIMITE_RESPOSTA_BYTES) saida = { ...base, contract: { objective: corta(d.contrato.objetivo, 200), acceptance: corta(d.contrato.criterio_aceite, 200), tests: { integration: null, functional: null, regression: null } }, cost_by_model: [], panes: [], handoffs: [], truncated: true };
  return saida;
};
