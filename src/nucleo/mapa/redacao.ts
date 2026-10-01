// Redação e sanitização (T-17.06, P-277): o mapa guarda nomes e posições, nunca código nem segredo.
//  - assinatura sanitizada: literais de texto viram `"…"`;
//  - 1ª linha do comentário de documentação: <= 160 caracteres, com padrões de segredo redigidos.

export const LIMITE_DOC = 160;
export const LIMITE_ASSINATURA = 240;
export const REDIGIDO = "[REDIGIDO]";

const SEGREDOS: ReadonlyArray<RegExp> = [
  /-----BEGIN[ A-Z]*-----[^\n]*/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
];

// `password: x`, `senha = "x"`, `api_key=x`… troca o valor, mantém o nome do campo.
const CHAVE_VALOR = /\b(password|passwd|pwd|senha|secret|segredo|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key)(\s*[:=]\s*)\S+/gi;

/** Remove padrões de segredo conhecidos. Nunca devolve o valor original dos trechos casados. */
export function redigirSegredos(texto: string): string {
  let saida = texto.replace(CHAVE_VALOR, (_m, nome: string, sep: string) => `${nome}${sep}${REDIGIDO}`);
  for (const re of SEGREDOS) saida = saida.replace(re, REDIGIDO);
  return saida;
}

const LITERAL_TEXTO = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

function cortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

/** Assinatura sanitizada de um símbolo: espaços colapsados, literais de texto viram `"…"`, segredos redigidos. */
export function sanitizarAssinatura(texto: string, max: number = LIMITE_ASSINATURA): string {
  const semLiterais = texto.replace(LITERAL_TEXTO, '"…"');
  // os literais já saíram; resta só varrer padrões de segredo que viraram identificador (não o par chave=valor)
  let saida = semLiterais.replace(/\s+/g, " ").trim();
  for (const re of SEGREDOS) saida = saida.replace(re, REDIGIDO);
  return cortar(saida, max);
}

const DIRETIVAS = /^(@|eslint-|istanbul|prettier-|tslint:|jshint|global |noinspection|c8 |v8 |#!|-\*-|vim:|type:\s*ignore|pylint:|noqa|nolint)/i;

/**
 * Primeira linha útil de um comentário de documentação (bruto, com marcadores). Ignora marcadores (`/**`, `*`, `//`,
 * `#`, `"""`), tags (`@param`) e diretivas de ferramenta. Devolve `null` se não houver texto. Sempre redigida.
 */
export function primeiraLinhaDoc(bruto: string, max: number = LIMITE_DOC): string | null {
  for (const linhaBruta of bruto.split(/\r?\n/)) {
    const linha = linhaBruta
      .replace(/^\s*(\/\*\*?|\*\/|\*|\/\/\/?|#+|"""|''')\s?/, "")
      .replace(/(\*\/|"""|''')\s*$/, "")
      .trim();
    if (linha === "" || DIRETIVAS.test(linha)) continue;
    return cortar(redigirSegredos(linha), max);
  }
  return null;
}
