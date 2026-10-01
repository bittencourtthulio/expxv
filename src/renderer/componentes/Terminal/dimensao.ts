export interface Dimensoes { colunas: number; linhas: number }

/** Resize ao PTY só quando as colunas/linhas calculadas mudam (evita SIGWINCH à toa). */
export function deveAplicarDimensao(anterior: Dimensoes | null, colunas: number, linhas: number): boolean {
  return colunas > 1 && linhas > 0 && (anterior === null || anterior.colunas !== colunas || anterior.linhas !== linhas);
}

const codificador = new TextEncoder();
/** Bytes UTF-8 de um chunk de saída: é o que o main espera na confirmação de consumo. */
export function bytesDoChunk(chunk: string): number {
  return chunk.length === 0 ? 0 : codificador.encode(chunk).length;
}
