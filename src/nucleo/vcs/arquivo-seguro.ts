import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

/** Teto de leitura dos artefatos do método (ENTREGA.md): bem acima de qualquer entrega real. */
export const TETO_ARTEFATO_BYTES = 1024 * 1024;

/**
 * Lê um artefato que PODE ser hostil (vem do repositório do usuário): não segue symlink (nem na troca entre a checagem e a abertura:
 * `O_NOFOLLOW`), só arquivo comum e até `teto` bytes. Qualquer outra coisa = `null` (nunca lança).
 */
export async function lerArquivoSeguro(caminho: string, teto = TETO_ARTEFATO_BYTES): Promise<string | null> {
  try {
    const st = await lstat(caminho);
    if (!st.isFile() || st.size > teto) return null;
    const f = await open(caminho, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const st2 = await f.stat();
      if (!st2.isFile() || st2.size > teto) return null;
      return await f.readFile("utf8");
    } finally {
      await f.close();
    }
  } catch {
    return null;
  }
}
