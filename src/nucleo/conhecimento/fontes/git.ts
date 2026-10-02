// Fonte Git (T-15.16): commits incrementais por `ultimo_sha`. O acesso ao git é uma PORTA (o main usa o executor da Fase 6); aqui só
// o mapeamento e o cursor. Diff resumido (≤ 40 linhas/arquivo) e arquivos proibidos são tratados pelo chunker de commit.
import type { Repos } from "../repos";
import type { EntradaConhecimento } from "../tipos";

export interface CommitInfo {
  sha: string;
  mensagem: string;
  autor: string | null;
  em: string;
  arquivos: Array<{ caminho: string; status: string; diff?: string | undefined }>;
}

export interface PortaGit {
  head(): Promise<string | null>;
  /** commits NOVOS depois de `ultimoSha` (mais antigos primeiro), no máximo `limite`. */
  commitsDesde(ultimoSha: string | null, limite: number): Promise<CommitInfo[]>;
}

export async function* lerCommits(p: { git: PortaGit; repos: Repos; colecao_id: string; workspace_id: string; limite?: number }): AsyncGenerator<EntradaConhecimento> {
  const ant = p.repos.fonte.obter(p.colecao_id, "git", "HEAD");
  const commits = await p.git.commitsDesde(ant?.ultimo_sha ?? null, p.limite ?? 2000);
  for (const c of commits) {
    yield { tipo: "vcs.commit", workspace_id: p.workspace_id, sha: c.sha, mensagem: c.mensagem, autor: c.autor, arquivos: c.arquivos, ocorrido_em: c.em, mission_id: null };
    p.repos.fonte.gravar({ colecao_id: p.colecao_id, tipo: "git", ref: "HEAD", ultimo_sha: c.sha });
  }
}
