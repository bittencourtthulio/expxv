// Agregador PURO: junta os três derivadores sem duplicar. Precedência por trabalho: pipeline do Maestro > tasks do sprintx > skill solta.
// Quando o Maestro e o sprintx falam do mesmo trabalho, a lista do Maestro fica e a etapa de execução ganha o contador "3/12 tasks".
import type { Progresso } from "../../compartilhado/progresso";
import { derivarDoMaestro, type PipelineParaProgresso } from "./maestro";
import { derivarDoSprintx, type TrabalhoParaProgresso } from "./sprintx";
import { derivarDaSkill, type SkillObservada } from "./skill";

export interface EntradaSprintx {
  trabalho: TrabalhoParaProgresso;
  workspace_id: string;
  iniciado_em?: number;
}
export interface EntradaAgregar {
  pipelines: readonly PipelineParaProgresso[];
  sprintx: readonly EntradaSprintx[];
  skills: ReadonlyArray<SkillObservada & { trabalho_id?: string | null }>;
  sessaoDoPane?: (paneId: string) => string | null;
  agora?: number;
}

/** Etapas do Maestro cuja execução é feita task a task (o contador de tasks aparece nelas). */
export const ETAPAS_COM_TASKS: readonly string[] = ["sprintx.f6", "runx.e3"];

export function agregarProgressos(e: EntradaAgregar): Progresso[] {
  const agora = e.agora ?? Date.now();
  const porTrabalho = new Map(e.sprintx.map((s) => [`${s.workspace_id}\u0000${s.trabalho.id}`, s]));
  const cobertos = new Set<string>();
  const saida: Progresso[] = [];

  for (const p of e.pipelines) {
    const d = derivarDoMaestro(p, e.sessaoDoPane);
    if (d === null) continue;
    if (p.trabalho_id !== null) {
      const chave = `${p.workspace_id}\u0000${p.trabalho_id}`;
      cobertos.add(chave);
      const sx = porTrabalho.get(chave);
      const tasks = sx === undefined ? null : derivarDoSprintx(sx.trabalho, sx.workspace_id, { agora });
      if (tasks !== null) {
        const feitas = tasks.itens.filter((i) => i.estado === "concluido").length;
        const alvo = d.itens.find((i) => ETAPAS_COM_TASKS.includes(i.id) && i.estado === "em_andamento");
        if (alvo !== undefined) alvo.detalhe = `${feitas}/${tasks.itens.length} tasks`;
      }
    }
    saida.push(d);
  }
  for (const s of e.sprintx) {
    const chave = `${s.workspace_id}\u0000${s.trabalho.id}`;
    if (cobertos.has(chave)) continue;
    cobertos.add(chave);
    const d = derivarDoSprintx(s.trabalho, s.workspace_id, { agora, ...(s.iniciado_em === undefined ? {} : { iniciadoEm: s.iniciado_em }) });
    if (d !== null) saida.push(d);
  }
  for (const k of e.skills) {
    if (k.trabalho_id !== undefined && k.trabalho_id !== null && cobertos.has(`${k.workspace_id}\u0000${k.trabalho_id}`)) continue;
    saida.push(derivarDaSkill(k));
  }
  return saida.sort((a, b) => a.iniciado_em - b.iniciado_em || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
