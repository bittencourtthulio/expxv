// Formatador ÚNICO de custo (Fase 10): tela Consumo, Board, Missões e popover do rodapé usam o mesmo. Custo desconhecido NUNCA vira "0":
// `null` ⇒ "custo desconhecido"; `incompleto` ⇒ "≥ US$ x" (limite inferior); `aproximado` ⇒ "≈ US$ x" (preço não confirmado).
import type { CustoLeve, CustoResumo, Tokens } from "../../compartilhado/custo";

export const LEGENDA_CUSTO = "equivalente em API";
export const CUSTO_DESCONHECIDO = "custo desconhecido";
export const SEM_VALOR = "—";

export type EntradaCusto = Pick<CustoLeve, "usd" | "incompleto" | "aproximado">;

const fmt2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtN = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const finito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Só o número em dólar ("1,80"; valores minúsculos mostram 4 casas para não virarem "0,00"). */
export function formatarNumeroUsd(n: number): string {
  return n > 0 && n < 0.01 ? fmt4.format(n) : fmt2.format(n);
}

/** `≥ US$ 1,80` | `≈ US$ 1,80` | `≥ ≈ US$ 1,80` | `US$ 1,80` | `custo desconhecido`. */
export function formatarCusto(c: EntradaCusto | null | undefined): string {
  if (c === null || c === undefined || !finito(c.usd)) return CUSTO_DESCONHECIDO;
  const marca = `${c.incompleto ? "≥ " : ""}${c.aproximado ? "≈ " : ""}`;
  return `${marca}US$ ${formatarNumeroUsd(c.usd)}`;
}

/** Valor de um registro/linha (sem incompleto): `≈ US$ x` quando aproximado. */
export function formatarValorUsd(usd: number | null, aproximado = false): string {
  return formatarCusto({ usd, incompleto: false, aproximado });
}

/** "≈ R$ 9,00" só quando há câmbio manual configurado; senão `null` (nunca converte sozinho). */
export function formatarBrl(usd: number | null, cambio: number | null | undefined): string | null {
  if (!finito(usd) || !finito(cambio) || cambio <= 0) return null;
  return `≈ R$ ${fmt2.format(usd * cambio)}`;
}

export function formatarTokens(n: number): string {
  if (!finito(n) || n < 0) return SEM_VALOR;
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${fmtN.format(n / 1_000)} mil`;
  return `${fmtN.format(n / 1_000_000)} mi`;
}
export const totalTokens = (t: Tokens): number => t.entrada + t.cache_escrita + t.cache_leitura + t.saida;

/** Texto curto de incerteza para o leitor de tela e para `title`. */
export function explicarCusto(c: EntradaCusto & { fontes_ausentes?: readonly string[] }): string {
  if (!finito(c.usd)) return "Nenhum registro de uso com preço: o custo é desconhecido, não zero.";
  const partes: string[] = [];
  if (c.incompleto) partes.push("limite inferior: há uso sem preço ou sem fonte");
  if (c.aproximado) partes.push("preço não confirmado");
  if ((c.fontes_ausentes?.length ?? 0) > 0) partes.push(`sem fonte de uso: ${c.fontes_ausentes!.join(", ")}`);
  return partes.length === 0 ? `Custo ${LEGENDA_CUSTO}.` : `Custo ${LEGENDA_CUSTO}; ${partes.join("; ")}.`;
}

export const leve = (c: CustoResumo): CustoLeve => ({ usd: c.usd, incompleto: c.incompleto, aproximado: c.aproximado });
