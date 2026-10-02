// Fila persistente `rag_fila` (at-least-once): o chamador só ENFILEIRA (≤ 1 ms, síncrono); o worker drena em fatias.
// Fila limitada (descarta o mais antigo de menor prioridade). Falha repetida descarta o item (3 tentativas), nunca trava a fila.
import type { Repos } from "../repos";
import type { EntradaConhecimento } from "../tipos";
import type { PipelineIngestao } from "./pipeline";

export const PRIORIDADE = { usuario: 1, evento: 3, git: 5, arquivo: 6, backfill: 8 } as const;

export function enfileirar(repos: Repos, en: EntradaConhecimento, prioridade: number = PRIORIDADE.evento, colecao_id: string | null = null): void {
  repos.fila.enfileirar(JSON.stringify(en), prioridade, 5000, colecao_id);
}

export interface ResultadoDreno {
  processados: number;
  restantes: number;
  falhas: number;
}

/** Drena até `orcamentoMs` (ou `maxItens`); item inválido/ falho vira falha contada e é descartado após 3 tentativas. */
export async function drenar(p: { repos: Repos; pipeline: PipelineIngestao; colecao_id: string | ((en: EntradaConhecimento) => string | null); orcamentoMs?: number; maxItens?: number; agora?: () => number }): Promise<ResultadoDreno> {
  const agora = p.agora ?? (() => performance.now());
  const inicio = agora();
  let processados = 0;
  let falhas = 0;
  while (processados + falhas < (p.maxItens ?? 50) && agora() - inicio < (p.orcamentoMs ?? 20)) {
    const [item] = typeof p.colecao_id === "string" ? p.repos.fila.proximos(1, p.colecao_id) : p.repos.fila.proximos(1);
    if (!item) break;
    try {
      const en = JSON.parse(item.evento_json) as EntradaConhecimento;
      const col = typeof p.colecao_id === "function" ? p.colecao_id(en) : p.colecao_id;
      if (col) await p.pipeline.ingerirEntrada(col, en);
      p.repos.fila.concluir([item.id]);
      processados++;
    } catch {
      p.repos.fila.falhou(item.id);
      falhas++;
    }
  }
  return { processados, restantes: typeof p.colecao_id === "string" ? p.repos.fila.pendentes(p.colecao_id) : p.repos.fila.pendentes(), falhas };
}
