import { executorPadrao, type ExecutorVcs } from "../executor";
import { capabilitiesDe, type Diff, type OpcoesDiff, type OpcoesStatus, type StatusRepo, type Vcs } from "../vcs";
import type { OpcoesBaseSvn } from "./comum";
import * as aut from "./auth";
import * as cm from "./commit";
import { diffSvn, type DiffSvn } from "./diff";
import * as hist from "./historico";
import * as inf from "./info";
import * as man from "./manutencao";
import * as msn from "./missao";
import * as rm from "./ramos";
import { statusSvn, statusSvnParcial } from "./status";

type Sem<F> = F extends (raiz: string, ...a: infer A) => infer R ? (...a: A) => R : never;

/** Operações do SVN com a raiz e o executor já ligados (aditivo à interface `Vcs`). */
export interface VcsSvnOperacoes {
  info: () => Promise<inf.InfoSvn>;
  layout: Sem<typeof inf.layoutSvn>;
  ramos: Sem<typeof inf.listarRamosSvn>;
  externals: Sem<typeof inf.externalsSvn>;
  statusParcial: (base: StatusRepo, caminhos: readonly string[]) => Promise<StatusRepo | null>;
  statusServidor: () => Promise<StatusRepo>;
  diffPropriedades: (op?: OpcoesDiff) => Promise<DiffSvn["propriedades"]>;
  manutencao: {
    adicionar: Sem<typeof man.adicionar>;
    remover: Sem<typeof man.remover>;
    mover: Sem<typeof man.mover>;
    copiar: Sem<typeof man.copiar>;
    reverter: Sem<typeof man.reverter>;
    resolver: Sem<typeof man.resolver>;
    limpar: Sem<typeof man.limpar>;
    definirChangelist: Sem<typeof man.definirChangelist>;
    removerDeChangelist: Sem<typeof man.removerDeChangelist>;
    listarPropriedades: Sem<typeof man.listarPropriedades>;
    definirPropriedade: Sem<typeof man.definirPropriedade>;
    apagarPropriedade: Sem<typeof man.apagarPropriedade>;
    definirNeedsLock: Sem<typeof man.definirNeedsLock>;
    ignorar: Sem<typeof man.ignorarSvn>;
    bloquear: Sem<typeof man.bloquear>;
    desbloquear: Sem<typeof man.desbloquear>;
  };
  commit: Sem<typeof cm.commitarSvn>;
  atualizar: Sem<typeof cm.atualizarSvn>;
  conflitos: Sem<typeof cm.listarConflitosSvn>;
  historico: {
    log: Sem<typeof hist.logSvn>;
    blame: Sem<typeof hist.blameSvn>;
  };
  ramosServidor: {
    criar: Sem<typeof rm.criarRamoSvn>;
    trocar: Sem<typeof rm.trocarSvn>;
    mesclar: Sem<typeof rm.mesclarSvn>;
    mergeinfo: Sem<typeof rm.mergeinfoSvn>;
    reintegrar: Sem<typeof rm.reintegrarSvn>;
  };
  missoes: {
    criar: (op: Parameters<typeof msn.criarMissaoSvn>[1]) => ReturnType<typeof msn.criarMissaoSvn>;
    listar: () => ReturnType<typeof msn.listarMissoesSvn>;
    remover: (slug: string, op?: Parameters<typeof msn.removerMissaoSvn>[2]) => ReturnType<typeof msn.removerMissaoSvn>;
    criarRamoNoServidor: Sem<typeof msn.criarRamoDaMissaoSvn>;
  };
  autenticacao: { verificar: (op?: { url?: string }) => ReturnType<typeof aut.verificarAutenticacaoSvn> };
}

export interface VcsSvn extends Vcs {
  readonly tipo: "svn";
  readonly svn: VcsSvnOperacoes;
}

export interface OpcoesVcsSvn {
  executor?: ExecutorVcs;
  /** Binário `svn` (testes: o `svn` falso). */
  executavel?: string;
  env?: Record<string, string>;
  permitirFile?: boolean;
  /** Para o cache de `info` invalidado após update/commit/switch. */
  janelaEmFoco?: () => boolean;
}

/** `Vcs` de uma cópia de trabalho SVN (a raiz vem de `detectar`). SVN nega stage/stash/worktree. */
export function criarVcsSvn(raiz: string, cfg: OpcoesVcsSvn = {}): VcsSvn {
  const base: OpcoesBaseSvn = {
    executor: cfg.executor ?? executorPadrao,
    ...(cfg.executavel ? { executavel: cfg.executavel } : {}),
    ...(cfg.env ? { env: cfg.env } : {}),
    ...(cfg.permitirFile ? { permitirFile: true } : {}),
  };
  let infoCache: inf.InfoSvn | undefined;
  const info = async (): Promise<inf.InfoSvn> => (infoCache ??= await inf.infoSvn(raiz, base));
  const invalida = async <T>(p: Promise<T>): Promise<T> => {
    try {
      return await p;
    } finally {
      infoCache = undefined;
    }
  };
  const com = <O extends OpcoesBaseSvn>(op?: O): OpcoesBaseSvn & O => ({ ...base, ...(op ?? ({} as O)) });
  const comInfo = async (): Promise<{ info: inf.InfoSvn }> => ({ info: await info() });
  const ops: VcsSvnOperacoes = {
    info,
    layout: (op) => inf.layoutSvn(raiz, com(op)),
    ramos: (t, op) => inf.listarRamosSvn(raiz, t, com(op)),
    externals: (op) => inf.externalsSvn(raiz, com(op)),
    statusParcial: async (b, c) => statusSvnParcial(raiz, b, c, com()),
    statusServidor: async () => statusSvn(raiz, { ...base, servidor: true, ...(await comInfo()) }),
    diffPropriedades: async (op) => (await diffSvn(raiz, { ...base, ...(op ?? {}) })).propriedades,
    manutencao: {
      adicionar: (c, op) => man.adicionar(raiz, c, com(op)),
      remover: (c, op) => man.remover(raiz, c, com(op)),
      mover: (d, p, op) => man.mover(raiz, d, p, com(op)),
      copiar: (d, p, op) => man.copiar(raiz, d, p, com(op)),
      reverter: (c, op) => man.reverter(raiz, c, com(op)),
      resolver: (c, a, op) => man.resolver(raiz, c, a, com(op)),
      limpar: (op) => man.limpar(raiz, com(op)),
      definirChangelist: (n, c, op) => man.definirChangelist(raiz, n, c, com(op)),
      removerDeChangelist: (c, op) => man.removerDeChangelist(raiz, c, com(op)),
      listarPropriedades: (c, op) => man.listarPropriedades(raiz, c, com(op)),
      definirPropriedade: (c, n, v, op) => man.definirPropriedade(raiz, c, n, v, com(op)),
      apagarPropriedade: (c, n, op) => man.apagarPropriedade(raiz, c, n, com(op)),
      definirNeedsLock: (c, a, op) => man.definirNeedsLock(raiz, c, a, com(op)),
      ignorar: (p, pad, op) => man.ignorarSvn(raiz, p, pad, com(op)),
      bloquear: (c, conf, op) => man.bloquear(raiz, c, conf, com(op)),
      desbloquear: (c, conf, op) => man.desbloquear(raiz, c, conf, com(op)),
    },
    commit: async (op) => invalida(cm.commitarSvn(raiz, { ...com(op), ...(op.origem === "automacao" ? await comInfo() : {}) })),
    atualizar: (op) => invalida(cm.atualizarSvn(raiz, com(op))),
    conflitos: (op) => cm.listarConflitosSvn(raiz, com(op)),
    historico: { log: (op) => hist.logSvn(raiz, com(op)), blame: (c, op) => hist.blameSvn(raiz, c, com(op)) },
    ramosServidor: {
      criar: async (op) => rm.criarRamoSvn(raiz, { ...com(op), info: await info() }),
      trocar: (d, op) => invalida(rm.trocarSvn(raiz, d, com(op))),
      mesclar: (op) => rm.mesclarSvn(raiz, com(op)),
      mergeinfo: (d, op) => rm.mergeinfoSvn(raiz, d, com(op)),
      reintegrar: (op) => rm.reintegrarSvn(raiz, com(op)),
    },
    missoes: {
      criar: (op) => msn.criarMissaoSvn(raiz, com(op)),
      listar: () => msn.listarMissoesSvn(raiz),
      remover: (slug, op) => msn.removerMissaoSvn(raiz, slug, com(op)),
      criarRamoNoServidor: (op) => msn.criarRamoDaMissaoSvn(raiz, com(op)),
    },
    autenticacao: { verificar: (op) => aut.verificarAutenticacaoSvn(raiz, { ...base, ...(op ?? {}) }) },
  };
  return {
    tipo: "svn",
    raiz,
    capabilities: capabilitiesDe("svn"),
    svn: ops,
    async status(op?: OpcoesStatus): Promise<StatusRepo> {
      return statusSvn(raiz, { ...base, ...(op ?? {}), ...(await comInfo()) });
    },
    async diff(op?: OpcoesDiff): Promise<Diff> {
      return diffSvn(raiz, { ...base, ...(op ?? {}) });
    },
  };
}
