// T-16.05 · Normalização do texto do pedido (puro, linear). NFD sem acento, minúsculas, remove blocos de código/citação,
// colapsa espaços, limita o tamanho. Texto dentro de bloco de código ou citação NÃO pontua (reduz injeção e ruído de log colado).
export const NORMALIZADO_MAX = 2000;
/** Entrada lida: torna a normalização linear mesmo com 100 KB patológicos. */
export const ENTRADA_MAX = 8000;

const RE_BLOCO = /```[\s\S]*?(?:```|$)/g;
const RE_INLINE = /`[^`\n]{0,300}`/g;
const RE_CITACAO = /^[ \t]*>.*$/gm;
const RE_MARCAS = /[̀-ͯ]/g;
const RE_APOSTROFO = /['’`´]/g;
// mantém letras, dígitos e `?`; o resto vira espaço (palavras separadas por 1 espaço).
const RE_SEPARADOR = /[^a-z0-9?]+/g;

/** `texto` bruto → texto normalizado (idempotente). */
export function normalizar(texto: string): string {
  const lido = texto.length > ENTRADA_MAX ? texto.slice(0, ENTRADA_MAX) : texto;
  const semCodigo = lido.replace(RE_BLOCO, " ").replace(RE_INLINE, " ").replace(RE_CITACAO, " ");
  const n = semCodigo
    .normalize("NFD")
    .replace(RE_MARCAS, "")
    .toLowerCase()
    .replace(RE_APOSTROFO, "")
    .replace(RE_SEPARADOR, " ")
    .replace(/\s*\?\s*/g, " ? ")
    .replace(/\s+/g, " ")
    .trim();
  return n.length > NORMALIZADO_MAX ? n.slice(0, NORMALIZADO_MAX).replace(/\S*$/, "").trimEnd() : n;
}

/** Palavras que, imediatamente antes de um termo, o negam (B6). */
export const NEGADORES: ReadonlySet<string> = new Set(["nao", "sem", "nunca", "not", "dont", "never", "no", "nem", "nenhum", "nenhuma"]);
/** Palavras de ligação toleradas entre o negador e o termo ("não é bug", "isn't a bug"). */
export const LIGACOES: ReadonlySet<string> = new Set(["e", "eh", "um", "uma", "o", "a", "os", "as", "is", "a", "an", "the", "ha", "ter", "ser", "mais", "tem", "foi", "era", "quero", "preciso", "precisa", "queremos", "want", "need"]);

/** O termo que começa em `indice` (posição do espaço que o antecede) está negado pelas palavras anteriores (até 3, com ligações)? */
export function negadoEm(padded: string, indice: number): boolean {
  const antes = padded.slice(Math.max(0, indice - 64), indice).trim();
  if (antes === "") return false;
  const palavras = antes.split(" ");
  const ultimo = palavras.length - 1;
  for (let k = 0; k < 3 && ultimo - k >= 0; k++) {
    const w = palavras[ultimo - k] as string;
    if (NEGADORES.has(w)) return true;
    if (!LIGACOES.has(w)) return false;
  }
  return false;
}
