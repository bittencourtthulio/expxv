// Cliente do feed de atualização (Fase 21, T-21.14): GET do manifesto e da assinatura destacada por canal. Host e caminho-base vêm do build.
// Cabeçalhos mínimos (só `If-None-Match` e `Accept`), teto de bytes, tempo-limite, cancelável; erros só por código nominal (AU-04/14/24).
import { LIMITES_ATUALIZACAO, type CanalAtualizacao } from "../../../compartilhado/atualizacao";
import { caminhoDoManifesto } from "../canais";
import { AtualizacaoErro, motivoDeErro } from "./erros";
import type { Transporte } from "./transporte";

export type RespostaFeed = { tipo: "nao_modificado" } | { tipo: "ok"; bytes: Buffer; assinatura: string; etag: string | null };

export interface ClienteFeed {
  obterManifesto(canal: CanalAtualizacao, opcoes?: { etag?: string | null; sinal?: AbortSignal }): Promise<RespostaFeed>;
}

const TIMEOUT_MS = 10_000;
const ASSINATURA_MAX = 512;

function etagSeguro(v: string | undefined): string | null {
  return v !== undefined && /^(W\/)?"[\x21\x23-\x7e]{1,100}"$/.test(v) ? v : null;
}

export function criarClienteFeed(deps: { transporte: Transporte; caminhoBase: string; timeoutMs?: number }): ClienteFeed {
  const timeout_ms = deps.timeoutMs ?? TIMEOUT_MS;
  return {
    async obterManifesto(canal, opcoes = {}) {
      const caminhos = caminhoDoManifesto(canal, deps.caminhoBase);
      const etag = etagSeguro(opcoes.etag ?? undefined);
      const base = { timeout_ms, ...(opcoes.sinal !== undefined ? { sinal: opcoes.sinal } : {}) };
      try {
        const m = await deps.transporte.requisitar({ ...base, caminho: caminhos.manifesto, max_bytes: LIMITES_ATUALIZACAO.manifesto_bytes_max, cabecalhos: { Accept: "application/json", ...(etag !== null ? { "If-None-Match": etag } : {}) } });
        if (m.status === 304) {
          if (etag === null) throw new AtualizacaoErro("servidor_hostil"); // 304 sem condicional é resposta inventada
          return { tipo: "nao_modificado" };
        }
        if (m.status !== 200) throw new AtualizacaoErro("falha_de_rede");
        if (m.corpo.length === 0 || m.corpo.length > LIMITES_ATUALIZACAO.manifesto_bytes_max) throw new AtualizacaoErro("servidor_hostil");
        const s = await deps.transporte.requisitar({ ...base, caminho: caminhos.assinatura, max_bytes: ASSINATURA_MAX, cabecalhos: { Accept: "text/plain" } });
        if (s.status !== 200 || s.corpo.length === 0 || s.corpo.length > ASSINATURA_MAX) throw new AtualizacaoErro(s.status === 200 ? "servidor_hostil" : "assinatura_ausente");
        return { tipo: "ok", bytes: m.corpo, assinatura: s.corpo.toString("utf8"), etag: etagSeguro(m.cabecalhos.etag) };
      } catch (e) {
        if (opcoes.sinal?.aborted === true) throw new AtualizacaoErro("cancelado");
        throw e instanceof AtualizacaoErro ? e : new AtualizacaoErro(motivoDeErro(e));
      }
    },
  };
}
