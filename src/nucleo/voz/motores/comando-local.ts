// Motor por comando local (Fase 11, T-11.06): executável ESCOLHIDO PELA PESSOA, argumentos em LISTA com marcadores `{wav}` `{idioma}` `{modelo}`, `spawn` sem shell.
// O WAV existe só em `<tmp>/<prefixo>-voz-<aleatório>/` (0700) e é apagado em `finally`, inclusive em timeout/kill. Timeout 60 s, saída ≤ 1 MiB. Nada é baixado nem instalado.
import { spawn as spawnReal, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { PRODUTO } from "../../produto";
import { ErroMotor, lerTranscricao, type MotorStt, type OpcoesTranscricao } from "./motor";

export const SAIDA_MAX_BYTES = 1024 * 1024;
export const TIMEOUT_MOTOR_MS = 60_000;
const CONTROLE = /[\u0000-\u001f\u007f]/;

export type ResultadoComando = { ok: true } | { ok: false; motivo: string };

/** Validação na gravação da configuração (e de novo no uso): caminho ABSOLUTO, sem controle, argumentos curtos e com `{wav}`. Nunca string de shell. */
export function validarComando(executavel: string, args: readonly string[]): ResultadoComando {
  if (executavel === "" || executavel.length > 1_024 || CONTROLE.test(executavel)) return { ok: false, motivo: "Caminho do executável inválido." };
  if (!isAbsolute(executavel)) return { ok: false, motivo: "Informe o caminho ABSOLUTO do executável (nada de nome solto: evita executar outro programa do PATH)." };
  if (args.length > 32) return { ok: false, motivo: "Argumentos demais (máximo 32)." };
  for (const a of args) if (typeof a !== "string" || a.length > 512 || CONTROLE.test(a)) return { ok: false, motivo: "Argumento inválido (texto curto, sem caracteres de controle)." };
  if (!args.some((a) => a.includes("{wav}"))) return { ok: false, motivo: "Os argumentos precisam conter o marcador {wav} (arquivo de áudio)." };
  return { ok: true };
}

export function substituirMarcadores(args: readonly string[], v: { wav: string; idioma: string; modelo: string }): string[] {
  return args.map((a) => a.replaceAll("{wav}", v.wav).replaceAll("{idioma}", v.idioma).replaceAll("{modelo}", v.modelo));
}

/** Ambiente mínimo: o programa de STT não herda chaves de provedor nem variáveis de sessão do app. */
export function ambienteMinimo(origem: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const manter = ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "HOMEBREW_PREFIX", "XDG_CACHE_HOME", "XDG_DATA_HOME"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of manter) { const v = origem[k]; if (v !== undefined) env[k] = v; }
  return env;
}

export type SpawnFn = (cmd: string, args: readonly string[], op: SpawnOptions) => ChildProcess;

export interface OpcoesComandoLocal {
  executavel: string;
  args: readonly string[];
  timeout_ms?: number;
  /** base do diretório temporário (testes injetam uma pasta própria). */
  tmp?: string;
  spawn?: SpawnFn;
  ambiente?: () => NodeJS.ProcessEnv;
}

function matarArvore(filho: ChildProcess): void {
  const pid = filho.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") spawnReal("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: false, stdio: "ignore", windowsHide: true }).on("error", () => undefined);
    else process.kill(-pid, "SIGKILL");
  } catch {
    try { filho.kill("SIGKILL"); } catch { /* já morreu */ }
  }
}

export function criarMotorComandoLocal(op: OpcoesComandoLocal): MotorStt {
  const timeout = op.timeout_ms ?? TIMEOUT_MOTOR_MS;
  const spawn: SpawnFn = op.spawn ?? ((c, a, o) => spawnReal(c, [...a], o));
  return {
    async transcrever(wav: Uint8Array, o: OpcoesTranscricao): Promise<string> {
      const v = validarComando(op.executavel, op.args);
      if (!v.ok) throw new ErroMotor("motor_ausente", v.motivo);
      const dir = await mkdtemp(join(op.tmp ?? tmpdir(), `${PRODUTO.id}-voz-`));
      try {
        const arquivo = join(dir, "fala.wav");
        await writeFile(arquivo, wav, { mode: 0o600 });
        const args = substituirMarcadores(op.args, { wav: arquivo, idioma: o.idioma, modelo: o.modelo ?? "" });
        return await new Promise<string>((resolve, reject) => {
          let filho: ChildProcess;
          try {
            filho = spawn(op.executavel, args, { cwd: dir, shell: false, stdio: ["ignore", "pipe", "pipe"], env: (op.ambiente ?? ambienteMinimo)(), detached: process.platform !== "win32", windowsHide: true });
          } catch (e) {
            reject(new ErroMotor((e as NodeJS.ErrnoException).code === "ENOENT" ? "motor_ausente" : "motor_falhou", "Não foi possível iniciar o motor de voz."));
            return;
          }
          const partes: Buffer[] = [];
          let total = 0;
          let acabou = false;
          const fim = (erro: ErroMotor | null, texto = ""): void => {
            if (acabou) return;
            acabou = true;
            clearTimeout(relogio);
            o.sinal?.removeEventListener("abort", aoAbortar);
            if (erro === null) resolve(texto); else reject(erro);
          };
          const aoAbortar = (): void => { matarArvore(filho); fim(new ErroMotor("cancelado", "Transcrição cancelada.")); };
          const relogio = setTimeout(() => { matarArvore(filho); fim(new ErroMotor("tempo_esgotado", "O motor de voz demorou demais e foi encerrado.")); }, timeout);
          relogio.unref?.();
          o.sinal?.addEventListener("abort", aoAbortar, { once: true });
          if (o.sinal?.aborted === true) { aoAbortar(); return; }
          filho.stdout?.on("data", (b: Buffer) => {
            total += b.byteLength;
            if (total > SAIDA_MAX_BYTES) { matarArvore(filho); fim(new ErroMotor("motor_falhou", "O motor de voz devolveu saída grande demais.")); return; }
            partes.push(b);
          });
          filho.stderr?.on("data", () => undefined); // descartada: pode conter fala ou segredo; nunca vai a log
          filho.on("error", (e: NodeJS.ErrnoException) => fim(new ErroMotor(e.code === "ENOENT" || e.code === "EACCES" ? "motor_ausente" : "motor_falhou", e.code === "ENOENT" ? "Executável do motor de voz não encontrado." : "Não foi possível executar o motor de voz.")));
          filho.on("close", (codigo) => {
            if (codigo !== 0) { fim(new ErroMotor("motor_falhou", `O motor de voz terminou com código ${codigo ?? "?"}.`)); return; }
            fim(null, lerTranscricao(Buffer.concat(partes).toString("utf8")));
          });
        });
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
