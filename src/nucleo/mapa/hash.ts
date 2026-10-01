import { createHash } from "node:crypto";

/**
 * Normaliza o conteúdo para o hash: remove BOM UTF-8 e converte CRLF/CR em LF. Assim, salvar o arquivo com outro
 * fim de linha ou BOM não invalida o cache incremental.
 */
export function normalizarConteudo(buf: Buffer): string {
  let inicio = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) inicio = 3;
  const texto = buf.toString("utf8", inicio);
  return texto.includes("\r") ? texto.replace(/\r\n?/g, "\n") : texto;
}

/** SHA-1 (hex) do conteúdo normalizado. Não é segurança criptográfica: é só identidade de conteúdo. */
export function hashConteudo(buf: Buffer): string {
  const precisaNormalizar = buf.includes(13) || (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
  return createHash("sha1").update(precisaNormalizar ? normalizarConteudo(buf) : buf).digest("hex");
}
