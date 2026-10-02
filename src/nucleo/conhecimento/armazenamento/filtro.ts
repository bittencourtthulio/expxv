// AST de filtro única: validação (campos permitidos, profundidade, vazio recusado) e avaliação em memória (adaptador local/stub).
// Adaptadores online COMPILAM esta AST para o dialeto do servidor; valores nunca são concatenados em texto sem escape.
import { FiltroInvalidoErro, type Filtro, type MetaRegistro } from "./interface";

export const CAMPOS_FILTRAVEIS = ["projeto_id", "equipe_id", "tipo", "origem", "hash_conteudo", "modelo_embedding", "dimensao", "criado_em_ms"] as const;

export function validarFiltro(f: Filtro, profundidade = 0): void {
  if (profundidade > 6) throw new FiltroInvalidoErro("filtro profundo demais");
  if ("e" in f || "ou" in f) {
    const l = "e" in f ? f.e : f.ou;
    if (!Array.isArray(l) || l.length === 0 || l.length > 20) throw new FiltroInvalidoErro("filtro composto vazio ou grande demais");
    l.forEach((x) => validarFiltro(x, profundidade + 1));
    return;
  }
  if (!(CAMPOS_FILTRAVEIS as readonly string[]).includes(f.campo)) throw new FiltroInvalidoErro(`campo de filtro não permitido: ${String(f.campo).slice(0, 40)}`);
  if ("em" in f && (!Array.isArray(f.em) || f.em.length === 0 || f.em.length > 500)) throw new FiltroInvalidoErro("lista `em` vazia ou grande demais");
  if ("entre" in f && !(Array.isArray(f.entre) && f.entre.length === 2 && f.entre.every((n) => Number.isFinite(n)))) throw new FiltroInvalidoErro("intervalo inválido");
}

export function avaliarFiltro(f: Filtro | undefined, meta: MetaRegistro): boolean {
  if (f === undefined) return true;
  if ("e" in f) return f.e.every((x) => avaliarFiltro(x, meta));
  if ("ou" in f) return f.ou.some((x) => avaliarFiltro(x, meta));
  const v = (meta as unknown as Record<string, unknown>)[f.campo];
  if ("igual" in f) return v === f.igual;
  if ("em" in f) return f.em.some((x) => x === v);
  if ("entre" in f) return typeof v === "number" && v >= f.entre[0] && v <= f.entre[1];
  return false;
}

/** `apagar` com filtro vazio/indefinido é RECUSADO (nunca apagar a coleção por acidente). */
export function exigirFiltroNaoVazio(f: Filtro | undefined): asserts f is Filtro {
  if (f === undefined || (("e" in f && f.e.length === 0) || ("ou" in f && f.ou.length === 0))) throw new FiltroInvalidoErro("apagar exige um filtro não vazio");
  validarFiltro(f);
}
