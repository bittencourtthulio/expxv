// Padding de quadros do relay (T-22.09, D-355): aplicado ao CLARO, ANTES de selar (o relay só vê o tamanho do bloco + 28 B de invólucro). Blocos de 256 B / 1 KiB / 4 KiB (acima, múltiplos de 4 KiB), com quadros de enchimento. Formato:
//   [tipo:1 (0 dado, 1 enchimento)] [comprimento:2 BE] [conteúdo] [bytes aleatórios até o bloco]
// Espelho de `src/nucleo/remoto-estendido/padding.ts`.
export const BLOCOS = [256, 1024, 4096];
export const CABECALHO = 3;
export const MAX_CONTEUDO = 15 * 4096 - CABECALHO; // com o invólucro (+28 B) o quadro fecha em 61 468 B, abaixo do teto de 64 KiB do relay

export function tamanhoDoBloco(n) {
  for (const b of BLOCOS) if (n <= b) return b;
  return Math.ceil(n / 4096) * 4096;
}
/** `aleatorio(n)` injetável (teste). `conteudo` null = quadro de enchimento (comprimento 0, tipo 1). */
export function preencher(conteudo, aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n)), tamanhoEnchimento = 256) {
  const dado = conteudo !== null;
  const c = dado ? conteudo : new Uint8Array(0);
  if (c.length > MAX_CONTEUDO) throw new RangeError("quadro_grande");
  const total = dado ? tamanhoDoBloco(CABECALHO + c.length) : tamanhoEnchimento;
  const out = new Uint8Array(total);
  out[0] = dado ? 0 : 1;
  out[1] = (c.length >> 8) & 255;
  out[2] = c.length & 255;
  out.set(c, CABECALHO);
  const resto = total - CABECALHO - c.length;
  if (resto > 0) out.set(aleatorio(resto), CABECALHO + c.length);
  return out;
}
/** Retorna `{tipo:"dado"|"enchimento", conteudo}` ou `null` se o quadro for inválido. Nunca lança. */
export function remover(quadro) {
  if (!(quadro instanceof Uint8Array) || quadro.length < CABECALHO || quadro.length > 15 * 4096) return null;
  const tipo = quadro[0];
  const len = (quadro[1] << 8) | quadro[2];
  if ((tipo !== 0 && tipo !== 1) || CABECALHO + len > quadro.length) return null;
  if (tipo === 1 && len !== 0) return null;
  if (tipo === 0 && quadro.length !== tamanhoDoBloco(CABECALHO + len)) return null; // tamanho tem de ser exatamente o bloco: nada de quadros "esquisitos"
  return { tipo: tipo === 0 ? "dado" : "enchimento", conteudo: quadro.subarray(CABECALHO, CABECALHO + len) };
}
