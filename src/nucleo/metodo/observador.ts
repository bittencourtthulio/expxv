import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, watch as fsWatch, writeFileSync, type FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { watch } from "chokidar";
import { PRODUTO } from "../produto";
import { criarTailJsonl } from "./parser/jsonl";
import type { EventoRastro } from "./tipos";

export interface Agendador {
  agendar(fn: () => void, ms: number): unknown;
  cancelar(handle: unknown): void;
}

export interface WatcherLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(evento: string, cb: (...args: any[]) => void): unknown;
  removeAllListeners?(evento?: string): unknown;
  close(): Promise<void>;
}

export interface LoteMudanca {
  /** caminhos relativos à raiz, sem repetição. */
  arquivos: string[];
  /** algo em docs/** mudou (inclui JSONL não: ver `jsonl`). Releitura total. */
  documentos: boolean;
  /** .expx/hooks.json, expx-lock.json ou memoria/indice.json mudou. */
  config: boolean;
  /** JSONL de rastro tocados neste lote. */
  jsonl: string[];
  /** linhas completas novas desses JSONL (tail por offset). */
  eventos: EventoRastro[];
}

export interface OpcoesObservador {
  raiz: string;
  aoMudar: (lote: LoteMudanca) => void | Promise<void>;
  aoErro?: (erro: Error) => void;
  debounceMs?: number;
  /** tempo sem mudar de tamanho para considerar o arquivo gravado (awaitWriteFinish). */
  estabilidadeMs?: number;
  /** pausa depois do `ready`: o chokidar perde criações imediatas de pastas ainda inexistentes. */
  assentamentoMs?: number;
  agendador?: Agendador;
  criarWatcher?: (caminhos: string[], opcoes: { estabilidadeMs: number; ignorar: (caminho: string) => boolean }) => WatcherLike;
}

export interface Observador {
  /** resolve quando o watcher está pronto. */
  pronto: Promise<void>;
  /** libera watcher e timers. Idempotente. */
  fechar(): Promise<void>;
}

const relogioReal: Agendador = {
  agendar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (h) => clearTimeout(h as NodeJS.Timeout),
};

const IGNORADOS = new Set(["node_modules", ".git", "dist"]);
const CONFIG = new Set([".expx/hooks.json", ".expx/expx-lock.json", ".expx/memoria/indice.json"]);
const DIRS_CONFIG = new Set([".expx", ".expx/memoria"]);

type Classe = "jsonl" | "config" | "documentos" | null;

function classificar(rel: string): Classe {
  if (rel === "" || rel.startsWith("..")) return null;
  const partes = rel.split("/");
  if (partes.some((p) => IGNORADOS.has(p))) return null;
  if (CONFIG.has(rel)) return "config";
  if (partes[0] === "docs") {
    if (partes[1] === "eventos" && partes.length === 3 && partes[2]?.endsWith(".jsonl")) return "jsonl";
    return "documentos";
  }
  return null;
}

function interessa(rel: string): boolean {
  return classificar(rel) !== null || DIRS_CONFIG.has(rel) || rel === "docs";
}

function watcherChokidar(caminhos: string[], o: { estabilidadeMs: number; ignorar: (c: string) => boolean }): WatcherLike {
  return watch(caminhos, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: o.estabilidadeMs, pollInterval: Math.max(10, Math.floor(o.estabilidadeMs / 2)) },
    ignored: (c: string) => o.ignorar(c),
  });
}

/** `fs.watch` recursivo é inviável nesta plataforma/FS (Node antigo no Linux, FS de rede…): vale o chokidar. */
const SEM_RECURSIVO = new Set(["ERR_FEATURE_UNAVAILABLE_ON_PLATFORM", "ERR_INVALID_ARG_VALUE", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"]);

interface Pendente { rename: boolean; timer: NodeJS.Timeout; assinatura: string | null }

/**
 * AUD-06: UM `fs.watch` recursivo por pasta (FSEvents no macOS, ReadDirectoryChangesW no Windows, inotify no Linux),
 * em vez de um watcher por arquivo: fechar custa O(1) (o chokidar levava 10,6 s e travava o main com 10 000 arquivos).
 * Entrega os eventos no formato do chokidar (`all`: add|change|unlink, caminho absoluto) já estabilizados
 * (`awaitWriteFinish` equivalente: só passa adiante um caminho depois de `estabilidadeMs` sem novo evento).
 * Pasta ainda inexistente: vigia o pai (sem recursão) e abre a pasta quando ela nascer. Se o recursivo não for
 * suportado, cai SÓ ali para o chokidar, avisando por `error`.
 */
export class WatcherRecursivo extends EventEmitter implements WatcherLike {
  readonly #estabilidade: number;
  readonly #ignorar: (c: string) => boolean;
  readonly #handles = new Set<FSWatcher>();
  readonly #pendentes = new Map<string, Pendente>();
  readonly #relogios = new Set<NodeJS.Timeout>();
  #fechado = false;
  #reserva: WatcherLike | null = null;

  constructor(readonly caminhos: string[], o: { estabilidadeMs: number; ignorar: (c: string) => boolean }, readonly reserva: typeof watcherChokidar = watcherChokidar, readonly abrirFs: typeof fsWatch = fsWatch) {
    super();
    this.#estabilidade = o.estabilidadeMs;
    this.#ignorar = o.ignorar;
    try {
      for (const c of caminhos) this.#vigiar(c, false);
    } catch (e) {
      this.#cair(e);
    }
    if (this.#reserva === null) void this.#aguardarStreamVivo().then(() => { if (!this.#fechado) this.emit("ready"); });
  }

  /**
   * No macOS o stream do FSEvents só passa a valer um instante depois do `fs.watch` (centenas de ms sob carga) e o que
   * acontece nesse intervalo se perde. Sem gravar nada no projeto (somente leitura): vigia uma pasta temporária nossa,
   * grava nela até o evento voltar (a thread do FSEvents atende os streams em ordem) e só então dá o `ready`.
   * Teto de 2 s; fora do macOS não há espera.
   */
  async #aguardarStreamVivo(): Promise<void> {
    if (process.platform !== "darwin") { await new Promise<void>((r) => setImmediate(r)); return; }
    let pasta: string | null = null;
    let h: FSWatcher | null = null;
    try {
      pasta = mkdtempSync(join(tmpdir(), `${PRODUTO.id}-vivo-`));
      let vivo = false;
      h = this.abrirFs(pasta, { recursive: true, persistent: false }, () => { vivo = true; });
      h.on("error", () => { vivo = true; });
      const limite = Date.now() + 2_000;
      for (let i = 0; !vivo && Date.now() < limite && !this.#fechado; i++) {
        try { writeFileSync(join(pasta, "p"), String(i)); } catch { break; }
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    } catch { /* sem sonda: segue sem a garantia */ } finally {
      try { h?.close(); } catch { /* já fechado */ }
      if (pasta !== null) { try { rmSync(pasta, { recursive: true, force: true }); } catch { /* acessório */ } }
    }
  }

  get usandoReserva(): boolean { return this.#reserva !== null; }

  #cair(e: unknown): void {
    const codigo = (e as NodeJS.ErrnoException | undefined)?.code ?? "";
    for (const h of this.#handles) { try { h.close(); } catch { /* já fechado */ } }
    this.#handles.clear();
    for (const r of this.#relogios) clearInterval(r);
    this.#relogios.clear();
    for (const p of this.#pendentes.values()) clearTimeout(p.timer);
    this.#pendentes.clear();
    if (!SEM_RECURSIVO.has(codigo)) { setImmediate(() => this.emit("error", e instanceof Error ? e : new Error(String(e)))); }
    setImmediate(() => this.emit("error", new Error(`fs.watch recursivo indisponível (${codigo || "erro"}); usando o observador por arquivo, mais lento ao fechar.`)));
    const w = this.reserva(this.caminhos, { estabilidadeMs: this.#estabilidade, ignorar: this.#ignorar });
    w.on("all", (...a: unknown[]) => this.emit("all", ...a));
    w.on("error", (e2: Error) => this.emit("error", e2));
    w.on("ready", () => this.emit("ready"));
    this.#reserva = w;
  }

  #vigiar(pasta: string, vindaDeEspera: boolean): void {
    if (this.#fechado || this.#reserva !== null) return;
    if (!existsSync(pasta)) { this.#esperar(pasta); return; }
    const h = this.abrirFs(pasta, { recursive: true, persistent: true }, (ev, nome) => {
      if (nome === null || nome === undefined) return;
      this.#tocar(join(pasta, String(nome)), ev === "rename");
    });
    h.on("error", (e) => { if (!this.#fechado) this.emit("error", e); });
    this.#handles.add(h);
    if (vindaDeEspera) {
      // o que nasceu entre a criação da pasta e a abertura do watch não gerou evento: varre uma vez
      void readdir(pasta, { recursive: true }).then((nomes) => { for (const n of nomes) this.#tocar(join(pasta, String(n)), true); }, () => undefined);
      this.#tocar(pasta, true);
    }
  }

  /**
   * Pasta ainda não existe: vigia o pai (sem recursão; é a raiz do projeto) até ela aparecer. O stream do FSEvents leva
   * um instante para valer e perde o que acontece nesse intervalo (sob carga, centenas de ms): por isso há também uma
   * conferência barata (um `existsSync` por segundo, só enquanto a pasta não existe).
   */
  #esperar(pasta: string): void {
    const pai = dirname(pasta);
    if (!existsSync(pai)) return; // raiz sumiu: nada a vigiar
    const nome = basename(pasta);
    let resolvido = false;
    const aparecer = (): void => {
      if (resolvido || this.#fechado || !existsSync(pasta)) return;
      resolvido = true;
      clearInterval(relogio);
      this.#relogios.delete(relogio);
      try { h.close(); } catch { /* já fechado */ }
      this.#handles.delete(h);
      try { this.#vigiar(pasta, true); } catch (e) { this.#cair(e); }
    };
    const h = this.abrirFs(pai, { recursive: false, persistent: true }, (_ev, n) => { if (String(n) === nome) aparecer(); });
    h.on("error", (e) => { if (!this.#fechado) this.emit("error", e); });
    this.#handles.add(h);
    const relogio = setInterval(aparecer, 1_000);
    relogio.unref();
    this.#relogios.add(relogio);
  }

  /**
   * Estabilização (awaitWriteFinish): `estabilidadeMs` sem evento novo, depois confere tamanho+mtime duas vezes
   * seguidas iguais (o FSEvents entrega em lotes: silêncio de eventos não prova que a gravação acabou).
   */
  #tocar(abs: string, rename: boolean): void {
    if (this.#fechado || this.#ignorar(abs)) return;
    const anterior = this.#pendentes.get(abs);
    if (anterior !== undefined) clearTimeout(anterior.timer);
    const entrada: Pendente = { rename: rename || (anterior?.rename ?? false), timer: setTimeout(() => verificar(), this.#estabilidade), assinatura: null };
    entrada.timer.unref();
    this.#pendentes.set(abs, entrada);
    const poll = Math.max(10, Math.floor(this.#estabilidade / 2));
    const emitir = (existe: boolean, diretorio: boolean): void => {
      if (this.#pendentes.get(abs) !== entrada) return;
      this.#pendentes.delete(abs);
      if (this.#fechado) return;
      this.emit("all", entrada.rename ? (existe ? (diretorio ? "addDir" : "add") : "unlink") : "change", abs);
    };
    const verificar = (): void => {
      void stat(abs).then((st) => {
        if (this.#fechado || this.#pendentes.get(abs) !== entrada) return;
        const assinatura = `${st.size}:${st.mtimeMs}`;
        if (st.isDirectory() || entrada.assinatura === assinatura) { emitir(true, st.isDirectory()); return; }
        entrada.assinatura = assinatura;
        entrada.timer = setTimeout(() => verificar(), poll);
        entrada.timer.unref();
      }, () => emitir(false, false));
    };
  }

  async close(): Promise<void> {
    if (this.#fechado) return;
    this.#fechado = true;
    for (const p of this.#pendentes.values()) clearTimeout(p.timer);
    this.#pendentes.clear();
    for (const r of this.#relogios) clearInterval(r);
    this.#relogios.clear();
    for (const h of this.#handles) { try { h.close(); } catch { /* já fechado */ } }
    this.#handles.clear();
    if (this.#reserva !== null) await this.#reserva.close();
  }
}

function watcherReal(caminhos: string[], o: { estabilidadeMs: number; ignorar: (c: string) => boolean }): WatcherLike {
  return new WatcherRecursivo(caminhos, o);
}

/**
 * Observador do Método (T-04.03): `fs.watch` recursivo (AUD-06; chokidar só como reserva) sobre `docs/**` e `.expx`,
 * com estabilização de escrita (as skills regravam arquivos inteiros; YAML truncado aparece por um
 * instante) e debounce de 300 ms. Uma rajada vira UM lote. Nunca duas releituras simultâneas.
 * JSONL de rastro: tail por offset (só linhas completas novas). Somente leitura.
 */
export function criarObservador(op: OpcoesObservador): Observador {
  const debounceMs = op.debounceMs ?? 300;
  const estabilidadeMs = op.estabilidadeMs ?? 60;
  const assentamentoMs = op.assentamentoMs ?? 150;
  const ag = op.agendador ?? relogioReal;
  const tail = criarTailJsonl();

  let fechado = false;
  let timer: unknown = null;
  let rodando: Promise<void> | null = null;
  const arquivos = new Set<string>();
  const jsonl = new Set<string>();
  let documentos = false;
  let config = false;

  const relativoA = (abs: string): string => relative(op.raiz, abs).replace(/\\/g, "/");
  const ignorar = (abs: string): boolean => !interessa(relativoA(abs)) && relativoA(abs) !== "" ;

  const erro = (e: unknown): void => {
    try {
      op.aoErro?.(e instanceof Error ? e : new Error(String(e)));
    } catch {
      // o callback de erro também não derruba o observador
    }
  };

  const agendar = (): void => {
    if (timer !== null) ag.cancelar(timer);
    timer = ag.agendar(() => {
      timer = null;
      void disparar();
    }, debounceMs);
  };

  async function disparar(): Promise<void> {
    if (fechado) return;
    if (rodando) return; // quando terminar, reagenda se chegou mais coisa
    rodando = (async () => {
      const lote: LoteMudanca = { arquivos: [...arquivos].sort(), documentos, config, jsonl: [...jsonl].sort(), eventos: [] };
      arquivos.clear();
      jsonl.clear();
      documentos = false;
      config = false;
      try {
        for (const rel of lote.jsonl) lote.eventos.push(...(await tail.lerNovos(join(op.raiz, ...rel.split("/")))));
        if (fechado) return;
        await op.aoMudar(lote);
      } catch (e) {
        erro(e);
      }
    })();
    try {
      await rodando;
    } finally {
      rodando = null;
    }
    if (!fechado && (arquivos.size > 0 || jsonl.size > 0 || documentos || config)) agendar();
  }

  const aoEvento = (ev: string, abs: string): void => {
    if (fechado) return;
    const rel = relativoA(abs);
    const classe = classificar(rel);
    if (classe === null) return;
    if (classe === "jsonl") {
      if (ev === "unlink") {
        tail.esquecer(abs);
        return;
      }
      jsonl.add(rel);
    } else if (classe === "config") config = true;
    else documentos = true;
    arquivos.add(rel);
    agendar();
  };

  const watcher = (op.criarWatcher ?? watcherReal)([join(op.raiz, "docs"), join(op.raiz, ".expx")], { estabilidadeMs, ignorar });

  const aoErroWatcher = (e: Error): void => erro(e);
  watcher.on("all", aoEvento);
  watcher.on("error", aoErroWatcher);

  const pronto = new Promise<void>((resolve) => {
    let resolvido = false;
    const fim = (): void => {
      if (resolvido) return;
      resolvido = true;
      resolve();
    };
    watcher.on("ready", async () => {
      if (resolvido) return;
      // offsets dos JSONL existentes: só o que for acrescentado depois interessa
      try {
        const dir = join(op.raiz, "docs", "eventos");
        const nomes = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
        await Promise.all(nomes.map((n) => tail.lerNovos(join(dir, n))));
      } catch {
        // sem docs/eventos ainda
      }
      if (assentamentoMs > 0) await new Promise((r) => setTimeout(r, assentamentoMs));
      fim();
    });
  });

  return {
    pronto,
    async fechar() {
      if (fechado) return;
      fechado = true;
      if (timer !== null) ag.cancelar(timer);
      timer = null;
      arquivos.clear();
      jsonl.clear();
      watcher.removeAllListeners?.();
      try {
        await watcher.close();
      } catch (e) {
        erro(e);
      }
      try {
        await rodando;
      } catch {
        // já tratado em disparar
      }
    },
  };
}
