// Versionamento no main (Fase 6E): resolve o alvo SÓ por ids, abre o `Vcs` (git/svn), despacha as operações dos canais `vcs:*`,
// observa árvores (refcount, sem varredura periódica) e audita toda escrita em `evento_dominio` (sem segredo). Sem Electron:
// tudo que é do sistema (lixeira, foco da janela, pasta de segurança, emissão) é injetado. Nada de rede sem ação do usuário:
// nenhum fetch/pull/push automático: o único acesso à rede sem clique é o fetch em segundo plano, DESLIGADO por padrão (preferência
// `vcs_fetch_segundo_plano`), só enquanto uma árvore é observada, nunca push.
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { Familia, AlvoVcs, EstadoVcs, EventoVcs, FamiliasVcs, MissaoVcs, OperacoesCommit, OperacoesConflitos, OperacoesEstagio, OperacoesForge, OperacoesHistorico, OperacoesMissao, OperacoesOperacao, OperacoesRamos, OperacoesRemoto, OperacoesStash, OperacoesSvn, PedidoDiff, ResumoVcs, TipoEventoVcs } from "../compartilhado/vcs";
import type { Diff, StatusRepo } from "../nucleo/vcs/tipos";
import type { Banco } from "../nucleo/banco";
import { lerCommitsDaEntrega } from "../nucleo/vcs/missao-entrega";
import { lerPrDaEntrega } from "../nucleo/vcs/pr-estado";
import { sinaleiraDoPr } from "../nucleo/vcs/pr-sinaleira";
import type { Cofre } from "../nucleo/cofre";
import { credencialDoCofre } from "./vcs-credencial";
import { registrarEventoDominio } from "../nucleo/missoes/eventos";
import { abrirForge, semSegredos, type Forge, type OpcoesForge } from "../nucleo/forge";
import {
  abrirVcs,
  capabilitiesDe,
  criarGerenciadorVcs,
  criarObservadorVcs,
  detectar,
  semCredenciais,
  statusVazio,
  type EstadoVcs as EstadoGerenciado,
  type GerenciadorVcs,
  type ObservadorVcs,
  type Vcs,
  type VcsGitOperacoes,
  type VcsSvnOperacoes,
} from "../nucleo/vcs";

// ---- dependências -----------------------------------------------------------------------------

export interface WorkspaceMinimo {
  id: string;
  raiz: string;
}
export interface MissaoMinima {
  id: string;
  workspace_id: string;
  /** Relativo à raiz do workspace (`../repo--slug`). */
  worktree: string | null;
  branch: string | null;
  trabalho_id: string | null;
}

export interface DependenciasVcsMain {
  workspaces: { obter(id: string): WorkspaceMinimo | undefined };
  missoes: { obter(id: string): MissaoMinima | undefined | Promise<MissaoMinima | undefined> };
  banco: Pick<Banco, "executar">;
  emitir: (canal: "vcs:mudou", payload: EventoVcs) => void;
  janelaEmFoco: () => boolean;
  /** `shell.trashItem` (caminho ABSOLUTO). */
  moverParaLixeira: (caminhoAbsoluto: string) => Promise<void>;
  /** Pasta (no userData) das cópias de segurança de descartes; uma subpasta por workspace. */
  pastaSeguranca: string;
  /** Só testes: troca a abertura do `Vcs` / do forge / o gerenciador de estado. */
  abrir?: typeof abrirVcs;
  abrirForge?: typeof abrirForge;
  gerenciador?: GerenciadorVcs;
  opcoesForge?: Pick<OpcoesForge, "credencial" | "executor" | "env" | "executaveis">;
  /** Consulta o PR da Missão no forge (rede via gh/glab): OPT-IN, padrão false (D-23: nada sai da máquina sem ação do usuário). Função = relida a cada consulta (preferência). */
  consultarPr?: boolean | (() => boolean);
  /** Cofre do SO (sob demanda): credencial de Bitbucket/Azure (`FORGE_<HOST>`); nunca exibida. */
  cofre?: () => Promise<Cofre>;
  /** Preferências do app (somente leitura aqui). */
  preferencia?: (chave: string) => unknown;
  /** Período do fetch em segundo plano (padrão 5 min; mínimo 1 s). */
  intervaloFundoMs?: number;
  limitePrMs?: number;
  aviso?: (m: string) => void;
}

/** Preferência (boolean, padrão false): fetch em segundo plano das árvores observadas. NUNCA faz push/pull. */
export const PREFERENCIA_FETCH_FUNDO = "vcs_fetch_segundo_plano";
/** Preferência (boolean, padrão false): mostrar o card de PRs no Início e consultar o PR da Missão no forge. */
export const PREFERENCIA_PR_INICIO = "vcs_pr_inicio";

export interface VcsMain {
  estado(p: AlvoVcs & { ignorados: boolean }): Promise<EstadoVcs>;
  observar(p: AlvoVcs & { ativo: boolean }): Promise<ResumoVcs>;
  diff(p: PedidoDiff): Promise<Diff>;
  familia<C extends keyof FamiliasVcs>(canal: C, pedido: AlvoVcs & { op: string }): Promise<unknown>;
  missao(pedido: { mission_id: string; op: string } & Record<string, unknown>): Promise<unknown>;
  encerrar(): Promise<void>;
}

// ---- erros ------------------------------------------------------------------------------------

function kebab(nome: string): string {
  return nome.replace(/Erro$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Erro que o renderer pode ver: PT-BR, sem caminho absoluto nem credencial; `[codigo]` curto quando o erro é nominal. */
export function sanearErro(e: unknown, caminhos: readonly string[]): Error {
  if (!(e instanceof Error)) return new Error("Falha no versionamento.");
  let msg = semSegredos(semCredenciais(e.message));
  for (const c of [...caminhos].filter((x) => x.length > 3).sort((a, b) => b.length - a.length)) msg = msg.split(c).join(".");
  msg = msg.replace(new RegExp(`${homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), "~");
  msg = msg.replace(/(^|[\s'"(])\/(?:Users|home|private|var|tmp|opt)\/[^\s'")]+/g, "$1<caminho>");
  const nominal = (e as { nominal?: string }).nominal ?? (typeof (e as { codigo?: unknown }).codigo === "string" ? ((e as unknown as { codigo: string }).codigo) : null);
  const codigo = nominal ?? (e.name !== "Error" && e.name !== "GitErro" && e.name !== "SvnErro" && e.name !== "ForgeErro" ? kebab(e.name) : null);
  const saida = new Error(codigo === null ? msg : `[${codigo}] ${msg}`);
  saida.name = "VcsErro";
  return saida;
}

const ERRO = (m: string): Error => Object.assign(new Error(m), { name: "VcsErro" });

// ---- helpers ----------------------------------------------------------------------------------

const TETO_COMMITS_MISSAO = 200;

export function resumoDe(tipo: ResumoVcs["tipo"], s: StatusRepo, operacao: ResumoVcs["operacao"]): ResumoVcs {
  const c = s.contagens;
  return {
    tipo,
    branch: s.branch,
    oid: s.oid === null ? null : s.oid.slice(0, 7),
    sujo: c.staged + c.naoStaged + c.naoRastreados + c.conflitos > 0,
    ahead: s.ahead,
    behind: s.behind,
    staged: c.staged,
    nao_staged: c.naoStaged,
    nao_rastreados: c.naoRastreados,
    conflitos: c.conflitos,
    operacao,
    calculando: s.estado === "calculando",
    degradado: s.degradado,
  };
}

interface Alvo {
  workspace_id: string;
  mission_id: string | null;
  wsRaiz: string;
  /** Raiz (real) da árvore: a do workspace ou a da Missão. */
  dir: string;
  local: string;
  missao: MissaoMinima | null;
}

interface Ctx {
  alvo: Alvo;
  vcs: Vcs;
  git: VcsGitOperacoes;
  svn: VcsSvnOperacoes;
  pastaSeguranca: string;
  moverParaLixeira: (p: string) => Promise<void>;
  forge: () => Promise<Forge>;
  /** Grava `evento_dominio` (sem segredo). */
  auditar: (tipo: TipoEventoVcs, payload: Record<string, unknown>) => void;
}

type Impl<F extends Familia> = { [K in keyof F & string]: (c: Ctx, a: F[K]["entrada"]) => Promise<F[K]["saida"]> };

/** Primeira linha (120 caracteres) SEM token nem credencial em URL: o texto é digitado pelo usuário e vai para `evento_dominio`. */
const assunto = (m: string | null | undefined): string | null => (m === null || m === undefined ? null : semSegredos(semCredenciais(m.split("\n")[0]?.slice(0, 120) ?? "")));
/** Remove chaves `undefined` (exactOptionalPropertyTypes): o tipo devolvido finge o valor presente, o objeto real simplesmente não tem a chave. */
const opt = <T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
const nonNull = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
const baseName = (p: string | null): string | null => (p === null ? null : basename(p));

// ---- famílias ---------------------------------------------------------------------------------

const ESTAGIO: Impl<OperacoesEstagio> = {
  estagiar: async (c, a) => (await c.git.estagio.estagiarArquivos(a.caminhos), { ok: true }),
  desestagiar: async (c, a) => (await c.git.estagio.desestagiarArquivos(a.caminhos), { ok: true }),
  hunk: async (c, a) => {
    const e = c.git.estagio;
    if (a.linhas === null) await (a.sentido === "estagiar" ? e.estagiarHunk(a.caminho, a.hunk) : e.desestagiarHunk(a.caminho, a.hunk));
    else await (a.sentido === "estagiar" ? e.estagiarLinhas(a.caminho, a.hunk, a.linhas) : e.desestagiarLinhas(a.caminho, a.hunk, a.linhas));
    return { ok: true };
  },
  ignorar: async (c, a) => {
    const r = await c.git.estagio.ignorar(a.padroes);
    return { adicionados: r.adicionados, ja_existiam: r.jaExistiam };
  },
  descartar: async (c, a) => {
    if (!a.simular && !a.confirmar) throw ERRO("Descartar apaga mudanças: confirme na interface (confirmar: true). Use a simulação para ver o que seria perdido.");
    try {
      const r = await c.git.estagio.descartar(a.caminhos, { pastaSeguranca: c.pastaSeguranca, moverParaLixeira: c.moverParaLixeira, incluirStaged: a.incluir_staged, simular: a.simular });
      if (!a.simular) c.auditar("vcs.descartar", { ok: true, caminhos: a.caminhos.length, restaurados: r.itens.filter((i) => i.acao === "restaurar").length, lixeira: r.naLixeira.length, incluir_staged: a.incluir_staged, desfazer: r.idDesfazer });
      return r;
    } catch (e) {
      if (!a.simular) c.auditar("vcs.descartar", { ok: false, caminhos: a.caminhos.length, erro: (e as Error).name });
      throw e;
    }
  },
  desfazer_descarte: async (c, a) => {
    const r = await c.git.estagio.desfazerDescarte(a.id, { pastaSeguranca: c.pastaSeguranca });
    c.auditar("vcs.descartar", { ok: true, desfazer_de: a.id, restaurados: r.restaurados.length, conflitos: r.conflitos.length });
    return r;
  },
  descartes_listar: (c) => c.git.estagio.listarDescartes(c.pastaSeguranca),
};

const COMMIT: Impl<OperacoesCommit> = {
  criar: async (c, a) => {
    try {
      const r = await c.git.commit.criar(opt({ mensagem: nonNull(a.mensagem), origem: "usuario" as const, amend: a.amend, pularHooks: a.pular_hooks === true ? true : undefined, coautores: a.coautores.length > 0 ? a.coautores : undefined, conventional: "avisar" as const }));
      c.auditar("vcs.commit", { ok: true, hash: r.hashCurto, assunto: assunto(r.assunto), amend: r.amend, hooks_pulados: r.hooksPulados, origem: "usuario" });
      return r;
    } catch (e) {
      c.auditar("vcs.commit", { ok: false, amend: a.amend, hooks_pulados: a.pular_hooks, origem: "usuario", erro: (e as Error).name });
      throw e;
    }
  },
  modelo: async (c) => ({ modelo: await c.git.commit.modeloMensagem() }),
  ultimo_publicado: (c) => c.git.commit.ultimoCommitPublicado(),
};

async function escrever<T>(c: Ctx, tipo: TipoEventoVcs, base: Record<string, unknown>, f: () => Promise<T>, extra?: (r: T) => Record<string, unknown>): Promise<T> {
  try {
    const r = await f();
    c.auditar(tipo, { ok: true, ...base, ...(extra ? extra(r) : {}) });
    return r;
  } catch (e) {
    c.auditar(tipo, { ok: false, ...base, erro: (e as Error).name });
    throw e;
  }
}

const RAMOS: Impl<OperacoesRamos> = {
  listar: (c, a) => c.git.ramos.listar({ remotos: a.remotos }),
  criar: (c, a) => escrever(c, "vcs.ramo", { acao: "criar", ramo: a.nome, de: a.de, trocar: a.trocar }, () => c.git.ramos.criar(a.nome, opt({ de: nonNull(a.de), trocar: a.trocar }))),
  trocar: (c, a) => escrever(c, "vcs.ramo", { acao: "trocar", destino: a.destino, estrategia: a.estrategia }, () => c.git.ramos.trocar(a.destino, opt({ estrategia: nonNull(a.estrategia) })), (r) => ({ trocou: r.trocou })),
  renomear: (c, a) => escrever(c, "vcs.ramo", { acao: "renomear", de: a.de, para: a.para }, async () => (await c.git.ramos.renomear(a.de, a.para), { ok: true as const })),
  apagar: async (c, a) => {
    if (a.forcar && a.confirmacao !== a.nome) throw ERRO("Apagar à força exige digitar o nome do branch para confirmar.");
    if (a.simular) return c.git.ramos.apagar(a.nome, { simular: true, forcar: a.forcar });
    return escrever(c, "vcs.ramo", { acao: "apagar", ramo: a.nome, forcar: a.forcar }, () => c.git.ramos.apagar(a.nome, { forcar: a.forcar }), (r) => ({ apagado: r.apagado, hash_anterior: r.hashAnterior.slice(0, 12), orfaos: r.orfaos.length }));
  },
  upstream_definir: (c, a) => escrever(c, "vcs.ramo", { acao: "upstream_definir", ramo: a.ramo, upstream: a.upstream }, async () => (await c.git.ramos.definirUpstream(a.ramo, a.upstream), { ok: true as const })),
  upstream_remover: (c, a) => escrever(c, "vcs.ramo", { acao: "upstream_remover", ramo: a.ramo }, async () => (await c.git.ramos.removerUpstream(a.ramo), { ok: true as const })),
  padrao: async (c) => ({ nome: await c.git.ramos.padrao() }),
  tags_listar: (c) => c.git.ramos.listarTags(),
  tag_criar: (c, a) => escrever(c, "vcs.ramo", { acao: "tag_criar", tag: a.nome, de: a.de }, () => c.git.ramos.criarTag(a.nome, opt({ de: nonNull(a.de), mensagem: nonNull(a.mensagem) }))),
  tag_apagar: (c, a) => escrever(c, "vcs.ramo", { acao: "tag_apagar", tag: a.nome }, () => c.git.ramos.apagarTag(a.nome)),
  worktrees_listar: (c, a) => c.git.worktrees.listar({ comEstado: a.com_estado }),
};

const STASH: Impl<OperacoesStash> = {
  listar: (c) => c.git.stash.listar(),
  criar: (c, a) => escrever(c, "vcs.stash", { acao: "criar", nao_rastreados: a.nao_rastreados }, () => c.git.stash.criar(opt({ mensagem: nonNull(a.mensagem), naoRastreados: a.nao_rastreados, manterIndice: a.manter_indice })), (r) => ({ criado: r.criado })),
  aplicar: (c, a) => escrever(c, "vcs.stash", { acao: "aplicar", indice: a.indice }, () => c.git.stash.aplicar(a.indice, { restaurarIndice: a.restaurar_indice }), (r) => ({ conflito: r.conflito })),
  pop: (c, a) => escrever(c, "vcs.stash", { acao: "pop", indice: a.indice }, () => c.git.stash.pop(a.indice, { restaurarIndice: a.restaurar_indice }), (r) => ({ conflito: r.conflito })),
  apagar: (c, a) => escrever(c, "vcs.stash", { acao: "apagar", indice: a.indice }, () => c.git.stash.apagar(a.indice), (r) => ({ hash: r.hash.slice(0, 12) })),
  restaurar_apagado: (c, a) => escrever(c, "vcs.stash", { acao: "restaurar_apagado", hash: a.hash.slice(0, 12) }, async () => (await c.git.stash.restaurarApagado(a.hash, a.mensagem), { ok: true as const })),
  diff: (c, a) => c.git.stash.diff(a.indice),
};

const HISTORICO: Impl<OperacoesHistorico> = {
  log: (c, a) => c.git.historico.log(opt({ limite: nonNull(a.limite), cursor: nonNull(a.cursor), rev: nonNull(a.rev), todos: a.todos ? true : undefined, busca: nonNull(a.busca), regex: a.regex ? true : undefined, autor: nonNull(a.autor), caminho: nonNull(a.caminho) })),
  arquivo: (c, a) => c.git.historico.arquivo(a.caminho, opt({ limite: nonNull(a.limite) })),
  detalhe: (c, a) => c.git.historico.detalhe(a.rev),
  blame: (c, a) => c.git.historico.blame(a.caminho, opt({ rev: nonNull(a.rev) })),
  reflog: (c, a) => c.git.reflog.listar(opt({ ramo: nonNull(a.ramo), limite: nonNull(a.limite) })),
  desfazer_ultima: async (c, a) => {
    if (a.simular) return c.git.reflog.desfazerUltimaOperacao({ origem: "usuario", simular: true });
    return escrever(c, "vcs.operacao", { acao: "desfazer_ultima" }, () => c.git.reflog.desfazerUltimaOperacao({ origem: "usuario", simular: false }), (r) => ({ seguro: r.seguro }));
  },
};

async function ehPadrao(c: Ctx, ramo: string): Promise<boolean> {
  return (await c.git.ramos.padrao()) === ramo;
}

const REMOTO: Impl<OperacoesRemoto> = {
  listar: (c) => c.git.remotos.listar(),
  fetch: (c, a) => escrever(c, "vcs.remoto", { acao: "fetch", remoto: a.remoto, todos: a.todos, podar: a.podar }, () => c.git.remotos.atualizarRemoto(opt({ remoto: nonNull(a.remoto), todos: a.todos ? true : undefined, podar: a.podar ? true : undefined })), (r) => ({ atualizacoes: r.atualizacoes })),
  pull: async (c, a) => {
    const f = () => c.git.remotos.pull(opt({ modo: nonNull(a.modo), remoto: nonNull(a.remoto), ramo: nonNull(a.ramo), origem: "usuario" as const, simular: a.simular ? true : undefined }));
    return a.simular ? f() : escrever(c, "vcs.remoto", { acao: "pull", modo: a.modo, remoto: a.remoto, ramo: a.ramo }, f, (r) => ({ resultado: r.resultado }));
  },
  push: (c, a) => escrever(c, "vcs.remoto", { acao: "push", remoto: a.remoto, ramo: a.ramo }, () => c.git.remotos.enviar(opt({ remoto: nonNull(a.remoto), ramo: nonNull(a.ramo), origem: "usuario" as const })), (r) => ({ atualizado: r.atualizado, upstream_definido: r.upstreamDefinido })),
  lease: async (c, a) => {
    if (await ehPadrao(c, a.ramo)) throw ERRO("Sobrescrever com lease nunca é permitido no branch padrão.");
    if (!a.simular && a.confirmacao !== a.ramo) throw ERRO("Sobrescrever o remoto exige digitar o nome do branch para confirmar.");
    const f = () => c.git.remotos.sobrescreverComLease(opt({ remoto: nonNull(a.remoto), ramo: a.ramo, refEsperada: a.ref_esperada, confirmacao: nonNull(a.confirmacao), origem: "usuario" as const, simular: a.simular ? true : undefined }));
    return a.simular ? f() : escrever(c, "vcs.remoto", { acao: "lease", remoto: a.remoto, ramo: a.ramo, ref_esperada: a.ref_esperada.slice(0, 12) }, f, (r) => ({ enviado: r.enviado }));
  },
  preferencia_pull: async (c) => ({ preferencia: await c.git.remotos.preferenciaPull() }),
};

const OPERACAO: Impl<OperacoesOperacao> = {
  estado: (c) => c.git.operacoes.estado(),
  mesclar: (c, a) => {
    const f = () => c.git.operacoes.mesclar(opt({ rev: a.rev, origem: "usuario" as const, semFastForward: a.sem_ff ? true : undefined, squash: a.squash ? true : undefined, mensagem: nonNull(a.mensagem), simular: a.simular ? true : undefined }));
    return a.simular ? f() : escrever(c, "vcs.operacao", { acao: "mesclar", rev: a.rev, sem_ff: a.sem_ff, squash: a.squash }, f, (r) => ({ resultado: r.resultado, conflitos: r.conflitos.length }));
  },
  cherry_pick: (c, a) => {
    const f = () => c.git.operacoes.cherryPick(opt({ revs: a.revs, origem: "usuario" as const, mainline: nonNull(a.mainline), simular: a.simular ? true : undefined }));
    return a.simular ? f() : escrever(c, "vcs.operacao", { acao: "cherry_pick", revs: a.revs.length }, f, (r) => ({ resultado: r.resultado, conflitos: r.conflitos.length }));
  },
  reverter: (c, a) => {
    const f = () => c.git.operacoes.reverter(opt({ revs: a.revs, origem: "usuario" as const, mainline: nonNull(a.mainline), simular: a.simular ? true : undefined }));
    return a.simular ? f() : escrever(c, "vcs.operacao", { acao: "reverter", revs: a.revs.length }, f, (r) => ({ resultado: r.resultado, conflitos: r.conflitos.length }));
  },
  rebase: (c, a) => {
    const f = () => c.git.operacoes.rebase(opt({ base: a.base, origem: "usuario" as const, simular: a.simular ? true : undefined }));
    return a.simular ? f() : escrever(c, "vcs.operacao", { acao: "rebase", base: a.base }, f, (r) => ({ resultado: r.resultado, conflitos: r.conflitos.length }));
  },
  rebase_interativo: (c, a) => {
    const f = () => c.git.operacoes.rebaseInterativo(opt({ base: a.base, passos: a.passos, origem: "usuario" as const, simular: a.simular ? true : undefined, forcar: a.forcar ? true : undefined }));
    return a.simular ? f() : escrever(c, "vcs.operacao", { acao: "rebase_interativo", base: a.base, passos: a.passos.length, forcar: a.forcar }, f, (r) => ({ resultado: r.resultado, conflitos: r.conflitos.length }));
  },
  continuar: (c) => escrever(c, "vcs.operacao", { acao: "continuar" }, () => c.git.operacoes.continuar(), (r) => ({ resultado: r.resultado })),
  abortar: (c) => escrever(c, "vcs.operacao", { acao: "abortar" }, () => c.git.operacoes.abortar(), (r) => ({ resultado: r.resultado })),
  pular: (c) => escrever(c, "vcs.operacao", { acao: "pular" }, () => c.git.operacoes.pular(), (r) => ({ resultado: r.resultado })),
};

const CONFLITOS: Impl<OperacoesConflitos> = {
  listar: (c) => c.git.conflitos.listar(),
  ler: (c, a) => c.git.conflitos.ler(a.caminho),
  resolver_hunks: (c, a) => escrever(c, "vcs.conflito", { acao: "resolver_hunks", caminho: a.caminho, hunks: Object.keys(a.resolucoes).length }, () => c.git.conflitos.resolverHunks(a.caminho, Object.fromEntries(Object.entries(a.resolucoes).map(([k, v]) => [Number(k), v])), { marcar: a.marcar }), (r) => ({ restantes: r.restantes })),
  resolver_arquivo: (c, a) => escrever(c, "vcs.conflito", { acao: "resolver_arquivo", caminho: a.caminho, escolha: a.escolha }, async () => (await c.git.conflitos.resolverArquivo(a.caminho, a.escolha), { ok: true as const })),
  marcar_resolvido: (c, a) => escrever(c, "vcs.conflito", { acao: "marcar_resolvido", caminho: a.caminho }, async () => (await c.git.conflitos.marcarResolvido(a.caminho), { ok: true as const })),
};

const SVN: Impl<OperacoesSvn> = {
  info: async (c) => {
    const i = await c.svn.info();
    return { url_relativa: i.urlRelativa, url: semCredenciais(i.url), revisao: i.revisao, ultima_revisao: i.ultimaRevisao, ultimo_autor: i.ultimoAutor, raiz_repositorio: semCredenciais(i.raizRepositorio) };
  },
  status_servidor: (c) => c.svn.statusServidor(),
  atualizar: (c, a) => escrever(c, "vcs.svn", { acao: "atualizar", revisao: a.revisao, caminhos: a.caminhos?.length ?? 0 }, () => c.svn.atualizar(opt({ revisao: nonNull(a.revisao), caminhos: nonNull(a.caminhos) })), (r) => ({ revisao: r.revisao, conflitos: r.conflitos.length })),
  commit: (c, a) => escrever(c, "vcs.svn", { acao: "commit", assunto: assunto(a.mensagem), caminhos: a.caminhos?.length ?? 0, origem: "usuario" }, () => c.svn.commit(opt({ mensagem: a.mensagem, origem: "usuario" as const, caminhos: nonNull(a.caminhos), changelist: nonNull(a.changelist) })), (r) => ({ revisao: r.revisao })),
  adicionar: (c, a) => escrever(c, "vcs.svn", { acao: "adicionar", caminhos: a.caminhos.length }, async () => (await c.svn.manutencao.adicionar(a.caminhos), { ok: true as const })),
  remover: (c, a) => escrever(c, "vcs.svn", { acao: "remover", caminhos: a.caminhos.length }, async () => (await c.svn.manutencao.remover(a.caminhos, { manterLocal: a.manter_local }), { ok: true as const })),
  reverter: async (c, a) => {
    if (!a.confirmar) throw ERRO("Reverter descarta mudanças locais: confirme na interface (confirmar: true).");
    return escrever(c, "vcs.svn", { acao: "reverter", caminhos: a.caminhos.length }, async () => ({ backup: baseName((await c.svn.manutencao.reverter(a.caminhos, { pastaSeguranca: c.pastaSeguranca })).backup) }));
  },
  resolver: (c, a) => escrever(c, "vcs.svn", { acao: "resolver", caminhos: a.caminhos.length, aceitar: a.aceitar }, async () => (await c.svn.manutencao.resolver(a.caminhos, a.aceitar), { ok: true as const })),
  limpar: async (c) => (await c.svn.manutencao.limpar(), { ok: true }),
  log: (c, a) => c.svn.historico.log(opt({ limite: nonNull(a.limite), desde: nonNull(a.desde), caminho: nonNull(a.caminho) })),
  blame: (c, a) => c.svn.historico.blame(a.caminho, opt({ revisao: nonNull(a.revisao) })),
  conflitos: (c) => c.svn.conflitos(),
  ramos_listar: (c, a) => c.svn.ramos(a.tipo),
  trocar: (c, a) => escrever(c, "vcs.svn", { acao: "trocar", destino: a.destino }, () => c.svn.ramosServidor.trocar(a.destino)),
  mesclar: (c, a) => escrever(c, "vcs.svn", { acao: "mesclar", de: a.de, revisoes: a.revisoes.length, simular: a.simular }, () => c.svn.ramosServidor.mesclar({ de: a.de, revisoes: a.revisoes, simular: a.simular }), (r) => ({ conflitos: r.conflitos.length })),
  ramo_criar: (c, a) => escrever(c, "vcs.svn", { acao: "ramo_criar", tipo: a.tipo, nome: a.nome, servidor: true, confirmado_servidor: a.confirmado_servidor }, () => c.svn.ramosServidor.criar(opt({ tipo: a.tipo, nome: a.nome, mensagem: nonNull(a.mensagem), origem: "usuario" as const, confirmadoServidor: a.confirmado_servidor })), (r) => ({ revisao: r.revisao })),
  auth_verificar: (c) => c.svn.autenticacao.verificar(),
};

const semForge = (): Error => ERRO("Nenhum provedor (GitHub, GitLab, Bitbucket ou Azure) foi detectado no remoto deste repositório; o app segue só com git.");

const FORGE: Impl<OperacoesForge> = {
  estado: async (c) => {
    let f: Forge;
    try {
      f = await c.forge();
    } catch {
      return { forge: null, provedor: null };
    }
    return { forge: await f.detectar(), provedor: f.provedor };
  },
  prs_listar: async (c, a) => (await c.forge()).prs.listar(opt({ estado: a.estado, limite: nonNull(a.limite) })),
  pr_ver: async (c, a) => (await c.forge()).prs.ver(a.numero),
  pr_criar: async (c, a) =>
    escrever(c, "vcs.forge", { acao: "pr_criar", titulo: assunto(a.titulo), base: a.base, head: a.head, rascunho: a.rascunho }, async () => (await c.forge()).prs.criar(opt({ titulo: a.titulo, corpo: nonNull(a.corpo), base: nonNull(a.base), head: nonNull(a.head), rascunho: a.rascunho }), { origem: "usuario" }), (r) => ({ numero: r.numero })),
  checks_do_pr: async (c, a) => (await c.forge()).checks.doPr(a.numero),
  issues_listar: async (c, a) => (await c.forge()).issues.listar(opt({ estado: a.estado, limite: nonNull(a.limite) })),
};

const MAPAS = { "vcs:estagio": ESTAGIO, "vcs:commit": COMMIT, "vcs:ramos": RAMOS, "vcs:stash": STASH, "vcs:historico": HISTORICO, "vcs:remoto": REMOTO, "vcs:operacao": OPERACAO, "vcs:conflitos": CONFLITOS, "vcs:svn": SVN, "vcs:forge": FORGE } as const;

/** Canais cujas operações exigem git / svn (a UI consulta `capabilities`; aqui é o cinto de segurança). */
const SO_GIT = new Set<string>(["vcs:estagio", "vcs:commit", "vcs:ramos", "vcs:stash", "vcs:historico", "vcs:remoto", "vcs:operacao", "vcs:conflitos"]);

// ---- observação -------------------------------------------------------------------------------

interface Observacao {
  refs: number;
  resumo(): ResumoVcs;
  liberar(): Promise<void>;
}

// ---- fábrica ----------------------------------------------------------------------------------

export function criarVcsMain(deps: DependenciasVcsMain): VcsMain {
  const abrir = deps.abrir ?? abrirVcs;
  const gerenciador = deps.gerenciador ?? criarGerenciadorVcs();
  const vcsPorDir = new Map<string, Promise<Vcs | null>>();
  const forgesPorDir = new Map<string, Promise<Forge | null>>();
  const observacoes = new Map<string, Observacao>();
  let encerrado = false;

  async function realOu(p: string): Promise<string> {
    return realpath(p).catch(() => resolve(p));
  }

  async function resolverAlvo(a: AlvoVcs): Promise<Alvo> {
    const ws = deps.workspaces.obter(a.workspace_id);
    if (ws === undefined) throw ERRO("Workspace não encontrado.");
    const wsRaiz = await realOu(ws.raiz);
    if (a.mission_id === null) return { workspace_id: a.workspace_id, mission_id: null, wsRaiz, dir: wsRaiz, local: ".", missao: null };
    const m = await deps.missoes.obter(a.mission_id);
    if (m === undefined || m.workspace_id !== a.workspace_id) throw ERRO("Missão não encontrada neste workspace.");
    if (m.worktree === null) throw ERRO("Esta Missão não tem árvore de trabalho própria.");
    const bruto = resolve(wsRaiz, m.worktree);
    const real = await realpath(bruto).catch(() => null);
    if (real === null) throw ERRO("A pasta da Missão não existe mais no disco.");
    const dentro = real === wsRaiz || real.startsWith(wsRaiz + sep);
    const irmao = dirname(real) === dirname(wsRaiz) && basename(real).startsWith(`${basename(wsRaiz)}--`);
    if (!dentro && !irmao) throw ERRO("A pasta da Missão está fora do workspace.");
    const rel = relative(wsRaiz, real).split(sep).join("/");
    return { workspace_id: a.workspace_id, mission_id: a.mission_id, wsRaiz, dir: real, local: rel === "" ? "." : rel, missao: m };
  }

  function abrirCache(alvo: Alvo): Promise<Vcs | null> {
    let p = vcsPorDir.get(alvo.dir);
    if (p === undefined) {
      const limite = alvo.mission_id === null ? alvo.wsRaiz : alvo.dir;
      p = abrir(alvo.dir, limite, { confianca: "confiavel", janelaEmFoco: deps.janelaEmFoco });
      vcsPorDir.set(alvo.dir, p);
      void p.then((v) => v === null && vcsPorDir.delete(alvo.dir), () => vcsPorDir.delete(alvo.dir));
    }
    return p;
  }

  const caminhosSecretos = (alvo: Alvo): string[] => [alvo.dir, alvo.wsRaiz, deps.pastaSeguranca, dirname(alvo.wsRaiz)];

  async function comAlvo<T>(a: AlvoVcs, f: (alvo: Alvo) => Promise<T>): Promise<T> {
    let alvo: Alvo | null = null;
    try {
      alvo = await resolverAlvo(a);
      return await f(alvo);
    } catch (e) {
      throw sanearErro(e, alvo === null ? [deps.pastaSeguranca] : caminhosSecretos(alvo));
    }
  }

  function auditor(alvo: Alvo): Ctx["auditar"] {
    return (tipo, payload) => {
      try {
        registrarEventoDominio(deps.banco as Banco, tipo, { workspace_id: alvo.workspace_id, mission_id: alvo.mission_id, ...payload });
      } catch (e) {
        deps.aviso?.(`auditoria vcs: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
  }

  async function forgeDe(alvo: Alvo): Promise<Forge> {
    let p = forgesPorDir.get(alvo.dir);
    if (p === undefined) {
      const abrirF = deps.abrirForge ?? abrirForge;
      const credencial = deps.cofre === undefined ? undefined : credencialDoCofre(deps.cofre);
      p = abrirF({ cwd: alvo.dir, ...(credencial === undefined ? {} : { credencial }), ...(deps.opcoesForge ?? {}) });
      forgesPorDir.set(alvo.dir, p);
      void p.then((f) => f === null && forgesPorDir.delete(alvo.dir), () => forgesPorDir.delete(alvo.dir));
    }
    const f = await p;
    if (f === null) throw semForge();
    return f;
  }

  async function montarCtx(alvo: Alvo, canal: string): Promise<Ctx> {
    const vcs = await abrirCache(alvo);
    if (vcs === null) throw ERRO("Esta pasta não está sob controle de versão (git ou svn).");
    if (SO_GIT.has(canal) && vcs.git === undefined) throw ERRO("Esta operação existe só para repositórios git.");
    if (canal === "vcs:svn" && vcs.svn === undefined) throw ERRO("Esta operação existe só para cópias de trabalho SVN.");
    return {
      alvo,
      vcs,
      get git(): VcsGitOperacoes { return vcs.git as VcsGitOperacoes; },
      get svn(): VcsSvnOperacoes { return vcs.svn as VcsSvnOperacoes; },
      pastaSeguranca: join(deps.pastaSeguranca, alvo.workspace_id),
      moverParaLixeira: deps.moverParaLixeira,
      forge: () => forgeDe(alvo),
      auditar: auditor(alvo),
    } as Ctx;
  }

  async function operacaoDe(vcs: Vcs): Promise<ResumoVcs["operacao"]> {
    if (vcs.git === undefined) return null;
    try {
      return (await vcs.git.operacoes.estado()).operacao;
    } catch {
      return null;
    }
  }

  // ---- estado -----------------------------------------------------------------------------

  async function estado(p: AlvoVcs & { ignorados: boolean }): Promise<EstadoVcs> {
    return comAlvo(p, async (alvo) => {
      const vcs = await abrirCache(alvo);
      if (vcs === null) {
        const det = await detectar(alvo.dir, { limite: alvo.mission_id === null ? alvo.wsRaiz : alvo.dir, semInfoSvn: true }).catch(() => null);
        const svnSemBinario = det?.tipo === "svn" || det?.svn?.indisponivel === true;
        const status = statusVazio("pronto");
        return {
          tipo: svnSemBinario ? "svn" : "nenhum",
          local: alvo.local,
          capabilities: capabilitiesDe("nenhum"),
          status,
          resumo: resumoDe(svnSemBinario ? "svn" : "nenhum", status, null),
          operacao: null,
          ramo_padrao: null,
          ramo_protegido: false,
          svn_binario: svnSemBinario ? false : null,
          mensagem: svnSemBinario ? "Esta pasta é uma cópia de trabalho SVN, mas o `svn` não está instalado. Instale com `brew install subversion` (macOS)." : "Esta pasta não está sob controle de versão. Rode `git init` num terminal para começar.",
        };
      }
      const status = await vcs.status({ ignorados: p.ignorados });
      const operacao = vcs.git === undefined ? null : await vcs.git.operacoes.estado().catch(() => null);
      const padrao = vcs.git === undefined ? null : await vcs.git.ramos.padrao().catch(() => null);
      return {
        tipo: vcs.tipo,
        local: alvo.local,
        capabilities: vcs.capabilities,
        status,
        resumo: resumoDe(vcs.tipo, status, operacao?.operacao ?? null),
        operacao: operacao !== null && operacao.operacao !== null ? operacao : null,
        ramo_padrao: padrao,
        ramo_protegido: padrao !== null && status.branch === padrao,
        svn_binario: vcs.svn === undefined ? null : true,
        mensagem: null,
      };
    });
  }

  async function diff(p: PedidoDiff): Promise<Diff> {
    return comAlvo(p, async (alvo) => {
      const vcs = await abrirCache(alvo);
      if (vcs === null) throw ERRO("Esta pasta não está sob controle de versão.");
      return vcs.diff(opt({ caminho: nonNull(p.caminho), staged: p.staged ? true : undefined, base: nonNull(p.base), palavra: p.palavra ? true : undefined, contexto: nonNull(p.contexto), naoRastreado: p.nao_rastreado ? true : undefined, limiteBytes: nonNull(p.limite_bytes) }));
    });
  }

  // ---- observação ---------------------------------------------------------------------------

  const chaveObs = (a: AlvoVcs): string => `${a.workspace_id}\0${a.mission_id ?? ""}`;

  /**
   * Fetch em segundo plano (P-22), OPT-IN: só com a preferência ligada, só enquanto a árvore é observada (tela aberta), só com a janela em foco,
   * 1 por vez (global), baixa prioridade e abortável. É `git fetch` (atualiza refs remotas): nunca push, nunca pull, nunca toca na árvore de trabalho.
   */
  function iniciarFundo(alvo: Alvo, git: VcsGitOperacoes): () => void {
    git.remotos.segundoPlano.retomar();
    const auditar = auditor(alvo);
    const t = setInterval(() => {
      if (encerrado || deps.preferencia?.(PREFERENCIA_FETCH_FUNDO) !== true) return;
      void git.remotos.segundoPlano.tentar().then((r) => {
        if (!r.executado) return;
        if ("erro" in r) auditar("vcs.remoto", { acao: "fetch_fundo", ok: false, erro: r.erro.name });
        else auditar("vcs.remoto", { acao: "fetch_fundo", ok: true, atualizacoes: r.resultado.atualizacoes });
      }, () => undefined);
    }, Math.max(1000, deps.intervaloFundoMs ?? 300_000));
    t.unref();
    return () => {
      clearInterval(t);
      git.remotos.segundoPlano.pausar();
    };
  }

  async function criarObservacao(a: AlvoVcs, alvo: Alvo, vcs: Vcs): Promise<Observacao> {
    let ultimo = "";
    let operacao: ResumoVcs["operacao"] = null;
    const emitir = (resumo: ResumoVcs): void => {
      if (encerrado) return;
      const json = JSON.stringify(resumo);
      if (json === ultimo) return;
      ultimo = json;
      deps.emitir("vcs:mudou", { workspace_id: a.workspace_id, mission_id: a.mission_id, resumo });
    };
    if (vcs.tipo === "svn") {
      let status: StatusRepo = statusVazio("calculando");
      let ocupado = false;
      let repetir = false;
      const recalcular = async (): Promise<void> => {
        if (ocupado) { repetir = true; return; }
        ocupado = true;
        try {
          do {
            repetir = false;
            status = await vcs.status().catch(() => status);
            if (status.estado === "calculando") status = { ...status, estado: "pronto" };
            emitir(resumoDe("svn", status, null));
          } while (repetir && !encerrado);
        } finally { ocupado = false; }
      };
      const obs: ObservadorVcs = criarObservadorVcs({ raiz: alvo.dir, gitDir: null, aoMudar: () => recalcular(), aoErro: () => undefined });
      void recalcular();
      return { refs: 0, resumo: () => resumoDe("svn", status, null), liberar: () => obs.fechar() };
    }
    const est: EstadoGerenciado = await gerenciador.abrir(alvo.wsRaiz, alvo.dir);
    const desassinar = est.aoMudar((status, lote) => {
      void (async () => {
        if (lote === null || lote.operacao || ultimo === "") operacao = await operacaoDe(vcs);
        emitir(resumoDe(vcs.tipo, status, operacao));
      })();
    });
    void operacaoDe(vcs).then((o) => { operacao = o; });
    const pararFundo = vcs.git === undefined ? () => undefined : iniciarFundo(alvo, vcs.git as VcsGitOperacoes);
    return {
      refs: 0,
      resumo: () => resumoDe(vcs.tipo, est.atual(), operacao),
      async liberar() {
        pararFundo();
        desassinar();
        await gerenciador.liberar(est);
      },
    };
  }

  async function observar(p: AlvoVcs & { ativo: boolean }): Promise<ResumoVcs> {
    return comAlvo(p, async (alvo) => {
      const chave = chaveObs(p);
      const atual = observacoes.get(chave);
      if (!p.ativo) {
        if (atual === undefined) return resumoDe("nenhum", statusVazio("pronto"), null);
        const resumo = atual.resumo();
        if (--atual.refs <= 0) {
          observacoes.delete(chave);
          await atual.liberar();
        }
        return resumo;
      }
      if (encerrado) throw ERRO("O app está encerrando.");
      if (atual !== undefined) { atual.refs++; return atual.resumo(); }
      const vcs = await abrirCache(alvo);
      if (vcs === null) return resumoDe("nenhum", statusVazio("pronto"), null);
      const ja = observacoes.get(chave); // outra chamada concorrente pode ter criado enquanto abríamos
      if (ja !== undefined) { ja.refs++; return ja.resumo(); }
      const obs = await criarObservacao(p, alvo, vcs);
      obs.refs = 1;
      observacoes.set(chave, obs);
      return obs.resumo();
    });
  }

  // ---- famílias -----------------------------------------------------------------------------

  async function familia<C extends keyof FamiliasVcs>(canal: C, pedido: AlvoVcs & { op: string }): Promise<unknown> {
    const mapa = MAPAS[canal] as unknown as Record<string, (c: Ctx, a: unknown) => Promise<unknown>>;
    const impl = mapa[pedido.op];
    if (impl === undefined) throw ERRO("Operação desconhecida.");
    return comAlvo(pedido, async (alvo) => {
      const ctx = await montarCtx(alvo, canal);
      const { workspace_id: _w, mission_id: _m, op: _o, ...args } = pedido as unknown as Record<string, unknown>;
      void _w; void _m; void _o;
      return impl(ctx, args);
    });
  }

  // ---- Missão ↔ VCS -------------------------------------------------------------------------

  async function missao(pedido: { mission_id: string; op: string } & Record<string, unknown>): Promise<unknown> {
    const m = await deps.missoes.obter(pedido.mission_id);
    if (m === undefined) throw ERRO("Missão não encontrada.");
    const a: AlvoVcs = { workspace_id: m.workspace_id, mission_id: m.worktree === null ? null : m.id };
    const op = pedido.op as keyof OperacoesMissao;
    return comAlvo(a, async (alvo) => {
      const raizVcs = await abrirCache(alvo);
      if (op === "resumo") {
        const r: MissaoVcs = { mission_id: m.id, tipo: raizVcs?.tipo ?? "nenhum", branch: m.branch, worktree: m.worktree, base: null, existe: raizVcs !== null && alvo.mission_id !== null, resumo: null, pr: null, pr_sinaleira: null };
        if (raizVcs === null || alvo.mission_id === null) return r;
        r.resumo = resumoDe(raizVcs.tipo, await raizVcs.status(), await operacaoDe(raizVcs));
        if (raizVcs.git !== undefined) r.base = await raizVcs.git.ramos.padrao().catch(() => null);
        const consulta = typeof deps.consultarPr === "function" ? deps.consultarPr() : deps.consultarPr === true || deps.preferencia?.(PREFERENCIA_PR_INICIO) === true;
        if (consulta && m.branch !== null) {
          r.pr = await prDaMissao(alvo, m.branch);
          const entrega = m.trabalho_id === null ? null : await lerPrDaEntrega(alvo.wsRaiz, m.trabalho_id);
          r.pr_sinaleira = sinaleiraDoPr(r.pr === null ? null : { numero: r.pr.numero, estado: r.pr.estado, checks_falhando: r.pr.checks_falhando, checks_pendentes: r.pr.checks_pendentes }, entrega);
        }
        return r;
      }
      if (raizVcs === null) throw ERRO("A pasta da Missão não está sob controle de versão.");
      if (op === "commits") {
        if (raizVcs.git === undefined || m.trabalho_id === null) return [];
        const itens = (await lerCommitsDaEntrega(alvo.wsRaiz, m.trabalho_id)).slice(0, TETO_COMMITS_MISSAO);
        const git = raizVcs.git;
        const saida = await Promise.all(itens.map(async (it) => {
          try {
            const pg = await git.historico.log({ limite: 1, rev: it.commit });
            return { task: it.task, commit: it.commit, assunto: pg.commits[0]?.assunto ?? null, existe: pg.commits.length > 0 };
          } catch {
            return { task: it.task, commit: it.commit, assunto: null, existe: false };
          }
        }));
        return saida;
      }
      if (raizVcs.git === undefined) throw ERRO("Esta operação existe só para repositórios git.");
      const base = await raizVcs.git.ramos.padrao();
      if (base === null) throw ERRO("Não foi possível descobrir o branch base.");
      if (op === "diff_base") return raizVcs.diff(opt({ base, caminho: nonNull((pedido["caminho"] as string | null) ?? null) }));
      if (op === "comparar") {
        const wsVcs = await abrirCache({ ...alvo, mission_id: null, dir: alvo.wsRaiz, local: ".", missao: null });
        if (wsVcs?.git === undefined) throw ERRO("Não foi possível abrir o repositório principal.");
        return wsVcs.git.worktrees.compararComBase(alvo.dir, { base });
      }
      throw ERRO("Operação desconhecida.");
    });
  }

  async function prDaMissao(alvo: Alvo, branch: string): Promise<MissaoVcs["pr"]> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), deps.limitePrMs ?? 4000);
      timer.unref();
      try {
        const f = await forgeDe(alvo);
        const { itens } = await f.prs.listar({ head: branch, estado: "todos", limite: 1 }, { signal: ctrl.signal });
        const pr = itens[0];
        return pr === undefined ? null : { numero: pr.numero, url: pr.url, estado: pr.estado, checks_falhando: pr.checks?.falha ?? 0, checks_pendentes: pr.checks?.pendente ?? 0 };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }

  return {
    estado,
    observar,
    diff,
    familia,
    missao,
    async encerrar() {
      encerrado = true;
      const todas = [...observacoes.values()];
      observacoes.clear();
      await Promise.allSettled(todas.map((o) => o.liberar()));
      await gerenciador.fechar().catch(() => undefined);
      vcsPorDir.clear();
      forgesPorDir.clear();
    },
  };
}
