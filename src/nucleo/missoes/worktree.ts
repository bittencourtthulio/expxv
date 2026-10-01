// Worktree da Missão (T-02.05, D-22): `git worktree add -b <branch> ../<repo>--<slug>` via src/nucleo/git.
// Nunca remove nada, nunca força, nunca dá push.
import { existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { OrigemMissao } from "../dominio";
import { ValorInvalidoErro } from "../dominio";
import { raizDoRepo, ramoExiste, slugLivre, slugificar, worktreeAdd } from "../git";

const OC_ID = /^OC-[A-Za-z0-9][A-Za-z0-9-]{0,40}$/;

export interface EntradaBranch {
  origem: OrigemMissao;
  slug: string;
  /** id da ocorrência (`OC-2026-0142`); só existe depois que a runx o atribui. */
  ocId?: string | undefined;
  tipoOcorrencia?: string | undefined;
}

/**
 * `feature/<slug>`, `fix/<OC-ID>-<slug>`, `chore/<OC-ID>-<slug>`. Sem OC-ID (a runx ainda não o
 * atribuiu) a ocorrência usa `fix/<slug>`. Origens sem trabalho próprio não têm branch (`null`).
 */
export function nomeDoBranch(e: EntradaBranch): string | null {
  if (e.origem === "feature") return `feature/${e.slug}`;
  if (e.origem !== "ocorrencia") return null;
  if (e.ocId !== undefined && !OC_ID.test(e.ocId)) throw new ValorInvalidoErro("oc_id", e.ocId);
  const prefixo = e.tipoOcorrencia === "chore" ? "chore" : "fix";
  return e.ocId === undefined ? `${prefixo}/${e.slug}` : `${prefixo}/${e.ocId}-${e.slug}`;
}

export interface EntradaWorktree {
  raizRepo: string;
  titulo: string;
  origem: OrigemMissao;
  ocId?: string | undefined;
  tipoOcorrencia?: string | undefined;
}

export interface WorktreeCriado {
  /** relativo à raiz do repositório (`../repo--slug`): é o que `mission.worktree` guarda. */
  worktree: string;
  branch: string;
  /** caminho absoluto (só o main usa). */
  caminho: string;
  slug: string;
}

export async function criarWorktreeDaMissao(e: EntradaWorktree): Promise<WorktreeCriado | null> {
  const base = slugificar(e.titulo);
  if (nomeDoBranch({ origem: e.origem, slug: base, ocId: e.ocId, tipoOcorrencia: e.tipoOcorrencia }) === null) return null;
  const raiz = await raizDoRepo(e.raizRepo);
  const nomeRepo = basename(raiz);
  const pai = dirname(raiz);
  // o slug é livre quando a pasta E o branch estão livres (as duas pontas avançam juntas)
  const slug = await slugLivre(base, async (s) => {
    if (existsSync(join(pai, `${nomeRepo}--${s}`))) return true;
    return ramoExiste(raiz, nomeDoBranch({ origem: e.origem, slug: s, ocId: e.ocId, tipoOcorrencia: e.tipoOcorrencia }) as string);
  });
  const branch = nomeDoBranch({ origem: e.origem, slug, ocId: e.ocId, tipoOcorrencia: e.tipoOcorrencia }) as string;
  const r = await worktreeAdd({ repo: raiz, branch, caminho: `../${nomeRepo}--${slug}` });
  return { worktree: relative(raiz, r.caminho).replaceAll("\\", "/"), branch: r.branch, caminho: r.caminho, slug };
}
