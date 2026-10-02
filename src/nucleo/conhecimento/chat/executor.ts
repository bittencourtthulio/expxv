// Executor headless do chat (T-15.34): implementa `PortaLlm` disparando a CLI do usuário (assinatura dele, nunca chave de API própria)
// com executável e argumentos SEPARADOS (nunca shell), prompt por stdin, `cwd` neutro vazio, ambiente seguro, timeout de 120 s, teto de
// 1 MiB de saída e morte da ÁRVORE de processos ao cancelar. O spawn é injetado (teste usa CLI falsa). Nunca `--bare`, nunca bypass de
// sandbox, nunca `--auto` (garantido por `montarComando`). Wrapper `.cmd`/PowerShell do Windows não é aceito aqui (exigiria shell).
import { spawn as spawnNode } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extrairTexto, montarComando, SAIDA_MAX_BYTES, TIMEOUT_HEADLESS_MS, verificarFlags } from "./headless";
import type { PerfilChat, PortaLlm } from "./tipos";

export interface ProcessoFilho {
  stdin: { write(texto: string): void; end(): void };
  stdout: AsyncIterable<Buffer | string>;
  /** mata a árvore inteira. */
  matar(): void;
  saida: Promise<number | null>;
}
export interface PedidoSpawn {
  executavel: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}
export type Spawner = (p: PedidoSpawn) => ProcessoFilho;

/** Spawn real: grupo de processos próprio (posix) para matar a árvore; `taskkill /T` no Windows. Sem shell, stderr descartado. */
export const spawnerNode: Spawner = (p) => {
  const filho = spawnNode(p.executavel, p.args, { cwd: p.cwd, env: p.env, stdio: ["pipe", "pipe", "ignore"], detached: process.platform !== "win32", windowsHide: true, shell: false });
  const saida = new Promise<number | null>((resolver) => {
    filho.once("exit", (c) => resolver(c));
    filho.once("error", () => resolver(null));
  });
  filho.stdin.on("error", () => undefined);
  return {
    stdin: { write: (t) => void filho.stdin.write(t), end: () => void filho.stdin.end() },
    stdout: filho.stdout,
    saida,
    matar() {
      const pid = filho.pid;
      if (pid === undefined) return;
      try {
        if (process.platform === "win32") spawnNode("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false }).on("error", () => undefined);
        else process.kill(-pid, "SIGKILL");
      } catch {
        try {
          filho.kill("SIGKILL");
        } catch {
          /* já terminou */
        }
      }
    },
  };
};

export interface CliResolvida {
  caminho: string;
  /** `direto` é o único aceito aqui. */
  modo: string | null;
}

export interface OpcoesExecutor {
  perfil: () => PerfilChat | null | Promise<PerfilChat | null>;
  resolverCli: (cli: string) => Promise<CliResolvida | null>;
  /** texto de `--help` da CLI (para `verificarFlags`); `null` = não conseguiu. */
  ajuda: (cli: string, caminho: string) => Promise<string | null>;
  /** `ambienteSeguro` sobre o executável (retira variáveis de identidade de sessão e completa o PATH). */
  ambiente: (caminho: string) => Record<string, string>;
  /** pasta neutra vazia (`<userData>/chat/cwd`). */
  pastaNeutra: string;
  spawn?: Spawner;
  timeoutMs?: number;
  maxBytes?: number;
}

export class ExecucaoHeadlessErro extends Error {
  override name = "ExecucaoHeadlessErro";
}

export function criarExecutorHeadless(o: OpcoesExecutor): PortaLlm {
  const spawn = o.spawn ?? spawnerNode;
  const verificadas = new Map<string, { ok: boolean; motivo?: string }>();

  async function preparar(): Promise<{ perfil: PerfilChat; cli: CliResolvida } | { motivo: string }> {
    const perfil = await o.perfil();
    if (perfil === null) return { motivo: "nenhuma CLI configurada ou com cota para o chat" };
    const cli = await o.resolverCli(perfil.cli);
    if (cli === null) return { motivo: `a CLI ${perfil.cli} não está instalada` };
    if (cli.modo !== null && cli.modo !== "direto") return { motivo: `a CLI ${perfil.cli} usa wrapper de Windows; o chat headless não a executa sem shell` };
    if (perfil.cli === "gemini") return { motivo: "adaptador do Gemini é experimental e fica desligado até a verificação das flags numa máquina que o tenha" };
    const chave = `${perfil.cli}|${cli.caminho}`;
    let v = verificadas.get(chave);
    if (v === undefined) {
      const ajuda = await o.ajuda(perfil.cli, cli.caminho);
      v = ajuda === null ? { ok: false, motivo: `não foi possível ler a ajuda da CLI ${perfil.cli}` } : verificarFlags(perfil.cli, ajuda);
      verificadas.set(chave, v);
    }
    return v.ok ? { perfil, cli } : { motivo: v.motivo ?? "flags ausentes" };
  }

  return {
    async disponivel() {
      try {
        const r = await preparar();
        return "motivo" in r ? { ok: false, motivo: r.motivo } : { ok: true };
      } catch {
        return { ok: false, motivo: "falha ao verificar a CLI" };
      }
    },
    executar(p) {
      const limite = o.timeoutMs ?? TIMEOUT_HEADLESS_MS;
      const teto = o.maxBytes ?? SAIDA_MAX_BYTES;
      async function* fluxo(): AsyncGenerator<string> {
        const r = await preparar();
        if ("motivo" in r) throw new ExecucaoHeadlessErro(r.motivo);
        mkdirSync(o.pastaNeutra, { recursive: true });
        let arquivoContexto: string | undefined;
        // OpenCode não lê o prompt por stdin: contexto longo vai por arquivo (0600) na pasta neutra, apagado ao fim
        if (r.perfil.cli === "opencode" && p.prompt.length > 3500) {
          arquivoContexto = join(o.pastaNeutra, `ctx-${randomBytes(6).toString("hex")}.md`);
          writeFileSync(arquivoContexto, `${p.sistema}\n\n${p.prompt}\n`, { mode: 0o600 });
        }
        const cmd = montarComando(r.perfil, { sistema: p.sistema, prompt: p.prompt, pastaNeutra: o.pastaNeutra, ...(arquivoContexto ? { arquivoContexto } : {}) });
        const filho = spawn({ executavel: r.cli.caminho, args: cmd.args, cwd: o.pastaNeutra, env: o.ambiente(r.cli.caminho) });
        const encerrar = (): void => filho.matar();
        const timer = setTimeout(encerrar, limite);
        timer.unref?.();
        p.sinal.addEventListener("abort", encerrar, { once: true });
        let bytes = 0;
        let emitiu = false;
        let resto = "";
        try {
          if (cmd.stdin !== null) filho.stdin.write(cmd.stdin);
          filho.stdin.end();
          for await (const pedaco of filho.stdout) {
            const t = typeof pedaco === "string" ? pedaco : pedaco.toString("utf8");
            bytes += Buffer.byteLength(t);
            if (bytes > teto) {
              encerrar();
              throw new ExecucaoHeadlessErro("a CLI excedeu o teto de saída");
            }
            resto += t;
            let i: number;
            while ((i = resto.indexOf("\n")) >= 0) {
              const linha = resto.slice(0, i);
              resto = resto.slice(i + 1);
              const delta = extrairTexto(r.perfil.cli, linha);
              if (delta !== "") {
                emitiu = true;
                yield delta;
              }
            }
            if (p.sinal.aborted) throw new ExecucaoHeadlessErro("cancelado");
          }
          if (resto.trim() !== "") {
            const delta = extrairTexto(r.perfil.cli, resto);
            if (delta !== "") {
              emitiu = true;
              yield delta;
            }
          }
          const codigo = await filho.saida;
          if (p.sinal.aborted) throw new ExecucaoHeadlessErro("cancelado");
          if (!emitiu && codigo !== 0) throw new ExecucaoHeadlessErro("a CLI terminou com erro sem resposta");
        } finally {
          clearTimeout(timer);
          p.sinal.removeEventListener("abort", encerrar);
          encerrar();
          if (arquivoContexto !== undefined) rmSync(arquivoContexto, { force: true });
        }
      }
      return fluxo();
    },
  };
}
