// Sandbox do macOS por `sandbox-exec` com perfil GERADO por execução: escrita só no workdir/tmp/HOME da conta; leitura negada a credenciais. A rede continua permitida (a CLI precisa do provedor):
// risco residual documentado no diálogo de consentimento. Em SBPL a ÚLTIMA regra que casa vence, por isso a ordem abaixo é (1) tudo, (2) nega escrita, (3) libera escrita, (4) nega leitura, (5) reabre.
import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComandoEnvolvido, PoliticaSandbox, Sandbox } from "./sandbox";

const EXE = "/usr/bin/sandbox-exec";
const DISPOSITIVOS_ESCRITA = ['(literal "/dev/null")', '(literal "/dev/tty")', '(literal "/dev/dtracehelper")', '(literal "/dev/urandom")', '(literal "/dev/zero")', '(regex #"^/dev/ttys[0-9]+$")', '(regex #"^/dev/fd/[0-9]+$")'];

function aspas(caminho: string): string {
  if (/["\\\0\n\r]/.test(caminho) || !caminho.startsWith("/")) throw new Error("caminho inválido para o sandbox");
  return `"${caminho}"`;
}
const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

/** Credenciais e dados sensíveis do usuário (relativos ao HOME REAL, nunca o da conta dedicada). */
export function negadosPadrao(homeReal: string, extra: readonly string[] = []): string[] {
  const rel = [".ssh", ".aws", ".gnupg", ".config/gh", ".docker", ".kube", ".netrc", ".npmrc", ".git-credentials", ".config/gcloud", ".azure", "Library/Keychains", "Library/Cookies",
    "Library/Application Support/Google/Chrome", "Library/Application Support/Firefox", "Library/Application Support/BraveSoftware", "Library/Application Support/Microsoft Edge", "Library/Safari"];
  return [...rel.map((r) => join(homeReal, r)), ...extra];
}

export function gerarPerfil(p: PoliticaSandbox, tmp: string = real(tmpdir())): string {
  const escrita = p.somente_leitura === true ? [tmp] : [p.workdir, tmp, ...p.escrita];
  const linhas = ["(version 1)", "(allow default)", "(deny file-write*)",
    `(allow file-write* ${[...new Set(escrita)].map((c) => `(subpath ${aspas(c)})`).join(" ")} ${DISPOSITIVOS_ESCRITA.join(" ")})`];
  for (const n of p.leitura_negada) linhas.push(`(deny file-read* (subpath ${aspas(n)}))`);
  for (const l of p.leitura_liberada ?? []) linhas.push(`(allow file-read* (subpath ${aspas(l)}))`);
  // o que foi liberado para ESCRITA também é legível quando está DENTRO de um caminho negado (ex.: a conta dedicada em `userData`); um segredo aninhado numa pasta gravável continua negado
  // o workdir entra mesmo no modo somente leitura (juiz): sem ler o próprio cwd o processo aborta (`uv_cwd: EPERM`)
  for (const e of new Set([p.workdir, ...escrita])) if (p.leitura_negada.some((n) => e === n || e.startsWith(`${n}/`))) linhas.push(`(allow file-read* (subpath ${aspas(e)}))`);
  return linhas.join("\n") + "\n";
}

export interface OpcoesSandboxMacos {
  /** pasta (0700) onde os perfis nascem; por Run. */
  pastaPerfis: string;
  plataforma?: NodeJS.Platform;
  /** só para teste. */
  executavelSandbox?: string;
  /** só para teste: pasta temporária liberada para escrita (padrão: `os.tmpdir()`). */
  tmp?: string;
}

export function criarSandboxMacos(op: OpcoesSandboxMacos): Sandbox {
  const exe = op.executavelSandbox ?? EXE;
  const plataforma = op.plataforma ?? process.platform;
  let sanidade: Promise<boolean> | null = null;
  const ok = (): Promise<boolean> => {
    sanidade ??= plataforma !== "darwin" ? Promise.resolve(false) : new Promise<boolean>((resolve) => {
      let fim = false;
      const terminar = (v: boolean): void => { if (!fim) { fim = true; resolve(v); } };
      try {
        const perfil = "(version 1)\n(allow default)\n";
        const f = spawn(exe, ["-p", perfil, "/usr/bin/true"], { stdio: "ignore", shell: false });
        const t = setTimeout(() => { f.kill("SIGKILL"); terminar(false); }, 5000);
        f.on("error", () => { clearTimeout(t); terminar(false); });
        f.on("exit", (c) => { clearTimeout(t); terminar(c === 0); });
      } catch { terminar(false); }
    });
    return sanidade;
  };
  return {
    modo: plataforma === "darwin" ? "macos" : "indisponivel",
    disponivel: ok,
    envolver(executavel, args, politica): ComandoEnvolvido {
      mkdirSync(op.pastaPerfis, { recursive: true, mode: 0o700 });
      const arquivo = join(op.pastaPerfis, `p-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sb`);
      writeFileSync(arquivo, gerarPerfil({ ...politica, workdir: real(politica.workdir), escrita: politica.escrita.map(real), leitura_negada: politica.leitura_negada.map(real), ...(politica.leitura_liberada === undefined ? {} : { leitura_liberada: politica.leitura_liberada.map(real) }) }, op.tmp === undefined ? undefined : real(op.tmp)), { mode: 0o600 });
      chmodSync(arquivo, 0o600);
      return { executavel: exe, args: ["-f", arquivo, executavel, ...args], limpar: () => { try { rmSync(arquivo, { force: true }); } catch { /* já removido */ } } };
    },
  };
}
