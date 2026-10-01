import { ValorInvalidoErro } from "../../dominio";

/** Lê uma coluna `*_json`; JSON corrompido devolve o padrão (o banco já valida `json_valid`). */
export function lerJson<T>(texto: string | null | undefined, padrao: T): T {
  if (texto === null || texto === undefined) return padrao;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return padrao;
  }
}

export function jsonDe(campo: string, valor: unknown): string {
  const t = JSON.stringify(valor);
  if (t === undefined) throw new ValorInvalidoErro(campo, valor);
  return t;
}

/** Número finito dentro da faixa, senão erro nominal. */
export function numeroEm(campo: string, valor: unknown, min: number, max: number): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor < min || valor > max) throw new ValorInvalidoErro(campo, valor);
  return valor;
}

/** Número finito e não negativo, ou `null` (desconhecido nunca vira 0: NaN/negativo/ausente → null). */
export function numeroOuNulo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : null;
}
