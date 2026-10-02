// Varredura/reavaliação do retrabalho sobre o banco: detecta (por fonte), registra sem duplicar e recalcula a situação por task.
// Incremental: passe só os trabalhos alterados em `fontes`. Maps são montados UMA vez por chamada (P-186).
import type { ConfigAgil, EventoRetrabalho, FatoTask, TaskRetrabalho } from "../../../compartilhado/agil";
import type { FonteTrabalho, OcorrenciaRunx } from "../portas";
import { chaveTask, type BancoAgil } from "../repos";
import { ms, type GeradorId, type Relogio } from "../util";
import { detectarTudo } from "./detectores";
import { situacaoDaTask } from "./estado";
import { registrarDeteccoes } from "./marcar";

export interface DepsProcessar { banco: BancoAgil; relogio: Relogio; id: GeradorId; config: ConfigAgil }

/** fechamento mais recente de sprint ágil que contém o item (ou null). */
export function fechamentoPorItem(banco: BancoAgil): Map<string, string> {
  const fechada = new Map<string, string>();
  for (const s of banco.sprints.valores()) if (s.estado === "fechada" && s.fechada_em) fechada.set(s.id, s.fechada_em);
  const out = new Map<string, string>();
  for (const si of banco.sprintItens.valores()) {
    if (si.removido_em) continue;
    const f = fechada.get(si.sprint_id);
    if (f && (!out.has(si.item_id) || (ms(f) as number) > (ms(out.get(si.item_id)) as number))) out.set(si.item_id, f);
  }
  return out;
}

export function processarRetrabalho(d: DepsProcessar, ws: string, fontes: readonly FonteTrabalho[], ocorrencias: readonly OcorrenciaRunx[]): { novos: EventoRetrabalho[]; tasks: TaskRetrabalho[] } {
  const { banco } = d;
  const fatosPor = new Map<string, FatoTask[]>();
  for (const f of banco.fatos.valores()) if (f.workspace_id === ws) (fatosPor.get(f.trabalho_id) ?? fatosPor.set(f.trabalho_id, []).get(f.trabalho_id))?.push(f);
  const itemPorTask = new Map<string, string>();
  for (const it of banco.itens.valores()) if (it.workspace_id === ws && it.trabalho_id && it.task_ref) itemPorTask.set(chaveTask(ws, it.trabalho_id, it.task_ref), it.id);
  const fechPorItem = fechamentoPorItem(banco);
  const novos: EventoRetrabalho[] = [];
  const tasks: TaskRetrabalho[] = [];

  banco.transacao(() => {
    for (const fonte of fontes) {
      const tid = fonte.trabalho.id;
      const fatos = fatosPor.get(tid) ?? [];
      const det = detectarTudo({ workspaceId: ws, trabalhoId: tid, fatos, qa: fonte.qa, ocorrencias, rastro: fonte.rastro, config: d.config });
      novos.push(...registrarDeteccoes(d, det, (t, r) => itemPorTask.get(chaveTask(ws, t, r)) ?? null).novos);
    }
    const eventosPorTrab = new Map<string, EventoRetrabalho[]>();
    for (const e of banco.eventosRetrabalho.valores()) if (e.workspace_id === ws) (eventosPorTrab.get(e.trabalho_id) ?? eventosPorTrab.set(e.trabalho_id, []).get(e.trabalho_id))?.push(e);
    const agora = d.relogio();
    for (const fonte of fontes) {
      const tid = fonte.trabalho.id;
      const evs = eventosPorTrab.get(tid) ?? [];
      for (const fato of fatosPor.get(tid) ?? []) {
        const item = itemPorTask.get(chaveTask(ws, tid, fato.task_ref));
        const r = situacaoDaTask(fato, evs, {
          agora, janela_dias: d.config.janela_retrabalho_dias, sprint_fechada_em: item ? fechPorItem.get(item) ?? null : null,
          qa_emitido_em: fonte.qa?.emitido_em ?? null, tem_qa: fonte.qa !== null,
        });
        banco.retrabalhoTasks.set(chaveTask(ws, tid, fato.task_ref), r);
        tasks.push(r);
      }
    }
  });
  return { novos, tasks };
}
