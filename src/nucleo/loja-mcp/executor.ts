// Porta `Executor` da Loja de MCPs (Fase 7B, T-07B.11): roda UM processo por vez, sem shell (executável e
// argumentos separados), com ambiente 100% fornecido, saída limitada, timeout duro e cancelamento que mata a
// árvore. É a única via pela qual o instalador e o "instalar na minha CLI" executam algo; os testes injetam
// um executor falso (nenhum pacote real, nenhuma rede).

import { spawn } from "node:child_process";
import { matarArvore } from "./verificacao";

export interface PedidoExec {
  exe: string;
  args: readonly string[];
  cwd?: string;
  /** Ambiente EXATO do filho. */
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  sinal?: AbortSignal;
  /** Limite por fluxo (padrão 1 MB). */
  limiteSaida?: number;
}

export interface ResultadoExec {
  /** `null` quando morto por sinal/timeout/aborto ou quando o executável não existe. */
  codigo: number | null;
  saida: string;
  erro: string;
  timeout: boolean;
  abortado: boolean;
  excedeu_saida: boolean;
  /** `true` quando o executável não pôde ser iniciado (ENOENT/EACCES). */
  nao_iniciou: boolean;
}

export interface Executor {
  rodar(pedido: PedidoExec): Promise<ResultadoExec>;
}

export const LIMITE_SAIDA_PADRAO = 1024 * 1024;

/** Executor real: `spawn` com `shell:false`, grupo próprio no POSIX, árvore morta ao fim por erro/timeout/aborto. */
export function criarExecutorProcesso(): Executor {
  return {
    rodar(p: PedidoExec): Promise<ResultadoExec> {
      const limite = p.limiteSaida ?? LIMITE_SAIDA_PADRAO;
      return new Promise<ResultadoExec>((resolver) => {
        const r: ResultadoExec = { codigo: null, saida: "", erro: "", timeout: false, abortado: false, excedeu_saida: false, nao_iniciou: false };
        if (p.sinal?.aborted) { r.abortado = true; resolver(r); return; }
        const filho = spawn(p.exe, [...p.args], {
          cwd: p.cwd, env: { ...p.env }, shell: false, stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32", windowsHide: true,
        });
        let fim = false;
        const encerrar = (): void => {
          if (fim) return;
          fim = true;
          clearTimeout(relogio);
          p.sinal?.removeEventListener("abort", aoAbortar);
          matarArvore(filho); // filhos órfãos do instalador (ex.: scripts) morrem junto
          resolver(r);
        };
        const acumular = (chave: "saida" | "erro") => (pedaco: Buffer): void => {
          if (r[chave].length + pedaco.length > limite) { r.excedeu_saida = true; r[chave] += pedaco.subarray(0, Math.max(0, limite - r[chave].length)).toString("utf8"); matarArvore(filho); return; }
          r[chave] += pedaco.toString("utf8");
        };
        filho.stdout!.on("data", acumular("saida"));
        filho.stderr!.on("data", acumular("erro"));
        const relogio = setTimeout(() => { r.timeout = true; matarArvore(filho); }, p.timeoutMs);
        const aoAbortar = (): void => { r.abortado = true; matarArvore(filho); };
        p.sinal?.addEventListener("abort", aoAbortar, { once: true });
        filho.once("error", (e: NodeJS.ErrnoException) => { r.nao_iniciou = true; r.erro += e.code ?? "erro"; encerrar(); });
        filho.once("close", (codigo) => { r.codigo = codigo; encerrar(); });
      });
    },
  };
}
