import { rodarGit, type OpcoesBase } from "../git/comum";
import { exigirConfirmacaoServidor, SvnRecusadoErro, type ConfirmacaoServidor } from "./comum";

// T-06.30: repositórios `git svn` são tratados como git (`detectar` -> tipo "git-svn"); só `git svn rebase` e
// `git svn dcommit` são ações específicas e EXIGEM confirmação explícita (`confirmadoServidor: true`, origem usuário).
// `dcommit` grava no servidor SVN (um commit SVN por commit git) e reescreve o histórico local.

export interface InfoGitSvn {
  url: string | null;
  fetch: string | null;
}

export async function infoGitSvn(raiz: string, op: OpcoesBase = {}): Promise<InfoGitSvn> {
  const cfg = async (k: string): Promise<string | null> => {
    const r = await rodarGit(raiz, ["config", "--get", k], { ...op, tolerar: [1] });
    return r.codigo === 0 ? r.stdout.trim() || null : null;
  };
  return { url: await cfg("svn-remote.svn.url"), fetch: await cfg("svn-remote.svn.fetch") };
}

async function exigirArvoreLimpa(raiz: string, op: OpcoesBase): Promise<void> {
  const r = await rodarGit(raiz, ["status", "--porcelain", "--untracked-files=no"], op);
  if (r.stdout.trim() !== "") throw new SvnRecusadoErro("A árvore tem alterações não salvas: faça commit ou stash antes.", "arvore-suja");
}

export interface ResultadoGitSvn {
  simulado: boolean;
  saida: string;
}

/** `git svn rebase`: traz revisões novas do servidor e re-aplica os commits locais. */
export async function gitSvnRebase(raiz: string, op: Partial<ConfirmacaoServidor> & OpcoesBase & { origem: ConfirmacaoServidor["origem"] }): Promise<ResultadoGitSvn> {
  exigirConfirmacaoServidor("git svn rebase", op as ConfirmacaoServidor);
  await exigirArvoreLimpa(raiz, op);
  const r = await rodarGit(raiz, ["svn", "rebase"], { ...op, tipo: "rede", timeoutMs: 600_000 });
  return { simulado: false, saida: r.stdout };
}

/**
 * `git svn dcommit`: ENVIA os commits locais ao servidor SVN. `simular: true` roda `--dry-run` (sem confirmação,
 * nada é gravado) e devolve o que seria enviado.
 */
export async function gitSvnDcommit(raiz: string, op: Partial<ConfirmacaoServidor> & OpcoesBase & { origem: ConfirmacaoServidor["origem"]; simular?: boolean }): Promise<ResultadoGitSvn> {
  if (op.simular === true) {
    const r = await rodarGit(raiz, ["svn", "dcommit", "--dry-run"], { ...op, tipo: "rede", timeoutMs: 600_000 });
    return { simulado: true, saida: r.stdout };
  }
  exigirConfirmacaoServidor("git svn dcommit", op as ConfirmacaoServidor);
  await exigirArvoreLimpa(raiz, op);
  const r = await rodarGit(raiz, ["svn", "dcommit"], { ...op, tipo: "rede", timeoutMs: 600_000 });
  return { simulado: false, saida: r.stdout };
}
