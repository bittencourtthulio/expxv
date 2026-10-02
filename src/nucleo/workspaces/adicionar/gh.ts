// "Meus repositórios" via `gh` (D-608). GitHub SÓ por `gh` (D-34): nunca token, nunca chamada HTTP nossa. O estado (instalado/autenticado) vem de `gh auth status`
// (só contas; linhas de token são descartadas) e a listagem só roda por clique ("Carregar meus repositórios"), com consentimento por ação.
import { GitCanceladoErro, GitErro, GitIndisponivelErro } from "../../git/erros";
import { estadoCli } from "../../forge/detectar";
import { arr, obj, parseJson, semSegredos, str } from "../../forge/comum";
import type { ExecutorVcs } from "../../vcs/executor";
import type { EstadoGhAdicionar, RepoRemoto } from "../../../compartilhado/workspaces-adicionar";
import { ErroAdicionarNucleo } from "./erros";

export const LIMITE_REPOS = 100;
export const CAMPOS_REPO = "name,nameWithOwner,description,isPrivate,pushedAt,url";

// eslint-disable-next-line no-control-regex
const limpar = (s: string, max: number): string => semSegredos(s).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max);

/** JSON do `gh repo list` → lista saneada, ordenada por último push (mais recente primeiro). */
export function parsearRepos(json: string): { repos: RepoRemoto[]; truncado: boolean } {
  const bruto = arr(parseJson(json));
  const repos: RepoRemoto[] = [];
  for (const item of bruto) {
    const o = obj(item);
    const nomeComDono = limpar(str(o.nameWithOwner), 140);
    const nome = limpar(str(o.name), 100);
    const url = str(o.url);
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(nomeComDono) || nome === "" || !/^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9._/-]+$/i.test(url)) continue;
    const pushed = str(o.pushedAt);
    repos.push({ nome, nome_com_dono: nomeComDono, descricao: limpar(str(o.description), 300), privado: o.isPrivate === true, atualizado_em: Number.isNaN(Date.parse(pushed)) ? null : new Date(pushed).toISOString(), url });
  }
  repos.sort((a, b) => Date.parse(b.atualizado_em ?? "0") - Date.parse(a.atualizado_em ?? "0"));
  return { repos: repos.slice(0, LIMITE_REPOS), truncado: bruto.length >= LIMITE_REPOS };
}

export interface OpcoesGh {
  executor: ExecutorVcs;
  /** pasta existente para o cwd (a pessoal). */
  cwd: string;
  executavel?: string;
  sinal?: AbortSignal;
}

/** `gh` instalado e autenticado em github.com? Verificação barata, sem listar nada. */
export async function estadoGh(op: OpcoesGh): Promise<EstadoGhAdicionar> {
  try {
    const s = await estadoCli("github", null, op.cwd, { executor: op.executor, ...(op.executavel === undefined ? {} : { executavel: op.executavel }), ...(op.sinal === undefined ? {} : { signal: op.sinal }) });
    const conta = s.contas.find((c) => c.host === "github.com" && c.ativa) ?? s.contas.find((c) => c.host === "github.com");
    return { instalado: s.cli.instalada, autenticado: conta !== undefined, usuario: conta?.usuario ?? null };
  } catch {
    return { instalado: false, autenticado: false, usuario: null };
  }
}

export async function listarMeusRepositorios(op: OpcoesGh): Promise<{ repos: RepoRemoto[]; truncado: boolean }> {
  try {
    const r = await op.executor.executar(["repo", "list", "--limit", String(LIMITE_REPOS), "--json", CAMPOS_REPO], {
      cwd: op.cwd,
      executavel: op.executavel ?? "gh",
      tipo: "rede",
      timeoutMs: 45_000,
      maxBytes: 4 * 1024 * 1024,
      ...(op.sinal === undefined ? {} : { signal: op.sinal }),
      env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
    });
    return parsearRepos(r.stdout);
  } catch (e) {
    if (e instanceof GitCanceladoErro) throw new ErroAdicionarNucleo("cancelado", "Busca cancelada.");
    if (e instanceof GitIndisponivelErro) throw new ErroAdicionarNucleo("gh_ausente", "A CLI do GitHub (`gh`) não foi encontrada. Instale-a (https://cli.github.com) ou cole a URL do repositório.");
    const texto = e instanceof GitErro ? e.stderr : "";
    if (/auth login|not logged|authentication|GH_TOKEN|HTTP 401/i.test(texto)) throw new ErroAdicionarNucleo("sem_acesso", "O `gh` ainda não está autenticado. Rode `gh auth login` no terminal e tente de novo.", null, "login_gh");
    if (/error connecting|Could not resolve host|dial tcp|timeout|timed out|Network is unreachable/i.test(texto) || (e instanceof GitErro && e.name === "GitTimeoutErro")) throw new ErroAdicionarNucleo("sem_internet", "Não foi possível falar com o GitHub. Verifique a conexão e tente de novo.");
    throw new ErroAdicionarNucleo("interno", "Não foi possível listar seus repositórios.");
  }
}
