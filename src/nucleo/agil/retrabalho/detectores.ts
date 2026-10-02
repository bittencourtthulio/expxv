// T-18.19: detectores PUROS por fonte. Cada um devolve eventos com `chave_dedupe` estável (reprocessar não duplica).
// Fortes: qa_reprovado (alta/media), task_reaberta, commit_fix (depois de concluida_em), regressao. Fraco (só sinaliza): regra_repetida.
import type { ConfigAgil, EventoRetrabalho, FatoTask } from "../../../compartilhado/agil";
import type { EventoRastro } from "../../metodo/tipos";
import type { OcorrenciaRunx, QaFonte } from "../portas";
import { hash, isoDe, ms } from "../util";
import { atribuirAchado, severidadeForte } from "./atribuicao";
import { naturezaDeAchadoQa, naturezaDeCommit, naturezaDeOcorrencia } from "./natureza";

export type EventoDetectado = Omit<EventoRetrabalho, "id" | "detectado_em" | "confirmado_por" | "motivo" | "ativo" | "item_id">;
const PALAVRA_FIX = /\b(fix|hotfix|bugfix|revert|corrige|corrigir|corrigido|correcao|correção)\b/i;

const base = (f: Pick<FatoTask, "workspace_id" | "trabalho_id">, task: string | null): Pick<EventoDetectado, "workspace_id" | "trabalho_id" | "task_ref"> => ({ workspace_id: f.workspace_id, trabalho_id: f.trabalho_id, task_ref: task });

/** QA reprovado: achado alta/média ligado à task (citada > arquivos > só o trabalho, este como `pendente`). */
export function detectarQaReprovado(workspaceId: string, trabalhoId: string, qa: QaFonte | null, fatos: readonly FatoTask[]): EventoDetectado[] {
  if (!qa) return [];
  const refs = fatos.map((f) => ({ task_ref: f.task_ref, arquivos: f.arquivos }));
  const out: EventoDetectado[] = [];
  for (const a of qa.achados) {
    if (!severidadeForte(a.severidade)) continue;
    const at = atribuirAchado(a, refs);
    const natureza = naturezaDeAchadoQa(a.categoria);
    const ev = { evidencia: { achado: a.id, severidade: a.severidade, atribuicao: at.metodo, descricao: a.descricao.slice(0, 160) }, ocorrido_em: qa.emitido_em };
    if (at.tasks.length === 0) out.push({ workspace_id: workspaceId, trabalho_id: trabalhoId, task_ref: null, fonte: "qa_reprovado", forca: "forte", natureza: "pendente", chave_dedupe: `qa:${trabalhoId}:-:${a.id}`, ...ev });
    else for (const t of at.tasks) out.push({ workspace_id: workspaceId, trabalho_id: trabalhoId, task_ref: t, fonte: "qa_reprovado", forca: "forte", natureza, chave_dedupe: `qa:${trabalhoId}:${t}:${a.id}`, ...ev });
  }
  return out;
}

/** task reaberta: `concluida` -> outro estado, ou `task_iniciada` após `task_concluida` (os instantes já vêm em `reabertas_em`). */
export function detectarTaskReaberta(f: FatoTask): EventoDetectado[] {
  return f.reabertas_em.map((quando) => ({ ...base(f, f.task_ref), fonte: "task_reaberta" as const, forca: "forte" as const, natureza: "defeito" as const, evidencia: { reaberta_em: quando }, chave_dedupe: `reab:${f.trabalho_id}:${f.task_ref}:${quando}`, ocorrido_em: quando }));
}

/** commit/PR de correção referenciando a task DEPOIS de `concluida_em`. Sem timestamp não dá para afirmar "depois": ignora. */
export function detectarCommitFix(f: FatoTask, config: Pick<ConfigAgil, "natureza">): EventoDetectado[] {
  const concl = ms(f.concluida_em);
  if (concl === null) return [];
  const out: EventoDetectado[] = [];
  for (const c of f.commits) {
    const t = ms(c.ts);
    if (t === null || t <= concl) continue;
    const rotuloFix = c.labels.some((l) => ["bug", "fix", "bugfix"].includes(l.toLowerCase()));
    const natureza = naturezaDeCommit(c.mensagem, c.labels, config.natureza);
    const pareceFix = PALAVRA_FIX.test(c.mensagem) || rotuloFix || /^\s*(fix|hotfix|bugfix|revert)\b/i.test(c.mensagem);
    if (!pareceFix && natureza !== "escopo") continue;
    out.push({ ...base(f, f.task_ref), fonte: "commit_fix", forca: "forte", natureza, evidencia: { sha: c.sha, mensagem: c.mensagem.slice(0, 160) }, chave_dedupe: `fix:${f.trabalho_id}:${f.task_ref}:${c.sha ?? hash(c.mensagem)}`, ocorrido_em: isoDe(t) });
  }
  return out;
}

/** regressão: ocorrência runx tipo bug com `regressao_de` = este trabalho. Task = a citada, ou a de maior interseção de arquivos; senão só o trabalho (`pendente`). */
export function detectarRegressao(workspaceId: string, trabalhoId: string, ocorrencias: readonly OcorrenciaRunx[], fatos: readonly FatoTask[]): EventoDetectado[] {
  const out: EventoDetectado[] = [];
  for (const o of ocorrencias) {
    if (o.regressao_de !== trabalhoId) continue;
    const natureza = naturezaDeOcorrencia(o.tipo);
    if (natureza === "escopo") continue;
    const citada = o.task_ref ? fatos.find((f) => f.task_ref === o.task_ref) : undefined;
    const alvos = citada ? [citada.task_ref] : atribuirAchado({ id: o.id, severidade: "alta", categoria: null, task: null, arquivos: o.arquivos, descricao: "" }, fatos.map((f) => ({ task_ref: f.task_ref, arquivos: f.arquivos }))).tasks;
    const ev = { evidencia: { ocorrencia: o.id, tipo: o.tipo }, ocorrido_em: o.aberta_em };
    if (alvos.length === 0) out.push({ workspace_id: workspaceId, trabalho_id: trabalhoId, task_ref: null, fonte: "regressao", forca: "forte", natureza: "pendente", chave_dedupe: `reg:${trabalhoId}:-:${o.id}`, ...ev });
    else for (const t of alvos) out.push({ workspace_id: workspaceId, trabalho_id: trabalhoId, task_ref: t, fonte: "regressao", forca: "forte", natureza, chave_dedupe: `reg:${trabalhoId}:${t}:${o.id}`, ...ev });
  }
  return out;
}

/** FRACO: `regra_violada` repetida (>= 2, mesma regra, mesma task). Só sinaliza: não entra no índice. */
export function detectarRegraRepetida(workspaceId: string, trabalhoId: string, rastro: readonly EventoRastro[]): EventoDetectado[] {
  const cont = new Map<string, number>();
  for (const e of rastro) {
    if (e.evento !== "regra_violada" || !e.task) continue;
    const regra = typeof e["regra"] === "string" ? (e["regra"] as string) : String(e.detalhe ?? "").slice(0, 60);
    if (!regra) continue;
    const k = `${e.task}\u0000${regra}`;
    cont.set(k, (cont.get(k) ?? 0) + 1);
  }
  const out: EventoDetectado[] = [];
  for (const [k, n] of cont) {
    if (n < 2) continue;
    const [task, regra] = k.split("\u0000") as [string, string];
    out.push({ workspace_id: workspaceId, trabalho_id: trabalhoId, task_ref: task, fonte: "regra_repetida", forca: "fraca", natureza: "pendente", evidencia: { regra, vezes: n }, chave_dedupe: `regra:${trabalhoId}:${task}:${hash(regra)}`, ocorrido_em: null });
  }
  return out;
}

export interface EntradaDeteccao { workspaceId: string; trabalhoId: string; fatos: readonly FatoTask[]; qa: QaFonte | null; ocorrencias: readonly OcorrenciaRunx[]; rastro: readonly EventoRastro[]; config: Pick<ConfigAgil, "natureza"> }
export function detectarTudo(e: EntradaDeteccao): EventoDetectado[] {
  return [
    ...detectarQaReprovado(e.workspaceId, e.trabalhoId, e.qa, e.fatos),
    ...e.fatos.flatMap((f) => [...detectarTaskReaberta(f), ...detectarCommitFix(f, e.config)]),
    ...detectarRegressao(e.workspaceId, e.trabalhoId, e.ocorrencias, e.fatos),
    ...detectarRegraRepetida(e.workspaceId, e.trabalhoId, e.rastro),
  ];
}
