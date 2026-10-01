import { capabilitiesDe, type Diff, type OpcoesDiff, type OpcoesStatus, type StatusRepo, type TipoVcs, type Vcs } from "../vcs";
import { executorPadrao, type Confianca, type ExecutorVcs } from "../executor";
import type { OpcoesBase } from "./comum";
import { diffGit } from "./diff";
import { statusGit } from "./status";
import * as est from "./estagiar";
import * as cm from "./commit";
import * as rm from "./ramos";
import * as st from "./stash";
import * as wt from "./worktrees";
import * as lg from "./log";
import * as rmt from "./remotos";
import * as mg from "./merge";
import * as cf from "./conflitos";
import * as rfl from "./reflog";
import * as sub from "./submodulos";
import * as esp from "./especiais";

type Sem<F> = F extends (raiz: string, ...a: infer A) => infer R ? (...a: A) => R : never;

/** Operações de escrita/ramos/stash/worktrees do git com a raiz e o executor já ligados (aditivo à interface `Vcs`). */
export interface VcsGitOperacoes {
  estagio: {
    estagiarArquivos: Sem<typeof est.estagiarArquivos>;
    desestagiarArquivos: Sem<typeof est.desestagiarArquivos>;
    estagiarHunk: Sem<typeof est.estagiarHunk>;
    desestagiarHunk: Sem<typeof est.desestagiarHunk>;
    estagiarLinhas: Sem<typeof est.estagiarLinhas>;
    desestagiarLinhas: Sem<typeof est.desestagiarLinhas>;
    ignorar: (padroes: readonly string[]) => ReturnType<typeof est.ignorar>;
    descartar: Sem<typeof est.descartar>;
    desfazerDescarte: Sem<typeof est.desfazerDescarte>;
    listarDescartes: (pastaSeguranca: string) => ReturnType<typeof est.listarDescartes>;
  };
  commit: {
    criar: (op: Omit<cm.OpcoesCommit, "executor">) => Promise<cm.ResultadoCommit>;
    modeloMensagem: () => Promise<string | null>;
    ultimoCommitPublicado: () => ReturnType<typeof cm.ultimoCommitPublicado>;
  };
  ramos: {
    listar: Sem<typeof rm.listarRamos>;
    criar: Sem<typeof rm.criarRamo>;
    trocar: Sem<typeof rm.trocarRamo>;
    renomear: Sem<typeof rm.renomearRamo>;
    apagar: Sem<typeof rm.apagarRamo>;
    definirUpstream: Sem<typeof rm.definirUpstream>;
    removerUpstream: Sem<typeof rm.removerUpstream>;
    padrao: Sem<typeof rm.ramoPadrao>;
    listarTags: Sem<typeof rm.listarTags>;
    criarTag: Sem<typeof rm.criarTag>;
    apagarTag: Sem<typeof rm.apagarTag>;
  };
  stash: {
    listar: Sem<typeof st.listarStashes>;
    criar: Sem<typeof st.criarStash>;
    aplicar: Sem<typeof st.aplicarStash>;
    pop: Sem<typeof st.popStash>;
    apagar: Sem<typeof st.apagarStash>;
    restaurarApagado: Sem<typeof st.restaurarStashApagado>;
    diff: Sem<typeof st.diffStash>;
  };
  worktrees: {
    listar: Sem<typeof wt.listarWorktrees>;
    orfaos: Sem<typeof wt.worktreesOrfaos>;
    criar: Sem<typeof wt.criarWorktree>;
    remover: Sem<typeof wt.removerWorktree>;
    podar: Sem<typeof wt.podarWorktrees>;
    reparar: Sem<typeof wt.repararWorktrees>;
    travar: Sem<typeof wt.travarWorktree>;
    destravar: Sem<typeof wt.destravarWorktree>;
    compararComBase: Sem<typeof wt.compararComBase>;
  };
  historico: {
    log: Sem<typeof lg.logGit>;
    arquivo: Sem<typeof lg.historicoArquivo>;
    detalhe: Sem<typeof lg.detalheCommit>;
    blame: Sem<typeof lg.blameGit>;
  };
  remotos: {
    listar: Sem<typeof rmt.listarRemotos>;
    fetch: Sem<typeof rmt.fetchRemoto>;
    pull: Sem<typeof rmt.pullRemoto>;
    enviar: Sem<typeof rmt.pushRemoto>;
    /** Única via de push forçado: manual, confirmação digitada, nunca na branch padrão, sempre com simulação. */
    sobrescreverComLease: Sem<typeof rmt.forceWithLease>;
    preferenciaPull: Sem<typeof rmt.preferenciaPull>;
    /** Fetch em segundo plano (P-22): 1 por vez, baixa prioridade, só com a janela em foco. */
    segundoPlano: { tentar: (remoto?: string) => ReturnType<rmt.FetchSegundoPlano["tentar"]>; pausar: () => void; retomar: () => void; iniciarPeriodico: (ms: number) => () => void; ativo: () => boolean };
  };
  operacoes: {
    estado: Sem<typeof mg.estadoOperacao>;
    mesclar: Sem<typeof mg.mesclar>;
    cherryPick: Sem<typeof mg.cherryPick>;
    reverter: Sem<typeof mg.reverter>;
    rebase: Sem<typeof mg.rebase>;
    rebaseInterativo: Sem<typeof mg.rebaseInterativo>;
    continuar: Sem<typeof mg.continuar>;
    abortar: Sem<typeof mg.abortar>;
    pular: Sem<typeof mg.pular>;
  };
  conflitos: {
    listar: Sem<typeof cf.listarConflitos>;
    classificar: Sem<typeof cf.classificarConflito>;
    ler: Sem<typeof cf.lerConflitos>;
    resolverHunks: Sem<typeof cf.resolverHunks>;
    marcarResolvido: Sem<typeof cf.marcarResolvido>;
    resolverArquivo: Sem<typeof cf.resolverArquivo>;
  };
  reflog: {
    listar: Sem<typeof rfl.listarReflog>;
    desfazerUltimaOperacao: Sem<typeof rfl.desfazerUltimaOperacao>;
  };
  submodulos: {
    listar: Sem<typeof sub.listarSubmodulos>;
    inicializar: Sem<typeof sub.inicializarSubmodulos>;
  };
  especiais: {
    detectar: Sem<typeof esp.detectarEspeciais>;
    lerPonteiroLfs: Sem<typeof esp.lerPonteiroLfs>;
    ehArquivoLfs: Sem<typeof esp.ehArquivoLfs>;
  };
}

export type VcsGit = Vcs & { readonly git: VcsGitOperacoes; readonly confianca: Confianca };

/** `Vcs` para git (e git-svn, tratado como git). `git` traz as operações de escrita da fase 6B. */
export function criarVcsGit(raiz: string, opcoes: { tipo?: Extract<TipoVcs, "git" | "git-svn">; executor?: ExecutorVcs; confianca?: Confianca; janelaEmFoco?: () => boolean } = {}): VcsGit {
  const tipo = opcoes.tipo ?? "git";
  // Pasta que o usuário ainda não marcou como confiável: sem hooks, fsmonitor nem protocolo ext (ver `configSegura`).
  const confianca: Confianca = opcoes.confianca ?? "nao_confiavel";
  const exec = (opcoes.executor ?? executorPadrao).comConfianca(confianca);
  const ex = { executor: exec };
  const fundo = rmt.criarFetchSegundoPlano({ janelaEmFoco: opcoes.janelaEmFoco ?? (() => false), executor: exec });
  const com = <O extends OpcoesBase>(o?: O): O & OpcoesBase => ({ ...ex, ...(o ?? ({} as O)) });
  const git: VcsGitOperacoes = {
    estagio: {
      estagiarArquivos: (c, o) => est.estagiarArquivos(raiz, c, com(o)),
      desestagiarArquivos: (c, o) => est.desestagiarArquivos(raiz, c, com(o)),
      estagiarHunk: (c, h, o) => est.estagiarHunk(raiz, c, h, com(o)),
      desestagiarHunk: (c, h, o) => est.desestagiarHunk(raiz, c, h, com(o)),
      estagiarLinhas: (c, h, l, o) => est.estagiarLinhas(raiz, c, h, l, com(o)),
      desestagiarLinhas: (c, h, l, o) => est.desestagiarLinhas(raiz, c, h, l, com(o)),
      ignorar: (p) => est.ignorar(raiz, p),
      descartar: (c, o) => est.descartar(raiz, c, com(o)),
      desfazerDescarte: (id, o) => est.desfazerDescarte(raiz, id, com(o)),
      listarDescartes: (p) => est.listarDescartes(raiz, p),
    },
    commit: {
      criar: (o) => cm.criarCommit(raiz, com(o)),
      modeloMensagem: () => cm.modeloMensagem(raiz, com()),
      ultimoCommitPublicado: () => cm.ultimoCommitPublicado(raiz, com()),
    },
    ramos: {
      listar: (o) => rm.listarRamos(raiz, com(o)),
      criar: (n, o) => rm.criarRamo(raiz, n, com(o)),
      trocar: (d, o) => rm.trocarRamo(raiz, d, com(o)),
      renomear: (a, b, o) => rm.renomearRamo(raiz, a, b, com(o)),
      apagar: (n, o) => rm.apagarRamo(raiz, n, com(o)),
      definirUpstream: (r, u, o) => rm.definirUpstream(raiz, r, u, com(o)),
      removerUpstream: (r, o) => rm.removerUpstream(raiz, r, com(o)),
      padrao: (o) => rm.ramoPadrao(raiz, com(o)),
      listarTags: (o) => rm.listarTags(raiz, com(o)),
      criarTag: (n, o) => rm.criarTag(raiz, n, com(o)),
      apagarTag: (n, o) => rm.apagarTag(raiz, n, com(o)),
    },
    stash: {
      listar: (o) => st.listarStashes(raiz, com(o)),
      criar: (o) => st.criarStash(raiz, com(o)),
      aplicar: (i, o) => st.aplicarStash(raiz, i, com(o)),
      pop: (i, o) => st.popStash(raiz, i, com(o)),
      apagar: (i, o) => st.apagarStash(raiz, i, com(o)),
      restaurarApagado: (h, m, o) => st.restaurarStashApagado(raiz, h, m, com(o)),
      diff: (i, o) => st.diffStash(raiz, i, com(o)),
    },
    worktrees: {
      listar: (o) => wt.listarWorktrees(raiz, com(o)),
      orfaos: (o) => wt.worktreesOrfaos(raiz, com(o)),
      criar: (o) => wt.criarWorktree(raiz, com(o)),
      remover: (c, o) => wt.removerWorktree(raiz, c, com(o)),
      podar: (o) => wt.podarWorktrees(raiz, com(o)),
      reparar: (o) => wt.repararWorktrees(raiz, com(o)),
      travar: (c, m, o) => wt.travarWorktree(raiz, c, m, com(o)),
      destravar: (c, o) => wt.destravarWorktree(raiz, c, com(o)),
      compararComBase: (c, o) => wt.compararComBase(raiz, c, com(o)),
    },
    historico: {
      log: (o) => lg.logGit(raiz, com(o)),
      arquivo: (c, o) => lg.historicoArquivo(raiz, c, com(o)),
      detalhe: (r, o) => lg.detalheCommit(raiz, r, com(o)),
      blame: (c, o) => lg.blameGit(raiz, c, com(o)),
    },
    remotos: {
      listar: (o) => rmt.listarRemotos(raiz, com(o)),
      fetch: (o) => rmt.fetchRemoto(raiz, com(o)),
      pull: (o) => rmt.pullRemoto(raiz, com(o)),
      enviar: (o) => rmt.pushRemoto(raiz, com(o)),
      sobrescreverComLease: (o) => rmt.forceWithLease(raiz, com(o)),
      preferenciaPull: (o) => rmt.preferenciaPull(raiz, com(o)),
      segundoPlano: { tentar: (r) => fundo.tentar(raiz, r), pausar: () => fundo.pausar(), retomar: () => fundo.retomar(), iniciarPeriodico: (ms) => fundo.iniciarPeriodico(raiz, ms), ativo: () => fundo.ativo() },
    },
    operacoes: {
      estado: (o) => mg.estadoOperacao(raiz, com(o)),
      mesclar: (o) => mg.mesclar(raiz, com(o)),
      cherryPick: (o) => mg.cherryPick(raiz, com(o)),
      reverter: (o) => mg.reverter(raiz, com(o)),
      rebase: (o) => mg.rebase(raiz, com(o)),
      rebaseInterativo: (o) => mg.rebaseInterativo(raiz, com(o)),
      continuar: (o) => mg.continuar(raiz, com(o)),
      abortar: (o) => mg.abortar(raiz, com(o)),
      pular: (o) => mg.pular(raiz, com(o)),
    },
    conflitos: {
      listar: (o) => cf.listarConflitos(raiz, com(o)),
      classificar: (c, o) => cf.classificarConflito(raiz, c, com(o)),
      ler: (c, o) => cf.lerConflitos(raiz, c, com(o)),
      resolverHunks: (c, r, o) => cf.resolverHunks(raiz, c, r, com(o)),
      marcarResolvido: (c, o) => cf.marcarResolvido(raiz, c, com(o)),
      resolverArquivo: (c, e, o) => cf.resolverArquivo(raiz, c, e, com(o)),
    },
    reflog: {
      listar: (o) => rfl.listarReflog(raiz, com(o)),
      desfazerUltimaOperacao: (o) => rfl.desfazerUltimaOperacao(raiz, com(o)),
    },
    submodulos: {
      listar: (o) => sub.listarSubmodulos(raiz, com(o)),
      inicializar: (o) => sub.inicializarSubmodulos(raiz, com(o)),
    },
    especiais: {
      detectar: (o) => esp.detectarEspeciais(raiz, com(o)),
      lerPonteiroLfs: (c) => esp.lerPonteiroLfs(raiz, c),
      ehArquivoLfs: (c, o) => esp.ehArquivoLfs(raiz, c, com(o)),
    },
  };
  return {
    tipo,
    raiz,
    capabilities: capabilitiesDe(tipo),
    confianca,
    status: (op: OpcoesStatus = {}): Promise<StatusRepo> => statusGit(raiz, { ...ex, ...op }),
    diff: (op: OpcoesDiff = {}): Promise<Diff> => diffGit(raiz, { ...ex, ...op }),
    git,
  };
}
