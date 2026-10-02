// Cálculo de custo de um registro de uso (T-10.03). PURO. Regras (D-105): modelo sem preço ⇒ `usd:null` (nunca 0 por omissão); `0` só quando os tokens são 0; valor medido pela
// própria fonte (`costUSD` do transcript, `usage.cost` do proxy) vence a tabela; preço sem tarifa de cache ⇒ tarifa DERIVADA e `aproximado:true`; `confirmado:false` ⇒ `aproximado:true`.
import type { OrigemUsd, Preco, Tokens } from "../../compartilhado/custo";
import { escolherPreco } from "./precos";

export interface ResultadoUsd {
  usd: number | null;
  origem: OrigemUsd;
  preco_id: string | null;
  aproximado: boolean;
}
export interface UsdMedido {
  usd: number;
  origem: "cli" | "proxy";
}

/**
 * Razões de derivação da tarifa de cache quando a entrada não a informa (documentadas e sempre `aproximado`):
 * - família `anthropic`: escrita = 1,25 × entrada (TTL de 5 min), leitura = 0,10 × entrada;
 * - família `openai`/`google`: escrita = 1,0 × entrada (não há cobrança extra pela escrita), leitura = 0,25 × entrada quando não informada;
 * - família desconhecida (inclui preços vindos do OpenRouter, que não trazem tarifa de cache): escrita = leitura = 1,0 × entrada — limite superior conservador.
 */
export const RAZOES_CACHE: Readonly<Record<string, { escrita: number; leitura: number }>> = {
  anthropic: { escrita: 1.25, leitura: 0.1 },
  openai: { escrita: 1, leitura: 0.25 },
  google: { escrita: 1, leitura: 0.25 },
};
const RAZAO_GENERICA = { escrita: 1, leitura: 1 };

export const tokensZerados = (): Tokens => ({ entrada: 0, cache_escrita: 0, cache_leitura: 0, saida: 0 });
export const totalTokens = (t: Tokens): number => t.entrada + t.cache_escrita + t.cache_leitura + t.saida;
export function somarTokens(a: Tokens, b: Tokens): Tokens {
  return { entrada: a.entrada + b.entrada, cache_escrita: a.cache_escrita + b.cache_escrita, cache_leitura: a.cache_leitura + b.cache_leitura, saida: a.saida + b.saida };
}

/** Arredonda em 1e-9 US$ para o acumulado não carregar ruído de ponto flutuante. */
export const arredondarUsd = (x: number): number => Math.round(x * 1e9) / 1e9;

export function registroParaUsd(tokens: Tokens, modelo: string | null | undefined, ts: string, tabela: readonly Preco[], medido?: UsdMedido | null): ResultadoUsd {
  if (medido !== undefined && medido !== null && Number.isFinite(medido.usd) && medido.usd >= 0) {
    return { usd: arredondarUsd(medido.usd), origem: medido.origem, preco_id: null, aproximado: false };
  }
  if (totalTokens(tokens) === 0) return { usd: 0, origem: "tabela", preco_id: null, aproximado: false };
  const preco = escolherPreco(tabela, modelo, ts);
  if (preco === null) return { usd: null, origem: "desconhecido", preco_id: null, aproximado: false };
  const razao = (preco.familia !== null ? RAZOES_CACHE[preco.familia] : undefined) ?? RAZAO_GENERICA;
  let derivado = false;
  let escrita = preco.cache_escrita_por_mtok;
  let leitura = preco.cache_leitura_por_mtok;
  if (escrita === null) {
    escrita = preco.entrada_por_mtok * razao.escrita;
    if (tokens.cache_escrita > 0) derivado = true;
  }
  if (leitura === null) {
    leitura = preco.entrada_por_mtok * razao.leitura;
    if (tokens.cache_leitura > 0) derivado = true;
  }
  const usd = (tokens.entrada * preco.entrada_por_mtok + tokens.saida * preco.saida_por_mtok + tokens.cache_escrita * escrita + tokens.cache_leitura * leitura) / 1e6;
  return { usd: arredondarUsd(usd), origem: "tabela", preco_id: preco.id, aproximado: derivado || !preco.confirmado };
}
