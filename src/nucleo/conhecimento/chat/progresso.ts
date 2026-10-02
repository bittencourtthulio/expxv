// Progresso do plano em execução: reduz eventos de Pane/Missão a uma linha por terminal (coalescida pela UI).
import type { EstadoPlano } from "./tipos";

export interface LinhaProgresso {
  pane_id: string;
  estado: string;
  resumo: string;
}

export function reduzirProgresso(atual: readonly LinhaProgresso[], ev: { pane_id: string | null; estado: EstadoPlano | "passo" | string; resumo: string }): LinhaProgresso[] {
  if (ev.pane_id === null) return [...atual];
  const resto = atual.filter((l) => l.pane_id !== ev.pane_id);
  return [...resto, { pane_id: ev.pane_id, estado: ev.estado, resumo: ev.resumo.slice(0, 160) }];
}
