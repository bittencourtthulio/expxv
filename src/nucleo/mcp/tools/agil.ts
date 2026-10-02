// Tools da gestão ágil (Fase 18, T-18.37): `backlog_list`, `backlog_get`, `backlog_propose`, `estimate_get`, `estimate_propose`, `sprint_status`, `rework_list`, `metrics_get`.
// A thread do MCP só valida o FORMATO, descarta o que não é campo documentado (identidade e "quem decide" nunca vêm dos argumentos: `workspace_id`, `ator`, `origem`,
// `estado`, `motor` são ignorados) e chama o main pela porta. O agente LÊ e PROPÕE; decidir (aceitar/ajustar estimativa, marcar retrabalho, iniciar/fechar sprint) é do humano:
// tentar vira `rule_violation/human_only`. Quem propõe é só o piloto em `squad`/`agentico` (o catálogo esconde e a porta reconfere). Resposta sempre ≤ 4 KB.
import { argumentoInvalido, indisponivel, ErroMcp, violacaoDeRegra } from "../erros";
import type { ClaimsDeAgil, NomeToolAgil, PortaAgilMcp } from "../portas";
import { LIMITE_RESPOSTA_BYTES, caberEm4Kb } from "./harness";
import { comoObjeto, identificador, identificadorOpcional, inteiroOpcional, texto, textoOpcional, type ContextoTool, type DepsTools, type ImplTool } from "./comum";

const STATUS = ["backlog", "ready", "in_progress", "done", "validated", "orphan"] as const;
const RISCOS = ["baixo", "medio", "alto", "critico"] as const;
const CRITICIDADES = ["baixa", "media", "alta", "critica"] as const;

function exigirAgil(deps: DepsTools): PortaAgilMcp {
  if (deps.agil === undefined) throw indisponivel("A gestão ágil não está disponível.");
  return deps.agil;
}
const identidade = (c: ContextoTool["claims"]): ClaimsDeAgil => ({ workspace_id: c.workspace_id, mission_id: c.mission_id, pane_id: c.pane_id, role: c.role, mode: c.mode });

/** worker nunca vê estas tools (catálogo); aqui é a segunda barreira. */
function naoWorker(c: ContextoTool["claims"]): void {
  if (c.role === "executor" || c.role === "explorador" || c.role === "revisor") throw violacaoDeRegra("forbidden_role", "Workers só entregam: a gestão ágil não está disponível para este papel.");
}
function soPilotoPropoe(c: ContextoTool["claims"]): void {
  if (c.role !== "piloto" || c.mode === "livre") throw violacaoDeRegra("forbidden_role", "Só o piloto de uma Missão em modo squad ou agêntico pode propor ao backlog.");
}
async function daPorta<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) { if (e instanceof ErroMcp) throw e; throw indisponivel("Falha interna ao executar a tool."); }
}
function enumOpcional<T extends string>(a: Record<string, unknown>, campo: string, valores: readonly T[]): T | null {
  const v = textoOpcional(a, campo, 30);
  if (v === null) return null;
  if (!(valores as readonly string[]).includes(v)) throw argumentoInvalido(`O campo "${campo}" deve ser um de: ${valores.join(", ")}.`);
  return v as T;
}

export const backlogList: ImplTool = async (args, { claims, deps }) => {
  naoWorker(claims);
  const a = comoObjeto(args);
  const status = enumOpcional(a, "status", STATUS);
  const epic = identificadorOpcional(a, "epic_id");
  const limit = inteiroOpcional(a, "limit", 1, 100);
  const cursor = textoOpcional(a, "cursor", 20);
  const limpo = { ...(status === null ? {} : { status }), ...(epic === null ? {} : { epic_id: epic }), ...(limit === null ? {} : { limit }), ...(cursor === null ? {} : { cursor }) };
  const r = (await daPorta(() => exigirAgil(deps).chamar("backlog_list", identidade(claims), limpo))) as { items: unknown[]; next: string | null };
  return caberEm4Kb(r.items, (itens, extra) => ({ items: itens, next: extra.truncated === true ? null : r.next, ...(extra.truncated === true ? { truncated: true } : {}) }));
};

export const backlogGet: ImplTool = async (args, { claims, deps }) => {
  naoWorker(claims);
  const a = comoObjeto(args);
  const r = (await daPorta(() => exigirAgil(deps).chamar("backlog_get", identidade(claims), { item_id: identificador(a, "item_id") }))) as Record<string, unknown> & { estimates?: unknown[] };
  const estimates = r.estimates ?? [];
  return caberEm4Kb(estimates, (itens, extra) => ({ ...r, estimates: itens, ...(extra.truncated === true ? { truncated: true } : {}) }));
};

export const backlogPropose: ImplTool = async (args, { claims, deps }) => {
  naoWorker(claims);
  soPilotoPropoe(claims);
  const a = comoObjeto(args);
  const criteria = a["criteria"];
  if (criteria !== undefined && criteria !== null && (!Array.isArray(criteria) || criteria.length > 10 || criteria.some((c) => typeof c !== "string" || c.trim() === "" || [...c].length > 300))) throw argumentoInvalido('O campo "criteria" deve ser uma lista de até 10 textos de até 300 caracteres.');
  const description = textoOpcional(a, "description", 2000);
  const epic = identificadorOpcional(a, "epic_id");
  const limpo = { title: texto(a, "title", { max: 300 }).trim(), ...(description === null ? {} : { description }), ...(Array.isArray(criteria) ? { criteria } : {}), ...(epic === null ? {} : { epic_id: epic }) };
  return daPorta(() => exigirAgil(deps).chamar("backlog_propose", identidade(claims), limpo));
};

export const estimateGet: ImplTool = async (args, { claims, deps }) => {
  naoWorker(claims);
  const a = comoObjeto(args);
  const r = (await daPorta(() => exigirAgil(deps).chamar("estimate_get", identidade(claims), { item_ref: identificador(a, "item_ref") }))) as Record<string, unknown> & { history?: unknown[] };
  const history = r.history ?? [];
  return caberEm4Kb(history, (itens, extra) => ({ ...r, history: itens, ...(extra.truncated === true ? { truncated: true } : {}) }));
};

export const estimatePropose: ImplTool = async (args, { claims, deps }) => {
  naoWorker(claims);
  soPilotoPropoe(claims);
  const a = comoObjeto(args);
  // decidir (aceitar/ajustar/travar) é do humano; o agente só sugere
  if (a["state"] !== undefined && a["state"] !== "sugerida") throw violacaoDeRegra("human_only", "Decidir a estimativa (aceitar, ajustar ou travar) é ação humana: o agente só sugere.");
  const points = a["points"];
  if (typeof points !== "number" || !Number.isFinite(points) || points <= 0 || points > 1000) throw argumentoInvalido('O campo "points" deve ser um número positivo.');
  const category = textoOpcional(a, "category", 60);
  const risk = enumOpcional(a, "risk", RISCOS);
  const criticality = enumOpcional(a, "criticality", CRITICIDADES);
  const rationale = textoOpcional(a, "rationale", 400);
  const limpo = { item_ref: identificador(a, "item_ref"), points, ...(category === null ? {} : { category }), ...(risk === null ? {} : { risk }), ...(criticality === null ? {} : { criticality }), ...(rationale === null ? {} : { rationale }) };
  return daPorta(() => exigirAgil(deps).chamar("estimate_propose", identidade(claims), limpo));
};

export const sprintStatus: ImplTool = async (args, { claims, deps }) => {
  naoWorker(claims);
  const a = comoObjeto(args);
  const sid = identificadorOpcional(a, "sprint_id");
  const r = (await daPorta(() => exigirAgil(deps).chamar("sprint_status", identidade(claims), sid === null ? {} : { sprint_id: sid }))) as Record<string, unknown> & { health?: unknown[] };
  return caberEm4Kb(r.health ?? [], (itens, extra) => ({ ...r, health: itens, ...(extra.truncated === true ? { truncated: true } : {}) }));
};

export const reworkList: ImplTool = async (args, { claims, deps }) => {
  naoWorker(claims);
  const a = comoObjeto(args);
  const sid = identificadorOpcional(a, "sprint_id");
  const limit = inteiroOpcional(a, "limit", 1, 100);
  const r = (await daPorta(() => exigirAgil(deps).chamar("rework_list", identidade(claims), { ...(sid === null ? {} : { sprint_id: sid }), ...(limit === null ? {} : { limit }) }))) as { eventos: unknown[]; situacoes: unknown[] };
  const states = r.situacoes.slice(0, 20);
  const saida = caberEm4Kb(r.eventos, (itens, extra) => ({ events: itens, states, ...(extra.truncated === true ? { truncated: true } : {}) }));
  return Buffer.byteLength(JSON.stringify(saida), "utf8") > LIMITE_RESPOSTA_BYTES ? { events: [], states: [], truncated: true } : saida;
};

export const metricsGet: ImplTool = async (args, { claims, deps }) => {
  naoWorker(claims);
  const a = comoObjeto(args);
  const sid = identificadorOpcional(a, "sprint_id");
  const r = (await daPorta(() => exigirAgil(deps).chamar("metrics_get", identidade(claims), { metric: texto(a, "metric", { max: 40 }), ...(sid === null ? {} : { sprint_id: sid }) }))) as { metric: string; data: unknown };
  // série grande: o JSON inteiro nunca passa de 4 KB (corta por elementos de lista quando a métrica é lista)
  if (Array.isArray(r.data)) return caberEm4Kb(r.data, (itens, extra) => ({ metric: r.metric, data: itens, ...(extra.truncated === true ? { truncated: true } : {}) }));
  if (Buffer.byteLength(JSON.stringify(r), "utf8") <= 3800) return r;
  return { metric: r.metric, data: null, truncated: true, notice: "Série grande demais para a tool; consulte o painel na interface." };
};

export type { NomeToolAgil };
