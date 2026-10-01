// Adaptador de PTY real (node-pty). node-pty só é carregado no primeiro `spawn` (ou em
// `nodePtyDisponivel()`), para que quem importa o módulo sem abrir PTY não pague o custo nativo.

import { encerrarArvorePty, prepararLancamento, type AdaptadorPty, type ExecutavelPty, type OpcoesSpawn, type ProcessoPty } from "./lancamento";

type NodePty = typeof import("node-pty");

let carregado: NodePty | null = null;
function carregar(): NodePty {
  carregado ??= require("node-pty") as NodePty;
  return carregado;
}

/** Verdadeiro se o node-pty carrega neste runtime (Node do sistema ou Electron em modo Node). */
export function nodePtyDisponivel(): boolean {
  try { carregar(); return true; } catch { return false; }
}

export class AdaptadorNodePty implements AdaptadorPty {
  spawn(executavel: ExecutavelPty, argumentos: readonly string[], opcoes: OpcoesSpawn): ProcessoPty {
    const lancamento = prepararLancamento(executavel, argumentos);
    const processo = carregar().spawn(lancamento.arquivo, lancamento.argumentos, {
      name: "xterm-256color",
      cwd: opcoes.cwd,
      env: opcoes.env,
      cols: opcoes.colunas,
      rows: opcoes.linhas,
    });
    return {
      get pid() { return processo.pid; },
      onData: (fn) => processo.onData((dados) => fn(dados)),
      onExit: (fn) => processo.onExit(fn),
      write: (dados) => processo.write(dados),
      resize: (colunas, linhas) => processo.resize(colunas, linhas),
      pause: () => processo.pause(),
      resume: () => processo.resume(),
      kill: (sinal) => encerrarArvorePty(processo, sinal),
    };
  }
}
