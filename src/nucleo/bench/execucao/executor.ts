// Executor de UMA execução (T-12.10): `spawn` SEM shell, grupo de processos próprio (`detached`), timeout por execução, kill da ÁRVORE (`taskkill /t` no Windows), teto de saída (20 MB, marca de
// truncamento), stdout/stderr DIRETO para arquivo de log (nada em memória além do que o chamador lê depois), registro de pid para detectar órfãos no próximo boot (só mata se início E comando
// conferem: nunca processo alheio). O prompt entra por stdin.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

export const TIMEOUT_PADRAO_MS = 1_800_000;
export const TETO_SAIDA_BYTES = 20 * 1024 * 1024;

export interface PedidoExecucao {
  executavel: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  stdin: string | null;
  /** caminho ABSOLUTO do arquivo de log (stdout+stderr). */
  logAbs: string;
  timeoutMs?: number;
  tetoSaidaBytes?: number;
  /** rótulo estável para o registro de órfãos (ex.: `brun_x/tarefa/alvo`). */
  rotulo?: string;
}
export type EstadoExecutor = "concluido" | "falhou" | "tempo_esgotado" | "cancelado";
export interface ResultadoExecutor { estado: EstadoExecutor; codigo: number | null; sinal: string | null; duracao_s: number; truncado: boolean; pid: number | null; erro: string | null }

export interface InfoPid { pid: number; inicio: string; comando: string; rotulo: string; registrado_em: string }
export interface RegistroPids {
  registrar(info: Omit<InfoPid, "registrado_em">): void;
  remover(pid: number): void;
  listar(): InfoPid[];
}

/** Registro em disco (`<userData>/bench/pids/<pid>.json`): sobrevive a um crash do app. */
export function criarRegistroPidsArquivo(pasta: string): RegistroPids {
  const arq = (pid: number): string => join(pasta, `${pid}.json`);
  return {
    registrar(info) {
      mkdirSync(pasta, { recursive: true, mode: 0o700 });
      writeFileSync(arq(info.pid), JSON.stringify({ ...info, registrado_em: new Date().toISOString() }), { mode: 0o600 });
    },
    remover(pid) { try { rmSync(arq(pid), { force: true }); } catch { /* já removido */ } },
    listar() {
      if (!existsSync(pasta)) return [];
      const saida: InfoPid[] = [];
      for (const n of readdirSync(pasta)) {
        if (!/^\d+\.json$/.test(n)) continue;
        try {
          const o = JSON.parse(readFileSync(join(pasta, n), "utf8")) as InfoPid;
          if (typeof o.pid === "number" && typeof o.inicio === "string" && typeof o.comando === "string") saida.push(o);
        } catch { /* arquivo corrompido: ignora */ }
      }
      return saida;
    },
  };
}
export function criarRegistroPidsMemoria(): RegistroPids {
  const m = new Map<number, InfoPid>();
  return { registrar: (i) => void m.set(i.pid, { ...i, registrado_em: new Date().toISOString() }), remover: (p) => void m.delete(p), listar: () => [...m.values()] };
}

/** Início (`lstart`) e comando do processo vivo, ou `null` se não existe. POSIX via `ps`; no Windows não há consulta (retorna `null` → nada é morto). */
export function consultarProcesso(pid: number): { inicio: string; comando: string } | null {
  if (process.platform === "win32" || !Number.isInteger(pid) || pid <= 1) return null;
  try {
    const r = spawnSync("ps", ["-o", "lstart=", "-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 });
    if (r.status !== 0 || r.stdout.trim() === "") return null;
    const linha = r.stdout.replace(/\n$/, "");
    // lstart tem formato fixo de 24 caracteres: "Mon Oct  1 04:55:04 2026"
    return { inicio: linha.slice(0, 24).trim(), comando: linha.slice(24).trim() };
  } catch { return null; }
}

export function matarArvore(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", timeout: 5000 });
    else process.kill(-pid, "SIGKILL");
  } catch { /* grupo já morto */ }
}

/**
 * Boot: processos de um app que morreu. Só mata se `inicio` e o começo do `comando` conferem com o registro (pid reaproveitado por OUTRO processo nunca é morto). Sempre limpa o registro.
 * Devolve os pids mortos.
 */
export function limparOrfaos(registro: RegistroPids, consultar: (pid: number) => { inicio: string; comando: string } | null = consultarProcesso, matar: (pid: number) => void = matarArvore): number[] {
  const mortos: number[] = [];
  for (const info of registro.listar()) {
    const vivo = consultar(info.pid);
    if (vivo !== null && vivo.inicio === info.inicio && vivo.comando.startsWith(info.comando.slice(0, 60))) {
      matar(info.pid);
      mortos.push(info.pid);
    }
    registro.remover(info.pid);
  }
  return mortos;
}

export interface ExecutorProcessos {
  executar(p: PedidoExecucao, sinal?: AbortSignal): Promise<ResultadoExecutor>;
  /** mata a árvore de todas as execuções em andamento. */
  cancelarTodos(): Promise<void>;
  vivos(): number;
}

export interface DepsExecutor { registro?: RegistroPids }

export function criarExecutor(deps: DepsExecutor = {}): ExecutorProcessos {
  const registro = deps.registro ?? criarRegistroPidsMemoria();
  const ativos = new Map<number, { cancelar: () => void; fim: Promise<void> }>();
  return {
    vivos: () => ativos.size,
    async cancelarTodos() {
      const todos = [...ativos.values()];
      todos.forEach((a) => a.cancelar());
      await Promise.all(todos.map((a) => a.fim));
    },
    executar(p, sinal) {
      const inicio = performance.now();
      mkdirSync(dirname(p.logAbs), { recursive: true, mode: 0o700 });
      const fd = openSync(p.logAbs, "w", 0o600);
      const teto = p.tetoSaidaBytes ?? TETO_SAIDA_BYTES;
      return new Promise<ResultadoExecutor>((resolve) => {
        let resolvido = false;
        let motivo: "timeout" | "cancelado" | "teto" | null = null;
        let truncado = false;
        let filho: ReturnType<typeof spawn>;
        try {
          filho = spawn(p.executavel, [...p.args], { cwd: p.cwd, env: { ...p.env }, stdio: ["pipe", fd, fd], shell: false, detached: process.platform !== "win32", windowsHide: true });
        } catch (e) {
          closeSync(fd);
          resolve({ estado: "falhou", codigo: null, sinal: null, duracao_s: 0, truncado: false, pid: null, erro: e instanceof Error ? e.message : "falha ao iniciar" });
          return;
        }
        const pid = filho.pid ?? null;
        let liberarFim: () => void = () => undefined;
        const fim = new Promise<void>((r) => { liberarFim = r; });
        const finalizar = (r: Omit<ResultadoExecutor, "duracao_s" | "truncado" | "pid">): void => {
          if (resolvido) return;
          resolvido = true;
          clearTimeout(timer);
          clearInterval(vigia);
          sinal?.removeEventListener("abort", aoAbortar);
          if (pid !== null) { matarArvore(pid); registro.remover(pid); ativos.delete(pid); }
          try { closeSync(fd); } catch { /* já fechado */ }
          resolve({ ...r, duracao_s: Math.round(((performance.now() - inicio) / 1000) * 1000) / 1000, truncado, pid });
          liberarFim();
        };
        const matar = (m: "timeout" | "cancelado" | "teto"): void => {
          if (motivo === null) motivo = m;
          if (pid !== null) matarArvore(pid);
        };
        const aoAbortar = (): void => matar("cancelado");
        const timer = setTimeout(() => matar("timeout"), p.timeoutMs ?? TIMEOUT_PADRAO_MS);
        const vigia = setInterval(() => {
          try { if (statSync(p.logAbs).size > teto) { truncado = true; matar("teto"); } } catch { /* log ainda não existe */ }
        }, 250);
        if (sinal?.aborted === true) matar("cancelado");
        else sinal?.addEventListener("abort", aoAbortar, { once: true });
        if (pid !== null) {
          const proc = consultarProcesso(pid);
          registro.registrar({ pid, inicio: proc?.inicio ?? "", comando: proc?.comando ?? `${p.executavel} ${p.args.join(" ")}`.slice(0, 200), rotulo: p.rotulo ?? "" });
          ativos.set(pid, { cancelar: () => matar("cancelado"), fim });
        }
        filho.on("error", (e) => finalizar({ estado: "falhou", codigo: null, sinal: null, erro: e.message }));
        filho.on("exit", (codigo, sig) => {
          // saída rápida demais para o vigia: confere o tamanho do log na saída também
          if (motivo === null) { try { if (statSync(p.logAbs).size > teto) { truncado = true; motivo = "teto"; } } catch { /* sem log */ } }
          if (motivo === "timeout") return finalizar({ estado: "tempo_esgotado", codigo, sinal: sig, erro: null });
          if (motivo === "cancelado") return finalizar({ estado: "cancelado", codigo, sinal: sig, erro: null });
          if (motivo === "teto") return finalizar({ estado: "falhou", codigo, sinal: sig, erro: "saída acima do teto (truncada)" });
          finalizar({ estado: codigo === 0 ? "concluido" : "falhou", codigo, sinal: sig, erro: codigo === 0 ? null : `saída ${codigo ?? sig ?? "?"}` });
        });
        const stdin = filho.stdin;
        if (stdin !== null) {
          stdin.on("error", () => undefined); // EPIPE quando a CLI fecha cedo
          try { stdin.end(p.stdin ?? ""); } catch { /* CLI já saiu */ }
        }
      });
    },
  };
}
