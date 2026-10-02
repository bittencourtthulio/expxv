import { join } from "node:path";
import { lerArquivoSeguro } from "./arquivo-seguro";

// Commits que a mergex registrou em `docs/entregas/<trabalho_id>/ENTREGA.md` (frontmatter `commits[{task, commit}]`).
// SOMENTE LEITURA (D-04: o método é lido, nunca escrito). Parser tolerante: bloco, fluxo inline `{task: x, commit: y}`
// e itens só com o hash; hash inválido ou repetido é ignorado; teto de 500 itens.

export interface CommitEntrega {
  task: string | null;
  commit: string;
}

const HASH = /^[0-9a-f]{7,40}$/;
const MAX = 500;
const ID_TRABALHO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

const limpar = (v: string): string => v.trim().replace(/^["']|["']$/g, "").trim();

export function parseCommitsDaEntrega(md: string): CommitEntrega[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (m === null) return [];
  const linhas = (m[1] as string).split(/\r?\n/);
  const i = linhas.findIndex((l) => /^commits\s*:/.test(l));
  if (i < 0) return [];
  const bloco: string[] = [];
  for (const l of linhas.slice(i + 1)) {
    if (/^\S/.test(l) && !l.startsWith("-")) break; // próxima chave de topo
    bloco.push(l);
  }
  const itens: Array<{ task: string | null; commit: string | null }> = [];
  let atual: { task: string | null; commit: string | null } | null = null;
  const campo = (texto: string): void => {
    const t = /^task\s*:\s*(.*)$/.exec(texto);
    const c = /^commit\s*:\s*(.*)$/.exec(texto);
    if (atual === null) return;
    if (t) atual.task = limpar(t[1] as string) || null;
    else if (c) atual.commit = limpar(c[1] as string);
  };
  for (const bruta of bloco) {
    const l = bruta.trim();
    if (l === "") continue;
    if (l.startsWith("-")) {
      const resto = l.slice(1).trim();
      atual = { task: null, commit: null };
      itens.push(atual);
      if (resto.startsWith("{")) {
        for (const parte of resto.replace(/^\{|\}$/g, "").split(",")) campo(parte.trim());
      } else if (/^(task|commit)\s*:/.test(resto)) campo(resto);
      else if (HASH.test(limpar(resto))) atual.commit = limpar(resto);
    } else campo(l);
  }
  const vistos = new Set<string>();
  const saida: CommitEntrega[] = [];
  for (const it of itens) {
    if (it.commit === null || !HASH.test(it.commit) || vistos.has(it.commit)) continue;
    vistos.add(it.commit);
    saida.push({ task: it.task, commit: it.commit });
    if (saida.length >= MAX) break;
  }
  return saida;
}

/** Lê os commits da entrega do trabalho; ausente, ilegível, symlink, gigante ou id suspeito (caminho) = lista vazia. */
export async function lerCommitsDaEntrega(raizWorkspace: string, trabalhoId: string): Promise<CommitEntrega[]> {
  if (!ID_TRABALHO.test(trabalhoId)) return [];
  const md = await lerArquivoSeguro(join(raizWorkspace, "docs", "entregas", trabalhoId, "ENTREGA.md"));
  return md === null ? [] : parseCommitsDaEntrega(md);
}
