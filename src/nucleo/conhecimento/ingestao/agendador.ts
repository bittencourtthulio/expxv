// Agendador (T-15.19): decide QUANDO rodar cada trabalho de fundo, sem timers próprios (o chamador injeta o relógio): drenar a fila,
// aquecer o índice, consolidar (≤ 1×/6 h e ao fechar Missão), reembutir (só ocioso). Tudo em fatias; nada roda com a app ocupada.
import { INTERVALO_CONSOLIDACAO_MS } from "../aprendizado/consolidar";

export type Trabalho = "fila" | "aquecer" | "reembutir" | "consolidar";

export interface EstadoAgendador {
  filaPendente: number;
  indiceCompleto: boolean;
  reembutindo: boolean;
  ultimaConsolidacaoMs: number | null;
  agoraMs: number;
  ocioso: boolean;
  missaoFechada: boolean;
}

/** Próximo trabalho a executar numa janela ociosa (ou `null`). Prioridade: fila > aquecer > consolidar > reembutir. */
export function proximoTrabalho(e: EstadoAgendador): Trabalho | null {
  if (e.filaPendente > 0) return "fila"; // fila roda mesmo sem ociosidade total (fatias ≤ 20 ms)
  if (!e.ocioso) return null;
  if (!e.indiceCompleto) return "aquecer";
  const devida = e.ultimaConsolidacaoMs === null || e.agoraMs - e.ultimaConsolidacaoMs >= INTERVALO_CONSOLIDACAO_MS;
  if (e.missaoFechada || devida) return "consolidar";
  if (e.reembutindo) return "reembutir";
  return null;
}
