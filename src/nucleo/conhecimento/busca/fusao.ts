// Fusão híbrida (RRF) + fatores + no máximo 2 chunks por documento. FUNÇÃO PURA (tabela de casos), sem E/S.
import { MAX_CHUNKS_POR_DOCUMENTO, RRF_K } from "../constantes";
import { FATOR_CANDIDATO, FATOR_MESMA_MISSAO, fatorFeedback, fatorTempo, fatorTipo } from "./fatores";

export interface MetaFusao {
  documento_id: string;
  tipo: string;
  ocorrido_em: string;
  mission_id: string | null;
  feedback: { util: number; inutil: number; errado: number };
  /** estado do aprendizado ligado ao documento (se houver). */
  aprendizado_estado?: string | null;
  /** tipo do aprendizado (meia-vida). */
  aprendizado_tipo?: string | null;
}

export interface ListaBraco {
  braco: "lexical" | "vetorial" | "grafo";
  /** ids na ordem de relevância (melhor primeiro). */
  ids: readonly string[];
  peso: number;
}

export interface OpcoesFusao {
  k: number;
  agora: number;
  mission_id?: string | null;
  /** meta por chunk; chunk sem meta é descartado. */
  meta: (chunk_id: string) => MetaFusao | undefined;
  maxPorDocumento?: number;
  /** meia-vida por tipo (dias); padrão do módulo de fatores. */
  meiaVida?: (m: MetaFusao) => number;
}

export interface Fundido {
  chunk_id: string;
  escore: number;
  braco: "lexical" | "vetorial" | "grafo" | "ambos";
}

const DIA_MS = 86_400_000;

export function fundir(listas: readonly ListaBraco[], op: OpcoesFusao): Fundido[] {
  const soma = new Map<string, number>();
  const bracos = new Map<string, Set<string>>();
  for (const l of listas) {
    l.ids.forEach((id, i) => {
      soma.set(id, (soma.get(id) ?? 0) + l.peso / (RRF_K + i + 1));
      let s = bracos.get(id);
      if (!s) bracos.set(id, (s = new Set()));
      s.add(l.braco);
    });
  }
  const pontuados: Fundido[] = [];
  for (const [id, base] of soma) {
    const m = op.meta(id);
    if (!m) continue;
    const idade = Math.max(0, (op.agora - Date.parse(m.ocorrido_em)) / DIA_MS);
    const meia = op.meiaVida ? op.meiaVida(m) : 180;
    let e = base * fatorTipo(m.tipo) * fatorFeedback(m.feedback) * fatorTempo(Number.isFinite(idade) ? idade : 0, meia);
    if (op.mission_id && m.mission_id === op.mission_id) e *= FATOR_MESMA_MISSAO;
    if (m.aprendizado_estado === "candidato") e *= FATOR_CANDIDATO;
    const b = bracos.get(id) as Set<string>;
    pontuados.push({ chunk_id: id, escore: e, braco: b.size > 1 ? "ambos" : b.has("lexical") ? "lexical" : b.has("grafo") ? "grafo" : "vetorial" });
  }
  pontuados.sort((a, b) => b.escore - a.escore || (a.chunk_id < b.chunk_id ? -1 : 1));
  const porDoc = new Map<string, number>();
  const saida: Fundido[] = [];
  const max = op.maxPorDocumento ?? MAX_CHUNKS_POR_DOCUMENTO;
  for (const p of pontuados) {
    const m = op.meta(p.chunk_id) as MetaFusao;
    const n = porDoc.get(m.documento_id) ?? 0;
    if (n >= max) continue;
    porDoc.set(m.documento_id, n + 1);
    saida.push(p);
    if (saida.length >= op.k) break;
  }
  return saida;
}
