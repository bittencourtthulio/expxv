/**
 * Validadores puros de payload de IPC. O main NUNCA confia no renderer: cada canal tem um validador
 * que reconstrói o objeto campo a campo (descarta o que não conhece — não repassa o objeto recebido).
 * Sem dependência externa (peso e velocidade).
 */

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string };
export type Validador<T> = (valor: unknown) => Resultado<T>;

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

export const vVazio: Validador<undefined> = (v) => (v === undefined ? ok(undefined) : falha("esperado sem payload"));

export function vTexto(op: { min?: number; max: number; padrao?: RegExp }): Validador<string> {
  return (v) => {
    if (typeof v !== "string") return falha("esperado texto");
    if (v.length < (op.min ?? 0)) return falha("texto curto demais");
    if (v.length > op.max) return falha("texto longo demais");
    if (op.padrao !== undefined && !op.padrao.test(v)) return falha("formato inválido");
    return ok(v);
  };
}

export function vInteiro(op: { min: number; max: number }): Validador<number> {
  return (v) => {
    if (typeof v !== "number" || !Number.isInteger(v)) return falha("esperado inteiro");
    if (v < op.min || v > op.max) return falha("inteiro fora da faixa");
    return ok(v);
  };
}

export function vEnum<const T extends string>(valores: readonly T[]): Validador<T> {
  return (v) => (typeof v === "string" && (valores as readonly string[]).includes(v) ? ok(v as T) : falha("valor fora do conjunto"));
}

export const vBooleano: Validador<boolean> = (v) => (typeof v === "boolean" ? ok(v) : falha("esperado booleano"));

/** Aceita qualquer valor JSON serializável pequeno (config). Limita o tamanho serializado. */
export function vJson(maxBytes: number): Validador<unknown> {
  return (v) => {
    try {
      const texto = JSON.stringify(v);
      if (texto === undefined) return falha("valor não serializável");
      if (Buffer.byteLength(texto, "utf8") > maxBytes) return falha("valor grande demais");
      return ok(JSON.parse(texto) as unknown);
    } catch {
      return falha("valor não serializável");
    }
  };
}

type Campos = Record<string, Validador<unknown>>;
type SaidaCampos<C extends Campos> = { [K in keyof C]: C[K] extends Validador<infer T> ? T : never };

/** Objeto ESTRITO: campo extra ou ausente é erro. */
export function vObjeto<C extends Campos>(campos: C): Validador<SaidaCampos<C>> {
  return (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
    const entrada = v as Record<string, unknown>;
    for (const chave of Object.keys(entrada)) {
      if (!(chave in campos)) return falha(`campo desconhecido: ${chave}`);
    }
    const saida: Record<string, unknown> = {};
    for (const [chave, validador] of Object.entries(campos)) {
      if (!(chave in entrada)) return falha(`campo ausente: ${chave}`);
      const r = validador(entrada[chave]);
      if (!r.ok) return falha(`${chave}: ${r.erro}`);
      saida[chave] = r.valor;
    }
    return ok(saida as SaidaCampos<C>);
  };
}

export function vLista<T>(item: Validador<T>, max: number): Validador<T[]> {
  return (v) => {
    if (!Array.isArray(v)) return falha("esperado lista");
    if (v.length > max) return falha("lista grande demais");
    const saida: T[] = [];
    for (const elemento of v) {
      const r = item(elemento);
      if (!r.ok) return falha(r.erro);
      saida.push(r.valor);
    }
    return ok(saida);
  };
}
