// Primitivas extras de validação para as famílias limites/harness/cofre/openrouter (Fase 9).
// Mesmas regras de validar.ts: reconstrói o valor, recusa o que não conhece, sem dependência externa.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import type { Resultado, Validador } from "./validar";
import { vTexto } from "./validar";

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

/** Número finito (sem NaN/Infinity) dentro da faixa. */
export function vNumero(op: { min: number; max: number }): Validador<number> {
  return (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return falha("esperado número finito");
    if (v < op.min || v > op.max) return falha("número fora da faixa");
    return ok(v);
  };
}

/** Percentual 0..100 (inclusive). */
export const vPct: Validador<number> = vNumero({ min: 0, max: 100 });

export const vVerdadeiro: Validador<true> = (v) => (v === true ? ok(true as const) : falha("esperado true"));

/** Campos opcionais: ausente ou `undefined` = omitido do resultado; presente é validado. Objeto ESTRITO. */
type Campos = Record<string, Validador<unknown>>;
type SaidaObrig<C extends Campos> = { [K in keyof C]: C[K] extends Validador<infer T> ? T : never };
type SaidaOpc<C extends Campos> = { [K in keyof C]?: C[K] extends Validador<infer T> ? T : never };
export function vObjetoOpc<O extends Campos, P extends Campos>(obrigatorios: O, opcionais: P): Validador<SaidaObrig<O> & SaidaOpc<P>> {
  return (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
    const entrada = v as Record<string, unknown>;
    for (const chave of Object.keys(entrada)) {
      if (!(chave in obrigatorios) && !(chave in opcionais)) return falha(`campo desconhecido: ${chave}`);
    }
    const saida: Record<string, unknown> = {};
    for (const [chave, validador] of Object.entries(obrigatorios)) {
      if (!(chave in entrada) || entrada[chave] === undefined) return falha(`campo ausente: ${chave}`);
      const r = validador(entrada[chave]);
      if (!r.ok) return falha(`${chave}: ${r.erro}`);
      saida[chave] = r.valor;
    }
    for (const [chave, validador] of Object.entries(opcionais)) {
      if (!(chave in entrada) || entrada[chave] === undefined) continue;
      const r = validador(entrada[chave]);
      if (!r.ok) return falha(`${chave}: ${r.erro}`);
      saida[chave] = r.valor;
    }
    return ok(saida as SaidaObrig<O> & SaidaOpc<P>);
  };
}

/** Lista com tamanho mínimo (ex.: `fallback` nunca vazio). */
export function vListaMin<T>(item: Validador<T>, min: number, max: number): Validador<T[]> {
  return (v) => {
    if (!Array.isArray(v)) return falha("esperado lista");
    if (v.length < min) return falha("lista curta demais");
    if (v.length > max) return falha("lista grande demais");
    const saida: T[] = [];
    for (const e of v) {
      const r = item(e);
      if (!r.ok) return falha(r.erro);
      saida.push(r.valor);
    }
    return ok(saida);
  };
}

/** Mapa chave→valor com chaves validadas (ex.: provedor→faixas). */
export function vRegistro<T>(chave: Validador<string>, valor: Validador<T>, max: number): Validador<Record<string, T>> {
  return (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
    const entradas = Object.entries(v as Record<string, unknown>);
    if (entradas.length > max) return falha("objeto grande demais");
    const saida: Record<string, T> = Object.create(null) as Record<string, T>;
    for (const [k, x] of entradas) {
      const rk = chave(k);
      if (!rk.ok) return falha(`chave inválida: ${rk.erro}`);
      const rv = valor(x);
      if (!rv.ok) return falha(`${k}: ${rv.erro}`);
      saida[rk.valor] = rv.valor;
    }
    return ok({ ...saida });
  };
}

/** Objeto parcial: só as chaves permitidas, cada uma opcional (ex.: `Partial<Record<Faixa, …>>`). */
export function vParcial<T>(chaves: readonly string[], valor: Validador<T>): Validador<Record<string, T>> {
  return (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
    const saida: Record<string, T> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!chaves.includes(k)) return falha(`campo desconhecido: ${k}`);
      if (x === undefined) continue;
      const r = valor(x);
      if (!r.ok) return falha(`${k}: ${r.erro}`);
      saida[k] = r.valor;
    }
    return ok(saida);
  };
}

/** `null` ou o que o validador interno aceitar. */
export function vNulavel<T>(interno: Validador<T>): Validador<T | null> {
  return (v) => (v === null ? ok(null) : interno(v));
}

/** Texto que não pode parecer caminho nem URL: rótulos, slugs, buscas e nomes nunca carregam isso. */
export function vSemCaminhoNemUrl(op: { min?: number; max: number; padrao?: RegExp }): Validador<string> {
  const base = vTexto(op);
  return (v) => {
    const r = base(v);
    if (!r.ok) return r;
    const t = r.valor;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(t)) return falha("texto inválido");
    if (/[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(?:www\.)/i.test(t)) return falha("URL não permitida neste campo");
    if (/^[\\/~]/.test(t) || /^[a-z]:[\\/]/i.test(t) || t.includes("..") || /[\\]/.test(t)) return falha("caminho não permitido neste campo");
    return ok(t);
  };
}

/** Texto livre do usuário (descrição de tarefa, texto de intenção): sem NUL; tamanho limitado por quem chama. */
export function vTextoUsuario(max: number, min = 0): Validador<string> {
  const base = vTexto({ min, max });
  return (v) => {
    const r = base(v);
    if (!r.ok) return r;
    return r.valor.includes("\0") ? falha("texto inválido") : r;
  };
}

/** Instante UTC ISO 8601 (`2026-01-02T03:04:05.006Z`, ms opcionais). */
export const vInstante: Validador<string> = (v) => {
  if (typeof v !== "string" || v.length > 30 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)) return falha("esperado instante ISO UTC");
  return Number.isNaN(Date.parse(v)) ? falha("instante inválido") : ok(v);
};

/** Endpoint https sem credencial embutida, sem fragmento e sem espaço. Nunca http, nunca outro esquema. */
export const vEndpointHttps: Validador<string> = (v) => {
  if (typeof v !== "string" || v.length === 0 || v.length > 300) return falha("endpoint inválido");
  if (/\s/.test(v)) return falha("endpoint inválido");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return falha("endpoint inválido");
  }
  if (u.protocol !== "https:") return falha("endpoint precisa ser https");
  if (u.username !== "" || u.password !== "") return falha("endpoint não pode ter credencial");
  if (u.hash !== "") return falha("endpoint inválido");
  if (u.hostname === "") return falha("endpoint inválido");
  return ok(v);
};

/** Host DNS simples (sem esquema, porta, caminho). */
export const vHost: Validador<string> = vTexto({ min: 1, max: 253, padrao: /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i });

/** Host de um endpoint já validado (minúsculo). */
export function hostDe(endpoint: string): string {
  return new URL(endpoint).hostname.toLowerCase();
}

/** Um validador por canal de uma família, cada um produzindo exatamente o tipo de `entrada` do contrato. */
export type ValidadoresDaFamilia<Prefixo extends string> = {
  [C in Extract<keyof CanaisInvoke, `${Prefixo}${string}`>]: Validador<CanaisInvoke[C]["entrada"]>;
};
