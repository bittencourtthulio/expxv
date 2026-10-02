// Execução SEGURA de um processo filho do instalador (D-473): executável e argumentos SEPARADOS (nunca shell), stdin fechado, ambiente
// recebido pronto, timeout geral e por silêncio, saída com teto, kill da ÁRVORE (grupo de processos no POSIX, `taskkill /T` no Windows).
// Mesmo contrato de segurança do "Executar projeto" (src/nucleo/executar): resolução confinada e `ambienteSeguro` ficam com quem chama.
import { spawn, type ChildProcess } from "node:child_process";

export type MotivoFim = "saiu" | "tempo_total" | "silencio" | "cancelado" | "saida_excessiva" | "erro_ao_iniciar";

export interface PedidoProcesso {
  executavel: string;
  argumentos: readonly string[];
  cwd: string;
  env: Record<string, string>;
  tempoTotalMs: number;
  silencioMs: number;
  maxBytes: number;
  aoLinha: (linha: string, canal: "stdout" | "stderr") => void;
  sinal?: AbortSignal;
  /** espera entre SIGTERM e SIGKILL (padrão 2 s) */
  gracaMs?: number;
  plataforma?: NodeJS.Platform;
}

export interface ResultadoProcesso {
  codigo: number | null;
  sinal: string | null;
  motivo: MotivoFim;
  /** só em `erro_ao_iniciar`: código do erro do SO (ENOENT, EACCES…), nunca a mensagem crua */
  erro: string | null;
  bytes: number;
}

/** Mata a árvore: o grupo inteiro (POSIX, o filho nasce líder do grupo) ou `taskkill /T /F` (Windows). Nunca lança. */
export function matarArvore(filho: ChildProcess, sinal: NodeJS.Signals, plataforma: NodeJS.Platform = process.platform): void {
  const pid = filho.pid;
  if (pid === undefined) return;
  try {
    if (plataforma === "win32") {
      const t = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false });
      t.on("error", () => undefined);
      return;
    }
    process.kill(-pid, sinal);
  } catch {
    try { filho.kill(sinal); } catch { /* já saiu */ }
  }
}

export function executarProcesso(p: PedidoProcesso): Promise<ResultadoProcesso> {
  const plataforma = p.plataforma ?? process.platform;
  return new Promise<ResultadoProcesso>((resolver) => {
    let motivo: MotivoFim = "saiu";
    let bytes = 0;
    let encerrando = false;
    let acabou = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let silencio: ReturnType<typeof setTimeout> | null = null;

    const terminar = (r: Omit<ResultadoProcesso, "bytes">): void => {
      if (acabou) return;
      acabou = true;
      for (const t of timers) clearTimeout(t);
      if (silencio !== null) clearTimeout(silencio);
      p.sinal?.removeEventListener("abort", aoAbortar);
      resolver({ ...r, bytes });
    };

    let filho: ChildProcess;
    try {
      filho = spawn(p.executavel, [...p.argumentos], { cwd: p.cwd, env: p.env, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: plataforma !== "win32", windowsHide: true });
    } catch (e) {
      terminar({ codigo: null, sinal: null, motivo: "erro_ao_iniciar", erro: (e as NodeJS.ErrnoException).code ?? "ERRO" });
      return;
    }

    const encerrar = (m: MotivoFim): void => {
      if (encerrando || acabou) return;
      encerrando = true;
      motivo = m;
      matarArvore(filho, "SIGTERM", plataforma);
      const k = setTimeout(() => matarArvore(filho, "SIGKILL", plataforma), p.gracaMs ?? 2_000);
      k.unref();
      timers.add(k);
      // rede de segurança: se o `close` nunca vier, resolve mesmo assim
      const f = setTimeout(() => terminar({ codigo: null, sinal: "SIGKILL", motivo: m, erro: null }), (p.gracaMs ?? 2_000) + 3_000);
      f.unref();
      timers.add(f);
    };

    function aoAbortar(): void { encerrar("cancelado"); }
    if (p.sinal !== undefined) {
      if (p.sinal.aborted) { encerrar("cancelado"); } else p.sinal.addEventListener("abort", aoAbortar, { once: true });
    }

    const reiniciarSilencio = (): void => {
      if (silencio !== null) clearTimeout(silencio);
      silencio = setTimeout(() => encerrar("silencio"), p.silencioMs);
      silencio.unref();
    };
    const total = setTimeout(() => encerrar("tempo_total"), p.tempoTotalMs);
    total.unref();
    timers.add(total);
    reiniciarSilencio();

    const restos: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
    const alimentar = (canal: "stdout" | "stderr", dados: Buffer): void => {
      bytes += dados.length;
      reiniciarSilencio();
      if (bytes > p.maxBytes) { encerrar("saida_excessiva"); return; }
      if (encerrando) return;
      const partes = (restos[canal] + dados.toString("utf8")).split("\n");
      restos[canal] = partes.pop() ?? "";
      // linha gigante sem quebra não cresce sem fim
      if (restos[canal].length > 8_192) { partes.push(restos[canal]); restos[canal] = ""; }
      for (const l of partes) { try { p.aoLinha(l, canal); } catch { /* ouvinte com erro não derruba o processo */ } }
    };
    filho.stdout?.on("data", (d: Buffer) => alimentar("stdout", d));
    filho.stderr?.on("data", (d: Buffer) => alimentar("stderr", d));
    filho.on("error", (e: NodeJS.ErrnoException) => terminar({ codigo: null, sinal: null, motivo: "erro_ao_iniciar", erro: e.code ?? "ERRO" }));
    filho.on("close", (codigo, sinal) => {
      for (const canal of ["stdout", "stderr"] as const) {
        if (restos[canal] !== "" && !encerrando) { try { p.aoLinha(restos[canal], canal); } catch { /* idem */ } }
      }
      terminar({ codigo, sinal, motivo, erro: null });
    });
  });
}
