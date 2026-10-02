// Hash de confiança de uma configuração: muda quando QUALQUER coisa que determina o que será executado muda
// (comando, argumentos, cwd, ambiente, pré-passos, shell e o corpo do script do repositório a que o comando aponta).
import { createHash } from "node:crypto";
import type { ConfigExecucao, PassoExecucao } from "./modelo";

const aspas = (a: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`);

export const linhaDoPasso = (p: PassoExecucao): string => [p.executavel, ...p.argumentos].map(aspas).join(" ");

/** Linhas legíveis do que será executado (uma por passo; o shell aparece como tal). */
export function linhasDoComando(c: Pick<ConfigExecucao, "executavel" | "argumentos" | "pre_passos" | "shell">): string[] {
  const principal = c.shell !== null ? `[shell] ${c.shell}` : linhaDoPasso({ executavel: c.executavel, argumentos: c.argumentos });
  return [...c.pre_passos.map(linhaDoPasso), principal];
}

/** Uma linha só (histórico e tooltip). */
export const comandoEmTexto = (c: Pick<ConfigExecucao, "executavel" | "argumentos" | "pre_passos" | "shell">): string => linhasDoComando(c).join(" && ");

/** JSON canônico (chaves ordenadas) para hash estável. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** `corpo`: texto do script do repositório que o comando dispara (ex.: `scripts.dev` do package.json); `null` quando não há. */
export function hashDeConfianca(c: ConfigExecucao, corpo: string | null): string {
  const base = {
    e: c.executavel, a: c.argumentos, cwd: c.cwd, env: c.ambiente, p: c.pre_passos, s: c.shell, corpo: corpo ?? null,
  };
  return createHash("sha256").update(canonico(base)).digest("hex").slice(0, 40);
}
