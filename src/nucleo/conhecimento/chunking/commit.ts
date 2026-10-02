// Commit: 1 chunk com mensagem e arquivos + 1 por arquivo relevante com diff resumido (≤ 40 linhas, sem binário, sem caminho proibido).
import { caminhoProibido } from "../seguranca";
import { montar, redigir, type ChunkPronto, type OpcoesChunking } from "./comum";

export interface ArquivoCommit {
  caminho: string;
  status: string;
  diff?: string | undefined;
}

export interface EntradaCommit {
  sha: string;
  mensagem: string;
  arquivos: readonly ArquivoCommit[];
}

export const DIFF_LINHAS_MAX = 40;

function resumirDiff(diff: string): string | null {
  if (diff.includes("\u0000") || /^Binary files /m.test(diff)) return null;
  const linhas = diff.replace(/\r\n?/g, "\n").split("\n").filter((l) => /^[+-]/.test(l) && !/^(?:\+\+\+|---)/.test(l));
  return linhas.slice(0, DIFF_LINHAS_MAX).map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l)).join("\n");
}

export function chunksDeCommit(c: EntradaCommit, op: OpcoesChunking = {}): ChunkPronto[] {
  const ok = c.arquivos.filter((a) => !caminhoProibido(a.caminho));
  const lista = ok.slice(0, 60).map((a) => `${a.status} ${a.caminho}`).join("\n");
  const itens: Array<{ texto: string; titulos?: string }> = [{ texto: redigir(`commit ${c.sha.slice(0, 12)}\n${c.mensagem.trim()}\n\nArquivos:\n${lista}`, op), titulos: `commit ${c.sha.slice(0, 12)}` }];
  for (const a of ok.slice(0, 30)) {
    if (a.diff === undefined) continue;
    const r = resumirDiff(a.diff);
    if (r === null || r === "") continue;
    itens.push({ texto: redigir(`commit ${c.sha.slice(0, 12)} › ${a.caminho}\n${r}`, op), titulos: `commit ${c.sha.slice(0, 12)} › ${a.caminho}` });
  }
  return montar(itens);
}
