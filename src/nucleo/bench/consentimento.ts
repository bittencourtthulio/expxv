// Consentimento humano de USO ÚNICO e TTL 120 s (princípio 1 da Fase 12). Puro, com relógio injetado. Cada Run, re-run e julgamento consome um token próprio,
// atrelado à ESTIMATIVA (alvos, tarefas, pesos, teto, juiz): se qualquer coisa mudar, o token deixa de valer. Agente (MCP) não tem como obter token: só o canal da UI chama `consentir`.
import { randomBytes } from "node:crypto";
import { FRASE_CONSENTIMENTO, FRASE_CONSENTIMENTO_SEM_SANDBOX, TTL_CONSENTIMENTO_S, type Estimativa } from "./tipos";

export type FinalidadeToken = "rodar" | "rerodar" | "julgar";
export interface EstimativaGuardada { estimativa: Estimativa; assinatura: string; pesos: { q: number; s: number; c: number }; max_paralelo: number; juiz_alvo: string | null; criada_em: number }
interface TokenGuardado { estimativa_id: string; assinatura: string; expira_em: number; finalidade: FinalidadeToken }

export function assinaturaDe(p: { tarefas: readonly string[]; alvos: readonly string[]; pesos: { q: number; s: number; c: number }; teto_usd: number | null; max_paralelo: number; juiz_alvo: string | null }): string {
  return JSON.stringify([[...p.tarefas].sort(), [...p.alvos].sort(), p.pesos, p.teto_usd, p.max_paralelo, p.juiz_alvo]);
}

export interface CofreConsentimento {
  guardarEstimativa(g: EstimativaGuardada): void;
  estimativa(id: string): EstimativaGuardada | null;
  /** `null` quando a frase não confere. */
  consentir(estimativaId: string, confirmacao: string, finalidade?: FinalidadeToken): { token: string; expira_em: string } | { erro: "confirmacao_invalida" | "estimativa_desconhecida" };
  /**
   * Consome o token (uso único; some mesmo quando não confere). Devolve a estimativa guardada, ou `null` para token ausente, expirado, reutilizado, de outra finalidade, de outra
   * estimativa (`estimativaId` não nulo) ou com a assinatura alterada (`assinaturaAtual` não nula: tarefas/versões/alvos/pesos mudaram desde o `estimar`).
   */
  consumir(token: string, estimativaId: string | null, assinaturaAtual: string | null, finalidade: FinalidadeToken): EstimativaGuardada | null;
  /** descarta os tokens (fechar o diálogo). */
  descartar(estimativaId: string): void;
}

export function criarCofreConsentimento(relogio: () => number = Date.now, ttlS: number = TTL_CONSENTIMENTO_S): CofreConsentimento {
  const estimativas = new Map<string, EstimativaGuardada>();
  const tokens = new Map<string, TokenGuardado>();
  const podar = (): void => {
    const agora = relogio();
    for (const [t, g] of tokens) if (g.expira_em <= agora) tokens.delete(t);
    for (const [id, e] of estimativas) if (agora - e.criada_em > 30 * 60_000) estimativas.delete(id);
  };
  return {
    guardarEstimativa(g) {
      podar();
      estimativas.set(g.estimativa.estimativa_id, g);
    },
    estimativa: (id) => estimativas.get(id) ?? null,
    consentir(estimativaId, confirmacao, finalidade = "rodar") {
      podar();
      const g = estimativas.get(estimativaId);
      if (g === undefined) return { erro: "estimativa_desconhecida" };
      const frase = g.estimativa.frase_exigida;
      if (frase === null || (frase !== FRASE_CONSENTIMENTO && frase !== FRASE_CONSENTIMENTO_SEM_SANDBOX) || confirmacao !== frase) return { erro: "confirmacao_invalida" };
      const token = randomBytes(24).toString("hex");
      const expira = relogio() + ttlS * 1000;
      tokens.set(token, { estimativa_id: estimativaId, assinatura: g.assinatura, expira_em: expira, finalidade });
      return { token, expira_em: new Date(expira).toISOString() };
    },
    consumir(token, estimativaId, assinaturaAtual, finalidade) {
      podar();
      const g = tokens.get(token);
      if (g === undefined) return null;
      tokens.delete(token); // uso único: some mesmo quando não confere
      const est = estimativas.get(g.estimativa_id);
      if (est === undefined || g.expira_em <= relogio() || g.finalidade !== finalidade) return null;
      if (estimativaId !== null && g.estimativa_id !== estimativaId) return null;
      if (assinaturaAtual !== null && g.assinatura !== assinaturaAtual) return null;
      return est;
    },
    descartar(estimativaId) {
      for (const [t, g] of tokens) if (g.estimativa_id === estimativaId) tokens.delete(t);
    },
  };
}
