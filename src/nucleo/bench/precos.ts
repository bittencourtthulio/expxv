// Preços e custo (T-12.04). Custo = relatório da CLI > tokens × preço > null. NUNCA zero por falta de dado. Tabela do usuário (`bench_preco`) vem vazia; a Fase 10 entra por porta opcional
// (preço confirmado da tabela do custo). O preço usado fica CONGELADO no resultado: mudar a tabela depois não reescreve resultado antigo.
import type { CustoFonte, CustoTipo, PrecoBench } from "./tipos";
import type { PrecoCongelado } from "./tipos";

export interface UsoMedido {
  tokens_in: number | null;
  tokens_out: number | null;
  /** tokens de cache (leitura+escrita), quando a CLI separa; cobrados pelo preço de cache se houver, senão pelo de entrada. */
  tokens_cache: number | null;
  /** custo que a própria CLI relatou (USD); `null` quando não relatou. */
  custo_relatado_usd: number | null;
}
export interface CustoCalculado { custo_usd: number | null; custo_fonte: CustoFonte; custo_tipo: CustoTipo | null; preco: PrecoCongelado | null }

const finito = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
const arred6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Último preço da tabela com `vale_desde <= ts` para (provedor, modelo). */
export function precoVigente(tabela: readonly PrecoBench[], provedor: string, modelo: string, ts: string): PrecoBench | null {
  let melhor: PrecoBench | null = null;
  for (const p of tabela) {
    if (p.provedor !== provedor || p.modelo !== modelo || p.vale_desde > ts) continue;
    if (melhor === null || p.vale_desde > melhor.vale_desde) melhor = p;
  }
  return melhor;
}

export function calcularCusto(uso: UsoMedido, preco: PrecoCongelado | null, opcoes: { assinatura?: boolean } = {}): CustoCalculado {
  if (finito(uso.custo_relatado_usd)) {
    return { custo_usd: arred6(uso.custo_relatado_usd), custo_fonte: "relatorio_cli", custo_tipo: opcoes.assinatura === true ? "equivalente_api" : "medido", preco: null };
  }
  if (preco !== null && finito(uso.tokens_in) && finito(uso.tokens_out)) {
    const cache = finito(uso.tokens_cache) ? uso.tokens_cache : 0;
    const usd = (uso.tokens_in * preco.preco_in_mtok + uso.tokens_out * preco.preco_out_mtok + cache * (preco.preco_cache_mtok ?? preco.preco_in_mtok)) / 1_000_000;
    return { custo_usd: arred6(usd), custo_fonte: "tabela_precos", custo_tipo: "equivalente_api", preco };
  }
  return { custo_usd: null, custo_fonte: "desconhecido", custo_tipo: null, preco: null };
}

export function congelar(p: PrecoBench): PrecoCongelado {
  return { provedor: p.provedor, modelo: p.modelo, preco_in_mtok: p.preco_in_mtok, preco_out_mtok: p.preco_out_mtok, preco_cache_mtok: p.preco_cache_mtok, vale_desde: p.vale_desde };
}

export function validarPreco(p: PrecoBench): boolean {
  return typeof p.provedor === "string" && /^[a-z0-9][a-z0-9._-]{0,40}$/i.test(p.provedor) && typeof p.modelo === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,80}$/.test(p.modelo)
    && finito(p.preco_in_mtok) && finito(p.preco_out_mtok) && (p.preco_cache_mtok === null || finito(p.preco_cache_mtok)) && typeof p.vale_desde === "string" && !Number.isNaN(Date.parse(p.vale_desde));
}

export function mediana(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? (o[m] as number) : ((o[m - 1] as number) + (o[m] as number)) / 2;
}

/** Conversão só na EXIBIÇÃO (o banco guarda USD). `null` fica `null`. */
export function usdParaBrl(usd: number | null, cambio: number): number | null {
  return usd === null || !Number.isFinite(cambio) || cambio <= 0 ? null : Math.round(usd * cambio * 100) / 100;
}
