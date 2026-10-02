export * from "./vcs";
export * from "./detectar";
export * from "./executor";
export * from "./observador";
export * from "./cache";
export { statusGit, parseStatusV2, statusVazio, CONFLITOS_XY, LIMITE_DEGRADAR_MS } from "./git/status";
export type { OpcoesStatusGit } from "./git/status";
export { diffGit, parseDiff, ParserDiff, desaspar, caminhoRelativoSeguro, LIMITE_DIFF_BYTES } from "./git/diff";
export type { OpcoesDiffGit } from "./git/diff";
export { criarVcsGit } from "./git/vcs-git";
export type { VcsGit, VcsGitOperacoes } from "./git/vcs-git";
export * from "./git/estagiar";
export * from "./git/commit";
export * from "./git/ramos";
export * from "./git/stash";
export * from "./git/worktrees";
export { validarNomeRef, resolverRev } from "./git/comum";
export * from "./git/guardas";
export * from "./git/log";
export * from "./git/remotos";
export * from "./git/merge";
export * from "./git/conflitos";
export * from "./git/reflog";
export * from "./git/submodulos";
export * from "./git/especiais";
export { criarVcsSvn } from "./svn/vcs-svn";
export type { VcsSvn, VcsSvnOperacoes, OpcoesVcsSvn } from "./svn/vcs-svn";
export * from "./svn/comum";
export * from "./svn/info";
export * from "./svn/status";
export * from "./svn/diff";
export * as svnManutencao from "./svn/manutencao";
export * from "./svn/commit";
export * from "./svn/historico";
export * from "./svn/ramos";
export * from "./svn/missao";
export * from "./svn/auth";
export * from "./svn/gitsvn";

import { detectar } from "./detectar";
import { criarVcsGit } from "./git/vcs-git";
import { criarVcsSvn } from "./svn/vcs-svn";
import type { Confianca } from "./executor";
import type { Vcs } from "./vcs";

/** Abre o `Vcs` da pasta, ou null quando não há provedor (nenhum, ou svn sem o binário instalado). */
export async function abrirVcs(dir: string, limite?: string, opcoes: { confianca?: Confianca; janelaEmFoco?: () => boolean } = {}): Promise<Vcs | null> {
  const d = await detectar(dir, limite === undefined ? {} : { limite });
  if ((d.tipo === "git" || d.tipo === "git-svn") && d.raiz !== null) return criarVcsGit(d.raiz, { tipo: d.tipo, ...opcoes });
  if (d.tipo === "svn" && d.raiz !== null && d.svn?.binario === true) return criarVcsSvn(d.raiz, {});
  return null;
}
