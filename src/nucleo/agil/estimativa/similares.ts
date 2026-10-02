// T-18.15: contexto por similaridade (PortaRag, Fase 15). Sem RAG => vazio. Nada de código: só título, pontos, categoria e duração observada.
import type { PortaRag, SimilarRag } from "../portas";

export interface ContextoSimilares { similares: SimilarRag[]; mediana_pontos: number | null; sem_retrabalho: boolean | null }

export async function buscarSimilares(rag: PortaRag, ws: string, texto: string, limite = 5): Promise<ContextoSimilares> {
  let lista: SimilarRag[] = [];
  try { lista = (await rag.buscar(ws, texto, { tipos: ["task", "relatorio", "fechamento"], limite })).slice(0, limite); } catch { lista = []; }
  const pts = lista.map((s) => s.pontos).filter((p): p is number => p !== null).sort((a, b) => a - b);
  const mediana_pontos = pts.length === 0 ? null : pts[Math.floor((pts.length - 1) / 2)] as number;
  const conhecidos = lista.filter((s) => s.retrabalho !== null);
  return { similares: lista, mediana_pontos, sem_retrabalho: conhecidos.length === 0 ? null : conhecidos.every((s) => s.retrabalho === false) };
}
