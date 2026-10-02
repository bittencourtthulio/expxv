// Posições persistidas (`rag_no.x/y`): a tela abre em ≤ 100 ms sem refazer o layout. O layout de forças (Barnes-Hut) vive num
// Worker do renderer; aqui só a posição inicial determinística (espiral áurea por tipo) e a gravação validada.
import type { NoGrafo } from "../../../compartilhado/conhecimento";
import type { Repos } from "../repos";

const ANGULO_AUREO = Math.PI * (3 - Math.sqrt(5));

/** Posição inicial determinística para nós sem x/y: espiral áurea ordenada por id (mesma entrada = mesmas posições). */
export function posicionarInicial(nos: readonly NoGrafo[], raio = 40): Array<{ id: string; x: number; y: number }> {
  const sem = nos.filter((n) => n.x === null || n.y === null).sort((a, b) => (a.id < b.id ? -1 : 1));
  return sem.map((n, i) => ({ id: n.id, x: Math.round(raio * Math.sqrt(i + 1) * Math.cos(i * ANGULO_AUREO) * 100) / 100, y: Math.round(raio * Math.sqrt(i + 1) * Math.sin(i * ANGULO_AUREO) * 100) / 100 }));
}

export function gravarPosicoes(repos: Repos, posicoes: ReadonlyArray<{ id: string; x: number; y: number }>, colecao_id?: string): number {
  const validas = posicoes.slice(0, 5000).filter((p) => typeof p.id === "string" && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6);
  repos.grafo.gravarPosicoes(validas, colecao_id);
  return validas.length;
}
