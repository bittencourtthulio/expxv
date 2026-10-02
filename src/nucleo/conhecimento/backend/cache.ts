// "Equipe ao vivo" (opcional): consulta o remoto com timeout de 3 s e cache curto em `rag_cache_remoto`. NUNCA no caminho da consulta
// contextual (150 ms): só no chat/UI quando o usuário pede. Sem consentimento ou offline → devolve `null` (a leitura local segue).
import { createHash } from "node:crypto";
import type { ArmazenamentoConhecimento, Filtro, ResultadoBuscaArmazenamento } from "../armazenamento/interface";
import type { Repos } from "../repos";
import { podeEnviar, type EstadoReplicacao } from "./replicacao";

export const TIMEOUT_EQUIPE_MS = 3000;
export const TTL_CACHE_MS = 5 * 60 * 1000;

export async function consultarEquipe(o: { repos: Repos; armazenamento: ArmazenamentoConhecimento; estado: EstadoReplicacao; vetor: number[]; texto: string; projeto_id: string; k?: number; agoraMs?: number; timeoutMs?: number }): Promise<{ resultados: ResultadoBuscaArmazenamento[]; do_cache: boolean } | null> {
  if (!podeEnviar(o.estado)) return null;
  const agora = o.agoraMs ?? Date.now();
  const chave = createHash("sha256").update(`${o.estado.destino.colecao}\n${o.texto}\n${o.k ?? 8}`).digest("hex");
  const c = o.repos.banco.consultarUm<{ resposta_json: string; expira_em: string }>("SELECT resposta_json, expira_em FROM rag_cache_remoto WHERE chave = ?", [chave]);
  if (c && Date.parse(c.expira_em) > agora) return { resultados: JSON.parse(c.resposta_json) as ResultadoBuscaArmazenamento[], do_cache: true };
  const filtro: Filtro = { campo: "projeto_id", igual: o.projeto_id };
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    const limite = new Promise<"estourou">((r) => {
      t = setTimeout(() => r("estourou"), o.timeoutMs ?? TIMEOUT_EQUIPE_MS);
    });
    const r = await Promise.race([o.armazenamento.consultar({ vetor: o.vetor, texto: o.texto, filtro, k: o.k ?? 8 }), limite]);
    if (r === "estourou") return null;
    o.repos.banco.executar("INSERT OR REPLACE INTO rag_cache_remoto (chave, resposta_json, expira_em) VALUES (?,?,?)", [chave, JSON.stringify(r), new Date(agora + TTL_CACHE_MS).toISOString()]);
    return { resultados: r, do_cache: false };
  } catch {
    return null;
  } finally {
    if (t) clearTimeout(t);
  }
}
