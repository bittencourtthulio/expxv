// Validadores compartilhados pelos canais de domínio (workspaces, provedores, missões, método).
// Cada um reconstrói o valor (não repassa o que recebeu) e recusa o que não conhece.
import type { Resultado, Validador } from "./validar";
import { vTexto } from "./validar";

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

/** `null` ou o que o validador interno aceitar. */
export function vOuNulo<T>(interno: Validador<T>): Validador<T | null> {
  return (v) => (v === null ? ok(null) : interno(v));
}

/** Ids gerados pelo app: `<prefixo>_<ULID>`. */
const idComPrefixo = (prefixo: string): Validador<string> => vTexto({ min: 1, max: 64, padrao: new RegExp(`^${prefixo}_[0-9A-Za-z]{10,40}$`) });
export const vIdWorkspace = idComPrefixo("ws");
export const vIdMissao = idComPrefixo("mis");
export const vIdConta = idComPrefixo("conta");
export const vIdPane = idComPrefixo("pane");

/** Identificador de trabalho do método (slug, `OC-…`, `PD-…`): nunca caminho. */
export const vIdTrabalho = vTexto({ min: 1, max: 121, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/ });

/** Texto livre (título, pedido, argumento): sem NUL. O tamanho é limitado por quem chama. */
export function vTextoLivre(max: number, min = 0): Validador<string> {
  const base = vTexto({ min, max });
  return (v) => {
    const r = base(v);
    if (!r.ok) return r;
    return r.valor.includes("\0") ? falha("texto inválido") : r;
  };
}

/** Rótulo curto: sem caracteres de controle. */
export function vRotulo(max: number): Validador<string> {
  const base = vTexto({ min: 1, max });
  return (v) => {
    const r = base(v);
    if (!r.ok) return r;
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u001f\u007f]/.test(r.valor) ? falha("texto inválido") : r;
  };
}
