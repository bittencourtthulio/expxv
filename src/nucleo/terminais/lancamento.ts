// Lançamento de processos em PTY: tipos do adaptador, argv separado (nunca shell) e
// wrappers do Windows. Sem dependência de node-pty (testável com PTY falso).

import { spawn as spawnProcesso, type ChildProcess } from "node:child_process";
import type { ModoLancamento } from "../../compartilhado/terminais";
import type { InfoSessaoDaemon, MetaSessao } from "../../daemon/protocolo";

/** O que o lançamento precisa saber do executável (a detecção devolve algo compatível). */
export interface ExecutavelPty {
  ferramenta_id: string;
  caminho: string;
  modo_lancamento: ModoLancamento | null;
}

export interface Descartavel { dispose(): void }

export interface ProcessoPty {
  pid: number;
  /** `fim` só vem do daemon: total acumulado de caracteres da sessão depois deste pedaço. */
  onData(fn: (dados: string, fim?: number) => void): Descartavel;
  onExit(fn: (evento: { exitCode: number; signal?: number | undefined }) => void): Descartavel;
  write(dados: string): void;
  resize(colunas: number, linhas: number): void;
  pause(): void;
  resume(): void;
  kill(sinal?: string): void;
}

export interface OpcoesSpawn {
  cwd: string;
  colunas: number;
  linhas: number;
  env: Record<string, string>;
  /** Identidade e dados da aba: o daemon guarda para remontar a sessão depois que o app fechou. */
  sessao_id?: string;
  meta?: MetaSessao;
}

export interface AdaptadorPty {
  spawn(executavel: ExecutavelPty, argumentos: readonly string[], opcoes: OpcoesSpawn): ProcessoPty;
  /** Só o adaptador do daemon: as sessões sobrevivem ao app e podem ser retomadas por ele. */
  persistente?: boolean;
  listar?(): Promise<InfoSessaoDaemon[]>;
  anexar?(sessaoId: string): ProcessoPty;
  historico?(sessaoId: string): Promise<{ dados: string; fim: number }>;
  soltar?(sessaoId: string): void;
  descartar?(sessaoId: string): void;
}

/** Argumento de `cmd.exe`: entre aspas; `%` dobrado e metacaracteres escapados com `^`. */
export function argumentoCmd(valor: string): string {
  if (/[\r\n\0]/.test(valor)) throw new Error("argumento inválido para wrapper do Windows");
  return `"${valor.replaceAll("%", "%%").replace(/[\^&|<>()!"]/g, (c) => `^${c}`)}"`;
}

export function prepararLancamento(
  executavel: ExecutavelPty,
  argumentos: readonly string[],
): { arquivo: string; argumentos: string[] | string } {
  if (executavel.modo_lancamento === "cmd_wrapper") {
    const comando = ["call", argumentoCmd(executavel.caminho), ...argumentos.map(argumentoCmd)].join(" ");
    return { arquivo: process.env["ComSpec"] ?? "cmd.exe", argumentos: `/d /q /c ${comando}` };
  }
  if (executavel.modo_lancamento === "powershell_wrapper") {
    return {
      arquivo: "powershell.exe",
      argumentos: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", executavel.caminho, ...argumentos],
    };
  }
  return { arquivo: executavel.caminho, argumentos: [...argumentos] };
}

type IniciarComando = (arquivo: string, argumentos: readonly string[]) => Pick<ChildProcess, "once" | "unref">;

/** forkpty cria um grupo próprio no Unix; no Windows `taskkill /t` cobre os descendentes. */
export function encerrarArvorePty(
  processo: Pick<ProcessoPty, "pid" | "kill">,
  sinal = "SIGTERM",
  plataforma: NodeJS.Platform = process.platform,
  enviarSinal: (pid: number, sinal: NodeJS.Signals) => boolean = process.kill,
  iniciarComando: IniciarComando = (arquivo, argumentos) => spawnProcesso(arquivo, [...argumentos], { windowsHide: true, stdio: "ignore" }),
): void {
  if (plataforma === "win32") {
    const tarefa = iniciarComando("taskkill.exe", ["/pid", String(processo.pid), "/t", "/f"]);
    tarefa.once("error", () => processo.kill(sinal));
    tarefa.unref();
    return;
  }
  try {
    enviarSinal(-processo.pid, sinal as NodeJS.Signals);
  } catch {
    processo.kill(sinal);
  }
}
