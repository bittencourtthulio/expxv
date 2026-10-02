// Consolidação periódica (ocioso; no máximo 1×/6 h e ao fechar Missão): funde duplicatas, arquiva o de baixo valor
// (fator < 0,25 e sem uso há 120 d), recalcula pesos do grafo, resume o expirado, otimiza FTS/WAL. Idempotente.
import { recalcularPesos } from "../grafo/consultas";
import type { Repos } from "../repos";
import { ftsDisponivel } from "../fts";
import { jaccard, trigramas } from "./dedupe";
import { fatorTotalAprendizado } from "./decaimento";

const DIA_MS = 86_400_000;
export const INTERVALO_CONSOLIDACAO_MS = 6 * 3600 * 1000;

export interface ResultadoConsolidacao {
  fundidos: number;
  arquivados: number;
  resumidos: number;
  chunks_removidos: string[];
  nos_recalculados: number;
}

export function consolidar(repos: Repos, colecao_id: string, agora: number): ResultadoConsolidacao {
  let fundidos = 0;
  let arquivados = 0;
  const ativos = repos.aprendizado.listar(colecao_id, { limite: 500 }).filter((a) => a.estado === "candidato" || a.estado === "ativo");
  const tgs = new Map(ativos.map((a) => [a.id, trigramas(a.texto)]));
  const mortos = new Set<string>();
  const ordenados = [...ativos].sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1));
  for (let i = 0; i < ordenados.length; i++) {
    const a = ordenados[i];
    if (!a || mortos.has(a.id)) continue;
    for (let j = i + 1; j < ordenados.length; j++) {
      const b = ordenados[j];
      if (!b || mortos.has(b.id) || b.tipo !== a.tipo) continue;
      if (jaccard(tgs.get(a.id) as Set<string>, tgs.get(b.id) as Set<string>) >= 0.8) {
        repos.aprendizado.atualizar(a.id, { vezes_visto: a.vezes_visto + b.vezes_visto });
        repos.aprendizado.atualizar(b.id, { estado: "arquivado" });
        mortos.add(b.id);
        fundidos++;
      }
    }
  }
  for (const a of ativos) {
    if (mortos.has(a.id)) continue;
    const semUso = (agora - (Date.parse(a.ultimo_uso_em ?? a.criado_em) || 0)) / DIA_MS >= 120;
    if (semUso && fatorTotalAprendizado(a, agora) < 0.25) {
      repos.aprendizado.atualizar(a.id, { estado: "arquivado" });
      arquivados++;
    }
  }
  const exp = repos.documento.resumirExpirados(colecao_id, new Date(agora).toISOString());
  const nos = recalcularPesos(repos, colecao_id);
  try {
    if (ftsDisponivel(repos.banco)) repos.banco.executar("INSERT INTO rag_chunk_fts(rag_chunk_fts) VALUES ('optimize')");
    repos.banco.executar("PRAGMA optimize");
    repos.banco.executar("PRAGMA wal_checkpoint(PASSIVE)");
  } catch {
    /* manutenção é opcional */
  }
  return { fundidos, arquivados, resumidos: exp.documentos, chunks_removidos: exp.chunks, nos_recalculados: nos };
}
