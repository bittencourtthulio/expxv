import type { VcsGitOperacoes } from "./git/vcs-git";
import type { VcsSvnOperacoes } from "./svn/vcs-svn";
import type { Capabilities, Diff, OpcoesDiff, OpcoesStatus, StatusRepo, TipoVcs } from "./tipos";

// Os tipos de dados (status, diff, commit, capabilities…) moram em `./tipos` (puros: o renderer os importa). Aqui só a interface `Vcs`.
export * from "./tipos";

export interface Vcs {
  readonly tipo: TipoVcs;
  /** Raiz (caminho real) da árvore de trabalho. */
  readonly raiz: string;
  readonly capabilities: Capabilities;
  status(op?: OpcoesStatus): Promise<StatusRepo>;
  diff(op?: OpcoesDiff): Promise<Diff>;
  /** Operações de escrita/ramos/stash/worktrees do git (6B). Ausente em SVN: a UI consulta `capabilities`. */
  readonly git?: VcsGitOperacoes;
  /** Operações do SVN (6D). Ausente no git: a UI consulta `tipo`/`capabilities`. */
  readonly svn?: VcsSvnOperacoes;
}
