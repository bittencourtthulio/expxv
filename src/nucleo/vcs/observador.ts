import { watch as fsWatch } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Agendador } from "../metodo/observador";

// T-06.03 · Observador incremental do versionamento. Em vez de um watcher por arquivo (que não escala
// para 20 000 arquivos), usa `fs.watch` recursivo (FSEvents no macOS, inotify/ReadDirectoryChangesW nos
// demais: UM handle por raiz) e classifica cada evento por caminho. Rajadas viram UM lote (debounce
// de 200 ms, com teto de espera). `agendador` e `watch` são injetáveis. Somente leitura.

export interface HandleWatch {
  close(): void;
  on?(evento: "error", cb: (e: Error) => void): unknown;
}
export type FuncaoWatch = (caminho: string, opcoes: { recursive: boolean }, cb: (evento: string, nome: string | null) => void) => HandleWatch;

export interface LoteVcs {
  /** index, HEAD, refs/** ou packed-refs mudaram: status, branch e histórico podem ter mudado. */
  indice: boolean;
  /** MERGE_HEAD, rebase-merge/, rebase-apply/, CHERRY_PICK_HEAD, REVERT_HEAD, sequencer/ mexeram. */
  operacao: boolean;
  /** Algo na árvore de trabalho mudou. */
  arvore: boolean;
  /** `.svn/wc.db` mudou. */
  svn: boolean;
  /** Até `LIMITE_ARQUIVOS` caminhos relativos à raiz (árvore), sem repetição. */
  arquivos: string[];
  /** Houve mais caminhos do que o lote guarda: tratar como "recarregar tudo". */
  muitos: boolean;
  /** Quantos eventos brutos o lote absorveu. */
  toques: number;
}

export interface OpcoesObservadorVcs {
  raiz: string;
  /** Metadados do git desta árvore (`.git` ou `<comum>/worktrees/<n>`). Sem ele, só árvore (e `.svn`). */
  gitDir?: string | null;
  /** Diretório comum (refs). Padrão: gitDir. */
  commonDir?: string | null;
  aoMudar: (lote: LoteVcs) => void | Promise<void>;
  aoErro?: (erro: Error) => void;
  debounceMs?: number;
  /** Teto: com atividade contínua, dispara no máximo depois disto. Padrão 1000 ms. */
  maxEsperaMs?: number;
  agendador?: Agendador;
  watch?: FuncaoWatch;
  /** Relógio monotônico em ms (teste). */
  agora?: () => number;
}

export interface ObservadorVcs {
  pronto: Promise<void>;
  /** Handles de watch ainda abertos (0 depois de fechar). */
  handlesAbertos(): number;
  /** Libera todos os handles e timers. Idempotente. */
  fechar(): Promise<void>;
}

export const LIMITE_ARQUIVOS = 1000;
const IGNORADOS = new Set([".git", "node_modules", "dist", ".svn"]);
const OPERACAO = new Set(["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply", "sequencer", "BISECT_LOG"]);
const INDICE = new Set(["index", "HEAD", "packed-refs", "refs", "ORIG_HEAD", "FETCH_HEAD"]);

const relogioReal: Agendador = {
  agendar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (h) => clearTimeout(h as NodeJS.Timeout),
};

function watchReal(caminho: string, opcoes: { recursive: boolean }, cb: (evento: string, nome: string | null) => void): HandleWatch {
  const w = fsWatch(caminho, { recursive: opcoes.recursive, persistent: false }, (ev, nome) => cb(ev, nome === null || nome === undefined ? null : String(nome)));
  return w;
}

type Classe = { tipo: "indice" | "operacao" | "svn" } | { tipo: "arvore"; rel: string } | null;

/** Caminho relativo (com `/`) de `abs` dentro de `base`; "" se igual; null se fora. */
function dentro(base: string, abs: string): string | null {
  const r = relative(base, abs);
  if (r === "") return "";
  if (r.startsWith("..") || isAbsolute(r)) return null;
  return r.split(sep).join("/");
}

/** Classifica um caminho absoluto. null = irrelevante. */
function classificar(abs: string, raiz: string, gitDir: string | null, commonDir: string | null): Classe {
  const bases: Array<[string, boolean]> = [];
  if (gitDir !== null) bases.push([gitDir, true]);
  if (commonDir !== null && commonDir !== gitDir) bases.push([commonDir, false]);
  for (const [base, proprio] of bases) {
    const r = dentro(base, abs);
    if (r === null) continue;
    const primeiro = r.split("/")[0] as string;
    if (r === "") return { tipo: "indice" };
    if (primeiro.endsWith(".lock")) return null;
    // no diretório comum de um worktree vinculado só interessam refs (index/HEAD ali são do worktree principal)
    if (!proprio) return primeiro === "refs" || primeiro === "packed-refs" ? { tipo: "indice" } : null;
    if (OPERACAO.has(primeiro)) return { tipo: "operacao" };
    if (INDICE.has(primeiro)) return { tipo: "indice" };
    return null; // objects/, logs/, hooks/… não interessam
  }
  const rel = dentro(raiz, abs);
  if (rel === null) return null;
  const partes = rel.split("/");
  if (partes[0] === ".svn") return partes[1] === "wc.db" ? { tipo: "svn" } : null;
  if (partes[0] === ".git") return null; // metadados já tratados acima
  if (partes.some((p) => IGNORADOS.has(p))) return null;
  return { tipo: "arvore", rel };
}

export function criarObservadorVcs(op: OpcoesObservadorVcs): ObservadorVcs {
  const debounceMs = op.debounceMs ?? 200;
  const maxEspera = op.maxEsperaMs ?? 1000;
  const ag = op.agendador ?? relogioReal;
  const agora = op.agora ?? (() => performance.now());
  const watch = op.watch ?? watchReal;
  const gitDir = op.gitDir ?? null;
  const commonDir = op.commonDir ?? gitDir;

  let fechado = false;
  let timer: unknown = null;
  let primeiroToque = 0;
  let rodando: Promise<void> | null = null;
  const handles: HandleWatch[] = [];
  let lote = novoLote();
  const arquivos = new Set<string>();

  function novoLote(): LoteVcs {
    return { indice: false, operacao: false, arvore: false, svn: false, arquivos: [], muitos: false, toques: 0 };
  }
  const erro = (e: unknown): void => {
    try {
      op.aoErro?.(e instanceof Error ? e : new Error(String(e)));
    } catch {
      /* o callback de erro também não derruba o observador */
    }
  };

  const pendente = (): boolean => lote.toques > 0;

  const agendar = (): void => {
    const t = agora();
    if (timer === null) primeiroToque = t;
    else ag.cancelar(timer);
    const espera = Math.max(0, Math.min(debounceMs, maxEspera - (t - primeiroToque)));
    timer = ag.agendar(() => {
      timer = null;
      void disparar();
    }, espera);
  };

  async function disparar(): Promise<void> {
    if (fechado || rodando || !pendente()) return;
    const l = lote;
    l.arquivos = [...arquivos];
    lote = novoLote();
    arquivos.clear();
    rodando = (async () => {
      try {
        await op.aoMudar(l);
      } catch (e) {
        erro(e);
      }
    })();
    try {
      await rodando;
    } finally {
      rodando = null;
    }
    if (!fechado && pendente()) agendar();
  }

  const registrar = (c: Classe): void => {
    if (c === null) return;
    lote.toques++;
    if (c.tipo === "arvore") {
      lote.arvore = true;
      if (arquivos.size < LIMITE_ARQUIVOS) arquivos.add(c.rel);
      else lote.muitos = true;
    } else lote[c.tipo] = true;
    agendar();
  };

  const aoEvento = (base: string) => (_ev: string, nome: string | null): void => {
    if (fechado) return;
    if (nome === null) {
      // sem nome: não dá para classificar; recarrega tudo
      lote.toques++;
      lote.arvore = true;
      lote.indice = true;
      lote.muitos = true;
      agendar();
      return;
    }
    registrar(classificar(join(base, nome), op.raiz, gitDir, commonDir));
  };

  const abrir = (caminho: string, recursive: boolean): void => {
    try {
      const h = watch(caminho, { recursive }, aoEvento(caminho));
      h.on?.("error", erro);
      handles.push(h);
    } catch (e) {
      erro(e); // pasta sumiu etc.: segue com o que conseguiu abrir
    }
  };

  abrir(op.raiz, true);
  if (gitDir !== null && dentro(op.raiz, gitDir) === null) {
    // worktree vinculado: os metadados moram fora da raiz
    abrir(gitDir, false);
    if (commonDir !== null && commonDir !== gitDir) {
      abrir(commonDir, false); // packed-refs
      abrir(join(commonDir, "refs"), true);
    }
  }

  return {
    pronto: Promise.resolve(),
    handlesAbertos: () => handles.length,
    async fechar() {
      if (fechado) return;
      fechado = true;
      if (timer !== null) ag.cancelar(timer);
      timer = null;
      lote = novoLote();
      arquivos.clear();
      for (const h of handles.splice(0)) {
        try {
          h.close();
        } catch (e) {
          erro(e);
        }
      }
      try {
        await rodando;
      } catch {
        /* já tratado */
      }
    },
  };
}
