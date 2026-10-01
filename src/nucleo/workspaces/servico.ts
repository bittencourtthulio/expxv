// Serviço de workspaces (T-02.03): abrir pasta, detectar git, recentes (<= 20), workspace atual
// (persistido em `config`), permissão (D-14) e acesso externo, remover da lista (NUNCA apaga do disco),
// listar worktrees e resolver o cwd das sessões. O diálogo nativo é do main: chega injetado em
// `escolherPasta`. O renderer nunca fornece caminho de sessão: `resolverCwd` só aceita id de workspace.
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative } from "node:path";
import type { EstadoWorkspaces, WorktreeInfo } from "../../compartilhado/dominio";
import type { Repositorios } from "../banco/repos";
import { ACESSOS_EXTERNOS, ErroDominio, NaoEncontradoErro, PERMISSOES, ValorInvalidoErro, type AcessoExterno, type Permissao, type Workspace } from "../dominio";
import { ehRepo, raizDoRepo, statusResumo, worktreeList } from "../git";

export class PastaInexistenteErro extends ErroDominio {
  override name = "PastaInexistenteErro";
  constructor(readonly caminho: string) {
    super(`A pasta não existe: ${caminho}.`);
  }
}
export class PastaInvalidaErro extends ErroDominio {
  override name = "PastaInvalidaErro";
  constructor(readonly motivo: string) {
    super(`Pasta inválida: ${motivo}.`);
  }
}
export class PastaSemPermissaoErro extends ErroDominio {
  override name = "PastaSemPermissaoErro";
  constructor(readonly caminho: string) {
    super(`Sem permissão para ler a pasta: ${caminho}.`);
  }
}

export const LIMITE_RECENTES = 20;
export const CHAVE_WORKSPACE_ATUAL = "workspace_atual";

export interface DependenciasWorkspaces {
  repos: Pick<Repositorios, "workspace" | "config">;
  /** Diálogo nativo de pasta (só o main abre). `null` = cancelou. */
  escolherPasta: () => Promise<string | null>;
  /** Pasta pessoal usada quando não há workspace atual. */
  casa?: () => string;
  /** Permissão dos workspaces NOVOS (config `permissao_padrao`); só o valor exato 'automatico' vale automático. */
  permissaoPadrao?: () => Permissao | string;
}

export interface ServicoWorkspaces {
  estado(): Promise<EstadoWorkspaces>;
  /** `caminho` null abre o diálogo injetado. Devolve null se o usuário cancelou. */
  abrir(caminho: string | null): Promise<Workspace | null>;
  definirAtual(workspaceId: string): Promise<Workspace | null>;
  /** Só tira da lista do app (remoção LÓGICA: o histórico de Missões é mantido). Nunca toca o disco. */
  remover(workspaceId: string): Promise<boolean>;
  /** Ação explícita e separada: apaga de verdade o workspace e todo o histórico dele (Missões, Panes, cards, handoffs). Ainda sem UI. */
  apagarHistorico(workspaceId: string): Promise<boolean>;
  definirPermissao(workspaceId: string, permissao: Permissao): Promise<Workspace | null>;
  definirAcessoExterno(workspaceId: string, acesso: AcessoExterno): Promise<Workspace | null>;
  worktrees(workspaceId: string): Promise<WorktreeInfo[]>;
  obter(workspaceId: string): Workspace | undefined;
  exigir(workspaceId: string): Workspace;
  atual(): Workspace | null;
  /** Síncrono (o gerenciador de sessões exige): null = workspace atual; sem atual, a pasta pessoal. */
  resolverCwd(workspaceId: string | null): string;
  /** D-14: qualquer coisa diferente de `automatico` vale `seguro`. */
  permissaoDe(workspaceId: string | null): Permissao;
}

async function validarPasta(caminho: string): Promise<string> {
  if (typeof caminho !== "string" || caminho === "" || caminho.includes("\0") || !isAbsolute(caminho)) {
    throw new PastaInvalidaErro("informe um caminho absoluto");
  }
  let info;
  try {
    info = statSync(caminho);
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException).code;
    if (codigo === "EACCES" || codigo === "EPERM") throw new PastaSemPermissaoErro(caminho);
    throw new PastaInexistenteErro(caminho);
  }
  if (!info.isDirectory()) throw new PastaInvalidaErro("o caminho não é uma pasta");
  try {
    accessSync(caminho, constants.R_OK | constants.X_OK);
  } catch {
    throw new PastaSemPermissaoErro(caminho);
  }
  return realpath(caminho).catch(() => caminho);
}

export function criarServicoWorkspaces(deps: DependenciasWorkspaces): ServicoWorkspaces {
  const { workspace: repo, config } = deps.repos;
  const casa = deps.casa ?? homedir;

  const atual = (): Workspace | null => {
    const id = config.obter<string>(CHAVE_WORKSPACE_ATUAL);
    if (typeof id !== "string") return null;
    return repo.obter(id) ?? null;
  };

  return {
    async estado() {
      return { atual: atual(), recentes: repo.recentes(LIMITE_RECENTES) };
    },

    async abrir(caminho) {
      const escolhido = caminho ?? (await deps.escolherPasta());
      if (escolhido === null) return null;
      const raiz = await validarPasta(escolhido);
      const git = await ehRepo(raiz).catch(() => false);
      let ws = repo.obterPorRaiz(raiz);
      if (ws === undefined) {
        const removido = repo.obterRemovidoPorRaiz(raiz); // AUD-11: reabrir o mesmo caminho restaura workspace e histórico
        if (removido !== undefined) ws = repo.restaurar(removido.id);
      }
      if (ws === undefined) ws = repo.criar({ nome: basename(raiz) || raiz, raiz, e_git: git, permissao: deps.permissaoPadrao?.() === "automatico" ? "automatico" : "seguro" });
      else if (ws.e_git !== git) ws = repo.atualizar(ws.id, { e_git: git });
      ws = repo.marcarUso(ws.id);
      config.definir(CHAVE_WORKSPACE_ATUAL, ws.id);
      return ws;
    },

    async definirAtual(workspaceId) {
      const ws = repo.obter(workspaceId);
      if (ws === undefined) return null;
      const usado = repo.marcarUso(ws.id);
      config.definir(CHAVE_WORKSPACE_ATUAL, usado.id);
      return usado;
    },

    async remover(workspaceId) {
      if (repo.obter(workspaceId) === undefined) return false;
      repo.remover(workspaceId);
      if (config.obter<string>(CHAVE_WORKSPACE_ATUAL) === workspaceId) config.remover(CHAVE_WORKSPACE_ATUAL);
      return true;
    },

    async apagarHistorico(workspaceId) {
      const removido = repo.apagarDefinitivo(workspaceId);
      if (removido && config.obter<string>(CHAVE_WORKSPACE_ATUAL) === workspaceId) config.remover(CHAVE_WORKSPACE_ATUAL);
      return removido;
    },

    async definirPermissao(workspaceId, permissao) {
      if (!(PERMISSOES as readonly string[]).includes(permissao)) throw new ValorInvalidoErro("permissao", permissao);
      if (repo.obter(workspaceId) === undefined) return null;
      return repo.atualizar(workspaceId, { permissao });
    },

    async definirAcessoExterno(workspaceId, acesso) {
      if (!(ACESSOS_EXTERNOS as readonly string[]).includes(acesso)) throw new ValorInvalidoErro("acesso_externo", acesso);
      if (repo.obter(workspaceId) === undefined) return null;
      return repo.atualizar(workspaceId, { acesso_externo: acesso });
    },

    async worktrees(workspaceId) {
      const ws = repo.exigir(workspaceId);
      if (!ws.e_git) return [];
      const base = await raizDoRepo(ws.raiz).catch(() => null);
      if (base === null) return [];
      const lista = await worktreeList(base);
      return Promise.all(
        lista.map(async (w): Promise<WorktreeInfo> => {
          const sujo = await statusResumo(w.caminho).then((s) => s.sujo, () => null);
          return { caminho: w.principal ? "." : relative(base, w.caminho).replaceAll("\\", "/"), branch: w.branch, principal: w.principal, sujo };
        }),
      );
    },

    obter: (id) => repo.obter(id),
    exigir: (id) => repo.exigir(id),
    atual,

    resolverCwd(workspaceId) {
      if (workspaceId === null) {
        const a = atual();
        return a !== null && existsSync(a.raiz) ? a.raiz : casa();
      }
      const ws = repo.obter(workspaceId);
      if (ws === undefined) throw new NaoEncontradoErro("Workspace", workspaceId);
      if (!existsSync(ws.raiz)) throw new PastaInexistenteErro(ws.raiz);
      return ws.raiz;
    },

    permissaoDe(workspaceId) {
      const ws = workspaceId === null ? atual() : repo.obter(workspaceId);
      return ws?.permissao === "automatico" ? "automatico" : "seguro";
    },
  };
}
