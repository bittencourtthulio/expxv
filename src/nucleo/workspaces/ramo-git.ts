// Ramo atual lido de `.git/HEAD` (um arquivo pequeno): sem processo, sem varredura. Aceita worktree (`.git` é arquivo `gitdir: …`).
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const REF = /^ref:\s*refs\/heads\/(.+)$/;

async function lerTexto(caminho: string): Promise<string | null> {
  try { return (await readFile(caminho, "utf8")).slice(0, 4_096); } catch { return null; }
}

/** `null` fora de repositório, em HEAD destacado ou em qualquer falha. Nunca lança. */
export async function ramoAtual(raiz: string): Promise<string | null> {
  try {
    let gitDir = join(raiz, ".git");
    const ponteiro = await lerTexto(gitDir);
    if (ponteiro !== null) {
      const m = /^gitdir:\s*(.+)$/m.exec(ponteiro);
      if (m === null) return null;
      const alvo = (m[1] ?? "").trim();
      gitDir = isAbsolute(alvo) ? alvo : resolve(raiz, alvo);
    }
    const head = await lerTexto(join(gitDir, "HEAD"));
    const r = head === null ? null : REF.exec(head.trim());
    const nome = r?.[1]?.trim() ?? null;
    return nome !== null && nome.length > 0 && nome.length <= 200 ? nome : null;
  } catch {
    return null;
  }
}
