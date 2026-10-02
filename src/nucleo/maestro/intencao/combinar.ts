// T-16.08 · Combinação regra × decisor (tabela de decisão pura de 8 casos; a REGRA é a autoridade).
// `r` = regra (intencao_r, conf_r), `d` = decisor externo (intencao_d, conf_d), sempre sobre as mesmas opções fechadas.
import type { FonteIntencao, Intencao } from "../../../compartilhado/maestro";

/** Acima disto o decisor nem é consultado (economiza custo e latência). */
export const CONFIANCA_REGRA_DISPENSA_DECISOR = 0.85;
export const CONFIANCA_DECISOR_MINIMA = 0.6;
export const CONFIANCA_DECISOR_FORTE = 0.8;
export const FAIXA_ALTA = 0.7;
export const FAIXA_MEDIA = 0.45;

export interface EntradaRegra {
  intencao: Intencao;
  confianca: number;
}
export interface EntradaDecisor {
  intencao: Intencao;
  confianca: number;
}
export type CasoCombinacao = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export interface ResultadoCombinacao {
  caso: CasoCombinacao;
  intencao: Intencao;
  confianca: number;
  fonte: FonteIntencao;
  divergiu: boolean;
  /** "o decisor sugeriu X" (casos 7 e 8): aparece no plano como candidata alternativa. */
  alternativa: Intencao | null;
}

/** O decisor deve ser consultado? (caso 1 dispensa.) */
export const deveConsultarDecisor = (conf_r: number): boolean => conf_r < CONFIANCA_REGRA_DISPENSA_DECISOR;

/**
 * `d === null` = decisor não respondeu (desligado, sem consentimento, breaker aberto, timeout, erro, resposta inválida);
 * `tentado` = houve chamada (para distinguir `regra` de `fallback`).
 */
export function combinarRegraEDecisor(r: EntradaRegra, d: EntradaDecisor | null, tentado = false): ResultadoCombinacao {
  const regra = (caso: CasoCombinacao, fonte: FonteIntencao, divergiu: boolean, alternativa: Intencao | null = null): ResultadoCombinacao => ({ caso, intencao: r.intencao, confianca: r.confianca, fonte, divergiu, alternativa });
  const decisor = (caso: CasoCombinacao, dd: EntradaDecisor): ResultadoCombinacao => ({ caso, intencao: dd.intencao, confianca: dd.confianca, fonte: "decisor", divergiu: true, alternativa: r.intencao });

  if (r.confianca >= CONFIANCA_REGRA_DISPENSA_DECISOR) return regra(1, "regra", false); // 1
  if (d === null) return regra(2, tentado ? "fallback" : "regra", false); // 2
  const diferente = d.intencao !== r.intencao;
  if (d.confianca < CONFIANCA_DECISOR_MINIMA) return regra(3, "regra", diferente); // 3
  if (!diferente) return { caso: 4, intencao: r.intencao, confianca: Math.max(r.confianca, d.confianca), fonte: "regra+decisor", divergiu: false, alternativa: null }; // 4
  if (r.confianca < FAIXA_MEDIA) return decisor(5, d); // 5 (d ≥ 0,60 aqui)
  if (r.confianca < FAIXA_ALTA) {
    if (d.confianca >= CONFIANCA_DECISOR_FORTE) return decisor(6, d); // 6
    return regra(7, "regra", true, d.intencao); // 7
  }
  return regra(8, "regra", true, d.intencao); // 8
}
