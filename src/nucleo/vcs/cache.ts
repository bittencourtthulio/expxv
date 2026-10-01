import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import { detectar, type Deteccao } from "./detectar";
import { executorPadrao, type ExecutorVcs } from "./executor";
import { criarObservadorVcs, type FuncaoWatch, type LoteVcs, type ObservadorVcs } from "./observador";
import { statusGit, statusGitParcial, statusVazio, MAX_CAMINHOS_PARCIAL, type OpcoesStatusGit } from "./git/status";
import type { StatusRepo } from "./vcs";
import type { Agendador } from "../metodo/observador";
import { GitCanceladoErro } from "../git/erros";

// T-06.04 · Estado por (workspace, worktree): cache do StatusRepo, invalidado por evento do observador
// (nunca por varredura periódica), um cálculo por vez (eventos durante o cálculo viram UM recálculo
// depois), libera tudo ao fechar. 3 worktrees do mesmo repositório = 3 estados independentes.

export interface OpcoesGerenciadorVcs {
  executor?: ExecutorVcs;
  agendador?: Agendador;
  watch?: FuncaoWatch;
  debounceMs?: number;
  limiteDegradarMs?: number;
  /** Troca o cálculo de status (teste). */
  calcularStatus?: (raiz: string, op: OpcoesStatusGit) => Promise<StatusRepo>;
  /** Troca o cálculo incremental (teste). */
  calcularParcial?: typeof statusGitParcial;
  /** Sem observador (testes que só querem o cache). */
  semObservador?: boolean;
}

export interface EstadoVcs {
  readonly chave: string;
  readonly deteccao: Deteccao;
  /** O que há em cache agora; `estado: "calculando"` até o primeiro cálculo terminar. Nunca espera. */
  atual(): StatusRepo;
  /** Resolve quando o primeiro cálculo termina. */
  pronto: Promise<StatusRepo>;
  /** Força um recálculo (coalescido com um em andamento). */
  atualizar(): Promise<StatusRepo>;
  /** Avisa a cada novo status. Devolve a função que cancela. */
  aoMudar(cb: (status: StatusRepo, lote: LoteVcs | null) => void): () => void;
  /** Último erro do cálculo (null se o último deu certo). */
  ultimoErro(): Error | null;
}

export interface GerenciadorVcs {
  /** Abre (ou reaproveita) o estado de `worktree` dentro de `workspace`. Cada `abrir` precisa de um `liberar`. */
  abrir(workspace: string, worktree: string): Promise<EstadoVcs>;
  liberar(estado: EstadoVcs): Promise<void>;
  /** Libera todos os estados de um workspace. */
  liberarWorkspace(workspace: string): Promise<void>;
  /** Quantos estados estão vivos. */
  tamanho(): number;
  fechar(): Promise<void>;
}

interface Entrada {
  workspace: string;
  estado: EstadoVcs;
  refs: number;
  encerrar(): Promise<void>;
}

export function criarGerenciadorVcs(op: OpcoesGerenciadorVcs = {}): GerenciadorVcs {
  const ex = op.executor ?? executorPadrao;
  const calcular = op.calcularStatus ?? statusGit;
  const parcial = op.calcularParcial ?? statusGitParcial;
  const entradas = new Map<string, Entrada>();
  const abrindo = new Map<string, Promise<Entrada>>();

  async function criar(workspace: string, worktree: string, chave: string): Promise<Entrada> {
    // worktree fora do workspace (ex.: irmão, criado pela Missão): a busca fica dentro dele mesmo
    const dentroDoWs = worktree === workspace || worktree.startsWith(workspace.endsWith(sep) ? workspace : workspace + sep);
    const det = await detectar(worktree, { limite: dentroDoWs ? workspace : worktree, semInfoSvn: true });
    const ehGit = (det.tipo === "git" || det.tipo === "git-svn") && det.raiz !== null;
    const raiz = det.raiz ?? worktree;
    let cache: StatusRepo = statusVazio(ehGit ? "calculando" : "pronto");
    let erro: Error | null = null;
    let fechado = false;
    let ativo: Promise<StatusRepo> | null = null;
    let repetir = false;
    let ctrl: AbortController | null = null;
    let loteDaVez: LoteVcs | null = null;
    const ouvintes = new Set<(s: StatusRepo, l: LoteVcs | null) => void>();

    const emitir = (): void => {
      for (const cb of [...ouvintes]) {
        try {
          cb(cache, loteDaVez);
        } catch {
          /* ouvinte com defeito não afeta os outros */
        }
      }
    };

    // o que o observador reportou desde o último cálculo: decide entre status parcial e completo
    let pend = { completo: true, caminhos: new Set<string>() };
    const anotar = (lote: LoteVcs | null): void => {
      if (lote === null || lote.indice || lote.operacao || lote.muitos || !lote.arvore) pend.completo = true;
      else for (const c of lote.arquivos) pend.caminhos.add(c);
    };

    const rodar = (lote: LoteVcs | null = null): Promise<StatusRepo> => {
      anotar(lote);
      if (!ehGit || fechado) return Promise.resolve(cache);
      if (ativo) {
        repetir = true; // o que está calculando pode já estar velho: recalcula uma vez ao terminar
        return ativo;
      }
      ativo = (async () => {
        try {
          do {
            repetir = false;
            ctrl = new AbortController();
            const tomado = pend;
            pend = { completo: false, caminhos: new Set() };
            try {
              const opcoes: OpcoesStatusGit = { executor: ex, signal: ctrl.signal, ...(op.limiteDegradarMs === undefined ? {} : { limiteDegradarMs: op.limiteDegradarMs }) };
              let s: StatusRepo | null = null;
              if (!tomado.completo && cache.estado === "pronto" && erro === null && tomado.caminhos.size > 0 && tomado.caminhos.size <= MAX_CAMINHOS_PARCIAL) {
                s = await parcial(raiz, cache, [...tomado.caminhos], opcoes).catch((e: unknown) => {
                  if (e instanceof GitCanceladoErro) throw e;
                  return null;
                });
              }
              s ??= await calcular(raiz, opcoes);
              if (fechado) break;
              cache = s;
              erro = null;
              emitir();
            } catch (e) {
              if (e instanceof GitCanceladoErro || fechado) break;
              erro = e instanceof Error ? e : new Error(String(e));
              if (cache.estado === "calculando") cache = { ...statusVazio("pronto") };
            }
          } while (repetir && !fechado);
        } finally {
          ativo = null;
          ctrl = null;
        }
        return cache;
      })();
      return ativo;
    };

    let observador: ObservadorVcs | null = null;
    if (!op.semObservador && det.raiz !== null) {
      observador = criarObservadorVcs({
        raiz,
        gitDir: ehGit ? det.gitDir : null,
        commonDir: ehGit ? det.commonDir : null,
        ...(op.debounceMs === undefined ? {} : { debounceMs: op.debounceMs }),
        ...(op.agendador ? { agendador: op.agendador } : {}),
        ...(op.watch ? { watch: op.watch } : {}),
        aoMudar: async (lote) => {
          loteDaVez = lote;
          try {
            await rodar(lote);
          } finally {
            loteDaVez = null;
          }
        },
      });
    }

    const pronto = rodar();
    const estado: EstadoVcs = {
      chave,
      deteccao: det,
      atual: () => cache,
      pronto,
      atualizar: () => rodar(),
      aoMudar(cb) {
        ouvintes.add(cb);
        return () => void ouvintes.delete(cb);
      },
      ultimoErro: () => erro,
    };
    return {
      workspace,
      estado,
      refs: 0,
      async encerrar() {
        fechado = true;
        ctrl?.abort();
        ouvintes.clear();
        await observador?.fechar();
        try {
          await ativo;
        } catch {
          /* cancelado */
        }
        cache = statusVazio("pronto"); // solta a memória do estado
      },
    };
  }

  async function abrir(workspace: string, worktree: string): Promise<EstadoVcs> {
    const ws = await realpath(workspace).catch(() => workspace);
    const wt = await realpath(worktree).catch(() => worktree);
    const chave = `${ws}\0${wt}`;
    const existente = entradas.get(chave);
    if (existente) {
      existente.refs++;
      return existente.estado;
    }
    let p = abrindo.get(chave);
    if (!p) {
      p = criar(ws, wt, chave).then((e) => {
        entradas.set(chave, e);
        return e;
      });
      abrindo.set(chave, p);
      void p.finally(() => abrindo.delete(chave)).catch(() => undefined);
    }
    const e = await p;
    e.refs++;
    return e.estado;
  }

  async function descartar(chave: string): Promise<void> {
    const e = entradas.get(chave);
    if (!e) return;
    entradas.delete(chave);
    await e.encerrar();
  }

  return {
    abrir,
    async liberar(estado) {
      const e = entradas.get(estado.chave);
      if (!e) return;
      if (--e.refs <= 0) await descartar(estado.chave);
    },
    async liberarWorkspace(workspace) {
      const ws = await realpath(workspace).catch(() => workspace);
      await Promise.all([...entradas].filter(([, e]) => e.workspace === ws).map(([k]) => descartar(k)));
    },
    tamanho: () => entradas.size,
    async fechar() {
      await Promise.all([...entradas.keys()].map(descartar));
    },
  };
}
