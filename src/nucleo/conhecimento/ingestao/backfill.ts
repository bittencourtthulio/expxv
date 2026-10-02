// Backfill inicial (T-15.19): ao ligar o RAG num workspace, indexa em ORDEM (docs → commits → código → transcrições do app) em fatias
// curtas (≤ 20 ms), cedendo o laço entre fatias (`ceder`) e pausando sob pressão (flood de PTY). Retomável: cada fonte é incremental
// por mtime/tamanho/sha/offset em `rag_fonte`, então reexecutar só faz o que falta.
import type { DocumentoEntrada, EntradaConhecimento } from "../tipos";
import type { PipelineIngestao } from "./pipeline";

export type FaseBackfill = "docs" | "commits" | "codigo" | "transcricoes";
export const ORDEM_BACKFILL: readonly FaseBackfill[] = ["docs", "commits", "codigo", "transcricoes"];

export interface FontesBackfill {
  docs?: () => AsyncIterable<DocumentoEntrada>;
  commits?: () => AsyncIterable<EntradaConhecimento>;
  codigo?: () => AsyncIterable<DocumentoEntrada>;
  transcricoes?: () => AsyncIterable<EntradaConhecimento>;
}

export interface ProgressoBackfill {
  fase: FaseBackfill;
  feitos: number;
  novos: number;
}

export interface OpcoesBackfill {
  pipeline: PipelineIngestao;
  colecao_id: string;
  fontes: FontesBackfill;
  /** orçamento de CPU contínua por fatia (padrão 20 ms). */
  fatiaMs?: number;
  /** devolve o laço de eventos (setImmediate/await de ociosidade). */
  ceder?: () => Promise<void>;
  /** true = pausar (ex.: flood de PTY): espera `ceder` e re-testa. */
  pressao?: () => boolean;
  sinal?: AbortSignal;
  progresso?: (p: ProgressoBackfill) => void;
  agora?: () => number;
  fases?: readonly FaseBackfill[];
}

export interface ResultadoBackfill {
  feitos: number;
  novos: number;
  porFase: Record<FaseBackfill, number>;
  maiorFatiaMs: number;
  abortado: boolean;
}

export async function executarBackfill(o: OpcoesBackfill): Promise<ResultadoBackfill> {
  const agora = o.agora ?? (() => performance.now());
  const ceder = o.ceder ?? ((): Promise<void> => new Promise((r) => setImmediate(r)));
  const fatiaMs = o.fatiaMs ?? 20;
  const res: ResultadoBackfill = { feitos: 0, novos: 0, porFase: { docs: 0, commits: 0, codigo: 0, transcricoes: 0 }, maiorFatiaMs: 0, abortado: false };
  let inicioFatia = agora();
  const fecharFatia = async (): Promise<void> => {
    res.maiorFatiaMs = Math.max(res.maiorFatiaMs, agora() - inicioFatia);
    await ceder();
    while (o.pressao?.() && !o.sinal?.aborted) await ceder();
    inicioFatia = agora();
  };
  for (const fase of o.fases ?? ORDEM_BACKFILL) {
    const fonte = o.fontes[fase];
    if (!fonte) continue;
    let feitosFase = 0;
    let novosFase = 0;
    for await (const item of fonte()) {
      if (o.sinal?.aborted) {
        res.abortado = true;
        return res;
      }
      const r = "tipo" in item && "formato" in item ? [await o.pipeline.ingerir(o.colecao_id, item as DocumentoEntrada)] : await o.pipeline.ingerirEntrada(o.colecao_id, item as EntradaConhecimento);
      feitosFase++;
      res.feitos++;
      res.porFase[fase]++;
      for (const x of r) if (x.estado === "novo" || x.estado === "substituido") (novosFase++, res.novos++);
      if (agora() - inicioFatia >= fatiaMs) {
        o.progresso?.({ fase, feitos: feitosFase, novos: novosFase });
        await fecharFatia();
      }
    }
    o.progresso?.({ fase, feitos: feitosFase, novos: novosFase });
  }
  res.maiorFatiaMs = Math.max(res.maiorFatiaMs, agora() - inicioFatia);
  return res;
}
