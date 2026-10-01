import { spawn, type ChildProcess } from "node:child_process";
import { setPriority } from "node:os";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { GitCanceladoErro, GitErro, GitIndexLockErro, GitIndisponivelErro, GitTimeoutErro } from "../git/erros";

// Executor de processos de versionamento (T-06.02). Sem shell, sem bloquear o event loop, com:
//  - fila: até `maxLeituras` leituras simultâneas por workspace; escritas em série por repositório;
//  - AbortSignal (cancelar mata o processo E a árvore), timeout por tipo, streaming e teto de saída;
//  - ambiente limpo (nenhuma GIT_DIR/GIT_WORK_TREE herdada; sem prompt de credencial; locale fixo);
//  - `index.lock` de outro processo vira GitIndexLockErro depois de poucas tentativas curtas.

export type TipoComando = "leitura" | "escrita" | "rede";

export const TIMEOUT_POR_TIPO_MS: Record<TipoComando, number> = { leitura: 15_000, escrita: 60_000, rede: 120_000 };
export const SAIDA_MAX_PADRAO = 1024 * 1024;
const ESPERA_LOCK_MS = [40, 120, 300];

/** Confiança na pasta: `nao_confiavel` (padrão de `criarVcsGit`) neutraliza config que executa programas (hooks, fsmonitor, protocolo ext). */
export type Confianca = "confiavel" | "nao_confiavel";

export interface OpcoesExec {
  cwd: string;
  /** Padrão `confiavel` no executor cru (só `core.fsmonitor=false` é imposto); `criarVcsGit` passa `nao_confiavel` por padrão. */
  confianca?: Confianca;
  /** Rebaixa a prioridade do processo (fetch em segundo plano, P-22). */
  prioridadeBaixa?: boolean;
  /** Padrão `git`. */
  executavel?: string;
  /** Padrão `leitura`. Define fila, timeout padrão e `GIT_OPTIONAL_LOCKS`. */
  tipo?: TipoComando;
  timeoutMs?: number;
  /** Teto de bytes de stdout e de stderr. Padrão 1 MiB; o excedente é descartado e `truncado` fica true. */
  maxBytes?: number;
  signal?: AbortSignal;
  /** Códigos de saída não-zero que NÃO lançam. */
  tolerar?: readonly number[];
  /** Streaming: recebe cada pedaço de stdout (já limitado por `maxBytes`). Com isto stdout não é acumulado, salvo `acumular`. */
  aoStdout?: (pedaco: Buffer) => void;
  acumular?: boolean;
  /** Streaming de stderr (ex.: saída dos hooks do git). Continua acumulado em `ResultadoExec.stderr`. */
  aoStderr?: (pedaco: Buffer) => void;
  /** Ao passar do teto, mata o processo (em vez de só descartar). Para diffs enormes. */
  encerrarNoLimite?: boolean;
  stdin?: string | Buffer;
  /** Chave da fila (padrão: cwd). Use a raiz do repo/workspace para agrupar subpastas. */
  chaveFila?: string;
  /** Variáveis extras (aplicadas depois da limpeza). */
  env?: Record<string, string>;
}

export interface ResultadoExec {
  codigo: number;
  stdout: string;
  stderr: string;
  truncado: boolean;
  /** true se o processo foi morto por passar do teto (`encerrarNoLimite`). */
  encerradoPorLimite: boolean;
  duracaoMs: number;
}

const MANTER_GIT = new Set(["GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_SYSTEM"]);

/** Ambiente limpo: remove GIT_* (exceto ssh/askpass/config), fixa locale e proíbe prompt. */
export function ambienteGit(base: NodeJS.ProcessEnv = process.env, tipo: TipoComando = "leitura", confianca: Confianca = "confiavel"): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (k.startsWith("GIT_") && !MANTER_GIT.has(k)) continue;
    env[k] = v;
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.LC_ALL = "C.UTF-8";
  if (tipo === "leitura") {
    env.GIT_OPTIONAL_LOCKS = "0";
    env.GIT_NO_LAZY_FETCH = "1"; // clone parcial: leitura nunca busca objeto na rede
  } else delete env.GIT_OPTIONAL_LOCKS;
  if (confianca === "nao_confiavel") env.GIT_LFS_SKIP_SMUDGE = "1";
  return env;
}

/** Mata o processo e toda a árvore dele (grupo no POSIX, `taskkill /t` no Windows). */
export function matarArvore(filho: Pick<ChildProcess, "pid" | "kill">): void {
  const pid = filho.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    const k = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    k.on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      filho.kill("SIGKILL");
    } catch {
      /* já saiu */
    }
  }
}

class Limitador {
  private ativos = 0;
  private fila: Array<{ ok: () => void; sair: () => void }> = [];
  constructor(readonly limite: number) {}
  get ocioso(): boolean {
    return this.ativos === 0 && this.fila.length === 0;
  }
  private liberacao(): () => void {
    let usado = false;
    return () => {
      if (usado) return;
      usado = true;
      this.ativos--;
      const prox = this.fila.shift();
      if (prox) {
        this.ativos++;
        prox.ok();
      }
    };
  }
  adquirir(signal: AbortSignal | undefined, args: readonly string[]): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new GitCanceladoErro(args));
    if (this.ativos < this.limite) {
      this.ativos++;
      return Promise.resolve(this.liberacao());
    }
    return new Promise((resolve, reject) => {
      const item = {
        ok: () => {
          signal?.removeEventListener("abort", aoAbortar);
          resolve(this.liberacao());
        },
        sair: () => reject(new GitCanceladoErro(args)),
      };
      const aoAbortar = (): void => {
        const i = this.fila.indexOf(item);
        if (i >= 0) {
          this.fila.splice(i, 1);
          item.sair();
        }
      };
      signal?.addEventListener("abort", aoAbortar, { once: true });
      this.fila.push(item);
    });
  }
}

const DEV_NULL = process.platform === "win32" ? "NUL" : "/dev/null";

/** Config imposta por `-c` (precedência máxima, vence o `.git/config` do repositório). */
export function configSegura(tipo: TipoComando, confianca: Confianca): string[] {
  const c = ["-c", "core.quotepath=false", "-c", "core.fsmonitor=false"]; // fsmonitor é um programa arbitrário do .git/config
  if (confianca === "nao_confiavel") c.push("-c", `core.hooksPath=${DEV_NULL}`, "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=user");
  void tipo;
  return c;
}

const nomeCurto = (exe: string): string => basename(exe).replace(/\.(exe|cmd|bat)$/i, "");
const ehLock = (stderr: string): boolean => /index\.lock|Unable to create '.*\.lock': File exists/.test(stderr);

export class ExecutorVcs {
  private readonly leituras = new Map<string, Limitador>();
  private readonly escritas = new Map<string, Limitador>();
  private readonly maxLeituras: number;
  private readonly esperaLock: readonly number[];
  private readonly baseEnv: () => NodeJS.ProcessEnv;

  constructor(cfg: { maxLeituras?: number; esperaLockMs?: readonly number[]; ambienteBase?: () => NodeJS.ProcessEnv } = {}) {
    this.maxLeituras = cfg.maxLeituras ?? 4;
    this.esperaLock = cfg.esperaLockMs ?? ESPERA_LOCK_MS;
    this.baseEnv = cfg.ambienteBase ?? (() => process.env);
  }

  /** Visão deste executor (mesmas filas) que aplica `confianca` a toda chamada que não a informe. */
  comConfianca(confianca: Confianca): ExecutorVcs {
    const alvo = this;
    return Object.create(this, {
      executar: { value: (args: readonly string[], op: OpcoesExec): Promise<ResultadoExec> => alvo.executar(args, { confianca, ...op }) },
    }) as ExecutorVcs;
  }

  /** Quantas filas (por chave) estão vivas; zero quando tudo ocioso (não vaza memória). */
  filasVivas(): number {
    return this.leituras.size + this.escritas.size;
  }

  async executar(args: readonly string[], op: OpcoesExec): Promise<ResultadoExec> {
    const tipo = op.tipo ?? "leitura";
    const chave = op.chaveFila ?? op.cwd;
    const mapa = tipo === "leitura" ? this.leituras : this.escritas;
    let lim = mapa.get(chave);
    if (!lim) {
      lim = new Limitador(tipo === "leitura" ? this.maxLeituras : 1);
      mapa.set(chave, lim);
    }
    const liberar = await lim.adquirir(op.signal, args);
    try {
      return await this.comTentativas(args, op, tipo);
    } finally {
      liberar();
      if (lim.ocioso && mapa.get(chave) === lim) mapa.delete(chave);
    }
  }

  private async comTentativas(args: readonly string[], op: OpcoesExec, tipo: TipoComando): Promise<ResultadoExec> {
    try {
      if (!(await stat(op.cwd)).isDirectory()) throw new Error("não é diretório");
    } catch {
      throw new GitErro(`Diretório inexistente: ${op.cwd}`, args);
    }
    const exe = op.executavel ?? "git";
    for (let tentativa = 0; ; tentativa++) {
      const r = await this.uma(args, op, tipo, exe);
      if (r.codigo !== 0 && !r.encerradoPorLimite && ehLock(r.stderr)) {
        const espera = this.esperaLock[tentativa];
        if (espera === undefined) throw new GitIndexLockErro(args, tentativa + 1, r.stderr);
        await new Promise((res) => setTimeout(res, espera));
        if (op.signal?.aborted) throw new GitCanceladoErro(args);
        continue;
      }
      if (r.codigo === 0 || r.encerradoPorLimite || op.tolerar?.includes(r.codigo)) return r;
      const primeira = r.stderr.trim().split("\n")[0] ?? "";
      throw new GitErro(`${nomeCurto(exe)} ${args[0] ?? ""} falhou (${r.codigo}): ${primeira}`, args, r.codigo, r.stderr);
    }
  }

  private uma(args: readonly string[], op: OpcoesExec, tipo: TipoComando, exe: string): Promise<ResultadoExec> {
    const timeoutMs = op.timeoutMs ?? TIMEOUT_POR_TIPO_MS[tipo];
    const maxBytes = op.maxBytes ?? SAIDA_MAX_PADRAO;
    const ehGit = nomeCurto(exe).toLowerCase() === "git" || nomeCurto(exe).toLowerCase().startsWith("git");
    const confianca = op.confianca ?? "confiavel";
    const argv = ehGit ? [...configSegura(tipo, confianca), ...args] : [...args];
    const inicio = performance.now();
    return new Promise<ResultadoExec>((resolve, reject) => {
      let encerrado = false;
      let truncado = false;
      let porLimite = false;
      const fim = (fn: () => void): void => {
        if (encerrado) return;
        encerrado = true;
        clearTimeout(relogio);
        op.signal?.removeEventListener("abort", aoAbortar);
        fn();
      };
      let filho: ChildProcess;
      try {
        filho = spawn(exe, argv, {
          cwd: op.cwd,
          env: { ...ambienteGit(this.baseEnv(), tipo, confianca), ...op.env },
          shell: false,
          detached: process.platform !== "win32",
          stdio: [op.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (e) {
        reject(new GitIndisponivelErro(e instanceof Error ? e.message : String(e)));
        return;
      }
      if (op.prioridadeBaixa === true && filho.pid !== undefined) {
        try {
          setPriority(filho.pid, 10);
        } catch {
          /* sem permissão: segue com a prioridade normal */
        }
      }
      const matar = (): void => matarArvore(filho);
      const relogio = setTimeout(() => fim(() => (matar(), reject(new GitTimeoutErro(args, timeoutMs)))), timeoutMs);
      const aoAbortar = (): void => fim(() => (matar(), reject(new GitCanceladoErro(args))));
      if (op.signal?.aborted) {
        aoAbortar();
        return;
      }
      op.signal?.addEventListener("abort", aoAbortar, { once: true });

      const acumulaOut = op.aoStdout === undefined || op.acumular === true;
      const saidaPartes: Buffer[] = [];
      const erroPartes: Buffer[] = [];
      let totalOut = 0;
      let totalErr = 0;
      filho.stdout?.on("data", (b: Buffer) => {
        if (totalOut >= maxBytes) {
          truncado = true;
          return;
        }
        const cabe = Math.min(b.length, maxBytes - totalOut);
        const parte = cabe < b.length ? b.subarray(0, cabe) : b;
        if (cabe < b.length) {
          truncado = true;
          if (op.encerrarNoLimite === true && !porLimite) {
            porLimite = true;
            matar();
          }
        }
        totalOut += cabe;
        if (acumulaOut) saidaPartes.push(parte);
        if (op.aoStdout) {
          try {
            op.aoStdout(parte);
          } catch {
            /* consumidor com defeito não derruba o executor */
          }
        }
      });
      filho.stderr?.on("data", (b: Buffer) => {
        if (totalErr >= maxBytes) {
          truncado = true;
          return;
        }
        const cabe = Math.min(b.length, maxBytes - totalErr);
        if (cabe < b.length) truncado = true;
        const parteErr = cabe < b.length ? b.subarray(0, cabe) : b;
        erroPartes.push(parteErr);
        totalErr += cabe;
        if (op.aoStderr) {
          try {
            op.aoStderr(parteErr);
          } catch {
            /* consumidor com defeito não derruba o executor */
          }
        }
      });
      filho.on("error", (e: NodeJS.ErrnoException) => {
        fim(() => reject(new GitIndisponivelErro(e.code === "ENOENT" ? `executável ${nomeCurto(exe)} não encontrado` : e.message)));
      });
      filho.on("close", (codigo) => {
        fim(() =>
          resolve({
            codigo: codigo ?? -1,
            stdout: Buffer.concat(saidaPartes).toString("utf8"),
            stderr: Buffer.concat(erroPartes).toString("utf8"),
            truncado,
            encerradoPorLimite: porLimite,
            duracaoMs: performance.now() - inicio,
          }),
        );
      });
      if (op.stdin !== undefined && filho.stdin) {
        filho.stdin.on("error", () => undefined);
        filho.stdin.end(op.stdin);
      }
    });
  }
}

/** Instância compartilhada do app (uma fila por workspace/repositório). */
export const executorPadrao = new ExecutorVcs();
