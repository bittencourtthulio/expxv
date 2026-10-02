// Tabela de preços: casamento do modelo por padrão (glob `*`/`?` ou id exato) e por data. PURO, sem I/O. A tabela é uma lista de `Preco`
// (embutidos + do usuário + do OpenRouter, nessa ordem de PRIORIDADE ao contrário: usuário > openrouter > embutido).
import type { OrigemPreco, Preco } from "../../compartilhado/custo";

const RANK_ORIGEM: Record<OrigemPreco, number> = { usuario: 3, openrouter: 2, embutido: 1 };

const cacheRegex = new Map<string, RegExp>();
function regexDoGlob(padrao: string): RegExp {
  let r = cacheRegex.get(padrao);
  if (r === undefined) {
    const fonte = padrao.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    r = new RegExp(`^${fonte}$`, "i");
    if (cacheRegex.size > 500) cacheRegex.clear();
    cacheRegex.set(padrao, r);
  }
  return r;
}
export const ehGlob = (padrao: string): boolean => /[*?]/.test(padrao);

/** Maior = mais específico: id exato vence qualquer glob; entre globs, vence o de mais caracteres literais. */
export function especificidade(padrao: string): number {
  if (!ehGlob(padrao)) return 1_000_000 + padrao.length;
  return padrao.replace(/[*?]/g, "").length;
}

/** Normaliza o id do modelo para o casamento: minúsculo, sem espaços; `vendor/modelo` também é tentado sem o prefixo do vendor. */
export function candidatosDoModelo(modelo: string): string[] {
  const m = modelo.trim().toLowerCase();
  if (m === "") return [];
  const sem = m.includes("/") ? m.slice(m.indexOf("/") + 1) : null;
  const semSufixo = (x: string): string => x.replace(/:[a-z0-9_-]+$/, ""); // `:free`, `:thinking`…
  const lista = [m, semSufixo(m)];
  if (sem !== null) lista.push(sem, semSufixo(sem));
  return [...new Set(lista)];
}

export function casa(padrao: string, modelo: string): boolean {
  const alvo = padrao.toLowerCase();
  return candidatosDoModelo(modelo).some((c) => (ehGlob(alvo) ? regexDoGlob(alvo).test(c) : c === alvo));
}

/**
 * Escolhe o preço do modelo no instante `ts`: só entradas com `valido_desde <= ts`; vence (1) a origem (usuário > OpenRouter > embutido),
 * (2) o casamento do id completo (`vendor/modelo`) sobre o sem vendor, (3) o padrão mais específico, (4) a validade mais recente. `null` = sem preço.
 */
export function escolherPreco(tabela: readonly Preco[], modelo: string | null | undefined, ts: string): Preco | null {
  if (modelo === null || modelo === undefined || modelo.trim() === "") return null;
  const completo = modelo.trim().toLowerCase();
  let melhor: Preco | null = null;
  let chaveMelhor: [number, number, number, string] | null = null;
  for (const p of tabela) {
    if (p.valido_desde > ts || !casa(p.padrao, modelo)) continue;
    const k: [number, number, number, string] = [RANK_ORIGEM[p.origem], p.padrao.toLowerCase() === completo ? 1 : 0, especificidade(p.padrao), p.valido_desde];
    if (chaveMelhor === null || comparar(k, chaveMelhor) > 0 || (comparar(k, chaveMelhor) === 0 && p.id < (melhor as Preco).id)) {
      melhor = p;
      chaveMelhor = k;
    }
  }
  return melhor;
}
function comparar(a: [number, number, number, string], b: [number, number, number, string]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
}

/** Modelos (do conjunto dado) para os quais a tabela não tem preço — alimenta o alerta "modelo sem preço". */
export function modelosSemPreco(tabela: readonly Preco[], modelos: Iterable<string | null>, ts: string): string[] {
  const fora = new Set<string>();
  for (const m of modelos) if (m !== null && m !== "" && escolherPreco(tabela, m, ts) === null) fora.add(m);
  return [...fora].sort();
}
