// Tabela de preços EMBUTIDA (T-10.03). Valores em US$ por milhão de tokens, públicos nas páginas de preço dos provedores na data de coleta.
// REGRAS: toda entrada nasce `confirmado:false` (o dono confirma pela tela; até lá o custo sai com "≈"); só entra o que tem fonte e data (P-39: em dúvida, OMITIR —
// `null` é honesto, número inventado não); modelo novo sem entrada aqui devolve `usd:null` e dispara o alerta "modelo sem preço". Famílias com glob só cobrem o que
// a fonte confirma (`claude-opus-4-5*` NÃO cobre o Opus que vier depois). `cache_*: null` ⇒ derivado por razão documentada em `calcular.ts` e marcado `aproximado`.
export interface PrecoPadrao {
  padrao: string;
  familia: string;
  entrada_por_mtok: number;
  saida_por_mtok: number;
  cache_escrita_por_mtok: number | null;
  cache_leitura_por_mtok: number | null;
}
/** Data de validade inicial das entradas (início do período coberto): o preço gravado no registro é CONGELADO, então a data só ordena versões futuras. */
export const PRECOS_VALIDOS_DESDE = "2025-01-01T00:00:00.000Z";
export const PRECOS_FONTE = "tabela pública de preços do provedor";
export const PRECOS_COLETADO_EM = "2026-10-01T00:00:00.000Z";

const A = "anthropic";
const O = "openai";
const G = "google";
export const PRECOS_PADRAO: readonly PrecoPadrao[] = [
  { padrao: "claude-opus-4-5*", familia: A, entrada_por_mtok: 5, saida_por_mtok: 25, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null },
  { padrao: "claude-opus-4-1*", familia: A, entrada_por_mtok: 15, saida_por_mtok: 75, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null },
  { padrao: "claude-opus-4-2025*", familia: A, entrada_por_mtok: 15, saida_por_mtok: 75, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null },
  { padrao: "claude-sonnet-4*", familia: A, entrada_por_mtok: 3, saida_por_mtok: 15, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null },
  { padrao: "claude-3-7-sonnet*", familia: A, entrada_por_mtok: 3, saida_por_mtok: 15, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null },
  { padrao: "claude-3-5-sonnet*", familia: A, entrada_por_mtok: 3, saida_por_mtok: 15, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null },
  { padrao: "claude-haiku-4-5*", familia: A, entrada_por_mtok: 1, saida_por_mtok: 5, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null },
  { padrao: "claude-3-5-haiku*", familia: A, entrada_por_mtok: 0.8, saida_por_mtok: 4, cache_escrita_por_mtok: null, cache_leitura_por_mtok: null },
  { padrao: "gpt-5", familia: O, entrada_por_mtok: 1.25, saida_por_mtok: 10, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.125 },
  { padrao: "gpt-5-codex", familia: O, entrada_por_mtok: 1.25, saida_por_mtok: 10, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.125 },
  { padrao: "gpt-5-mini", familia: O, entrada_por_mtok: 0.25, saida_por_mtok: 2, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.025 },
  { padrao: "gpt-5-nano", familia: O, entrada_por_mtok: 0.05, saida_por_mtok: 0.4, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.005 },
  { padrao: "gpt-4.1", familia: O, entrada_por_mtok: 2, saida_por_mtok: 8, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.5 },
  { padrao: "gpt-4.1-mini", familia: O, entrada_por_mtok: 0.4, saida_por_mtok: 1.6, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.1 },
  { padrao: "o3", familia: O, entrada_por_mtok: 2, saida_por_mtok: 8, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.5 },
  { padrao: "o4-mini", familia: O, entrada_por_mtok: 1.1, saida_por_mtok: 4.4, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.275 },
  { padrao: "gemini-2.5-pro", familia: G, entrada_por_mtok: 1.25, saida_por_mtok: 10, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.31 },
  { padrao: "gemini-2.5-flash", familia: G, entrada_por_mtok: 0.3, saida_por_mtok: 2.5, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.075 },
];
