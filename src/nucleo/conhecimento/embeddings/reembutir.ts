// Reembutir em segundo plano (DEC-2 c): fatias curtas, retomável (o cursor é "chunks sem vetor do modelo novo"), consultas seguem
// no modelo anterior; `modelo_ativo` só muda quando a cobertura do novo chega a 100%. Chunks sem vetor continuam achados pelo lexical.
import type { Repos } from "../repos";
import type { ProvedorEmbedding } from "./provedor";

export interface ResultadoFatia {
  feitos: number;
  /** chunks ainda sem vetor do modelo novo (`null` quando `medir` é falso e ainda há trabalho). */
  restantes: number | null;
  /** 0..1 (`null` quando `medir` é falso e ainda há trabalho: contar 50 000 linhas a cada fatia custaria mais que a fatia). */
  cobertura: number | null;
  trocou: boolean;
}

export async function reembutirFatia(p: { repos: Repos; colecao_id: string; provedor: ProvedorEmbedding; lote?: number; orcamentoMs?: number; sinal?: AbortSignal; agora?: () => number; medir?: boolean }): Promise<ResultadoFatia> {
  const agora = p.agora ?? (() => performance.now());
  const inicio = agora();
  const lote = Math.max(1, Math.min(p.lote ?? 32, 200));
  let feitos = 0;
  const orcamento = p.orcamentoMs ?? 20;
  let ultima = 0;
  // preditivo: só começa outro lote se o anterior couber no que sobrou do orçamento (limita o estouro da fatia a ~1 lote)
  while (feitos === 0 || agora() - inicio + ultima < orcamento) {
    if (p.sinal?.aborted) break;
    const t0 = agora();
    const linhas = p.repos.vetor.semVetor(p.colecao_id, p.provedor.id, lote);
    if (linhas.length === 0) break;
    const vs = await p.provedor.embutir(linhas.map((l) => l.texto), p.sinal);
    if (vs.length !== linhas.length) throw new Error("o provedor devolveu quantidade de vetores diferente da pedida");
    p.repos.vetor.gravar(linhas.map((l, i) => ({ chunk_id: l.id, modelo: p.provedor.id, vetor: vs[i] as Float32Array })));
    feitos += linhas.length;
    ultima = agora() - t0;
  }
  // "drenado" = nenhum chunk ativo sem vetor do modelo novo (consulta barata: sai no primeiro achado)
  const drenado = p.repos.vetor.semVetor(p.colecao_id, p.provedor.id, 1).length === 0;
  let cobertura: number | null = drenado ? 1 : null;
  let restantes: number | null = drenado ? 0 : null;
  if (!drenado && p.medir !== false) {
    const { com, total } = p.repos.vetor.cobertura(p.colecao_id, p.provedor.id);
    cobertura = total === 0 ? 1 : com / total;
    restantes = total - com;
  }
  let trocou = false;
  const col = p.repos.colecao.obter(p.colecao_id);
  if (drenado && col && col.modelo_ativo !== p.provedor.id) {
    p.repos.colecao.definirModelo(p.colecao_id, p.provedor.id, p.provedor.dimensao);
    trocou = true;
  }
  return { feitos, restantes, cobertura, trocou };
}
