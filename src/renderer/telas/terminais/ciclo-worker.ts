// Ciclo de vida do painel do worker na interface (D-520, 05-CONTRATOS §20): funções puras. O fechamento PEDIDO pelo app (orquestrador, dono, fim do trabalho) nunca
// aparece como painel: o main avisa (`fechada`) e a sessão sai da grade na hora. Aqui só ficam os dois fins que o dono vê: Concluído e Falhou.
import type { InfoPane } from "./missao";

/** Painel de worker que MORREU com erro (ninguém pediu) some sozinho depois disto, se o dono não interagir. */
export const PRAZO_FALHA_PAINEL_MS = 60_000;

export type ResultadoDoWorker = "concluido" | "falhou";

const PAPEIS_WORKER: ReadonlyArray<InfoPane["papel"]> = ["executor", "explorador", "revisor"];

/** O painel é de um worker (não piloto) e a sessão terminou: `erro` (ou handoff `falhou`) = falhou; `encerrada` = concluído (código 0 ou sem código). Outro caso = sem resultado de worker. */
export function resultadoDoWorker(info: InfoPane | undefined, estado: string | undefined): ResultadoDoWorker | null {
  if (info === undefined || info.ehPiloto || !PAPEIS_WORKER.includes(info.papel)) return null;
  if (estado === "erro" || (estado === "encerrada" && info.handoffFalhou === true)) return "falhou";
  if (estado === "encerrada") return "concluido";
  return null;
}

/** "Falhou (código 2)" / "Concluído". O 143 de um fechamento solicitado nunca chega (o store zera o código quando o app pediu). */
export function textoDoFimDoWorker(r: ResultadoDoWorker, codigo: number | null): string {
  if (r === "concluido") return "Concluído";
  // sem código, ou código 0 com handoff `falhou` (o processo saiu limpo, o trabalho não): sem número para não confundir
  return codigo === null || codigo === 0 ? "Falhou" : `Falhou (código ${codigo})`;
}
