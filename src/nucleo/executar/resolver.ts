// Resolução CONFINADA de cwd e executável: o que vem da configuração (do repositório, não confiável) nunca escapa da raiz do workspace
// por `..`, por symlink nem por entrada relativa no PATH. Síncrona e barata (poucos `stat`).
import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";

export type Resolucao = { ok: true; caminho: string } | { ok: false; erro: string };

const dentro = (raiz: string, alvo: string): boolean => {
  const r = relative(raiz, alvo);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/** cwd relativo à raiz: a raiz real e o destino real precisam coincidir no prefixo (symlink para fora é recusado). */
export function resolverCwd(raiz: string, rel: string): Resolucao {
  let raizReal: string;
  try { raizReal = realpathSync(raiz); } catch { return { ok: false, erro: "A pasta do workspace não existe mais." }; }
  if (rel === "" || rel === ".") return { ok: true, caminho: raizReal };
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return { ok: false, erro: "cwd fora do workspace." };
  let real: string;
  try { real = realpathSync(join(raizReal, rel)); } catch { return { ok: false, erro: `A pasta de execução não existe: ${rel}` }; }
  if (!dentro(raizReal, real)) return { ok: false, erro: "cwd aponta para fora do workspace (symlink recusado)." };
  try { if (!statSync(real).isDirectory()) return { ok: false, erro: "cwd não é uma pasta." }; } catch { return { ok: false, erro: "cwd inacessível." }; }
  return { ok: true, caminho: real };
}

function executavelEm(caminho: string, plataforma: NodeJS.Platform): boolean {
  try {
    const st = statSync(caminho);
    if (!st.isFile()) return false;
    if (plataforma !== "win32") accessSync(caminho, constants.X_OK);
    return true;
  } catch { return false; }
}

export interface OpcoesResolverExecutavel {
  path?: string;
  pathext?: string;
  plataforma?: NodeJS.Platform;
  /** pastas extras convencionais (Homebrew, volta, bun…) depois do PATH */
  extras?: readonly string[];
}

/**
 * `exe`: nome do PATH (`npm`) ou caminho relativo à RAIZ (`./gradlew`). O resultado é sempre absoluto e real.
 * Entrada relativa no PATH (`.`, vazia) é ignorada: um executável plantado na pasta atual nunca ganha de um do sistema.
 */
export function resolverExecutavel(raiz: string, exe: string, op: OpcoesResolverExecutavel = {}): Resolucao {
  const plataforma = op.plataforma ?? process.platform;
  if (exe.includes("/") || (plataforma === "win32" && exe.includes("\\"))) {
    let raizReal: string;
    try { raizReal = realpathSync(raiz); } catch { return { ok: false, erro: "A pasta do workspace não existe mais." }; }
    if (isAbsolute(exe) || exe.split(/[\\/]/).includes("..")) return { ok: false, erro: "executável fora do workspace." };
    const candidato = join(raizReal, exe);
    let real: string;
    try { real = realpathSync(candidato); } catch { return { ok: false, erro: `Executável não encontrado no projeto: ${exe}` }; }
    if (!dentro(raizReal, real)) return { ok: false, erro: "executável aponta para fora do workspace (symlink recusado)." };
    return executavelEm(real, plataforma) ? { ok: true, caminho: real } : { ok: false, erro: `Sem permissão de execução: ${exe}` };
  }
  const exts = plataforma === "win32" ? (op.pathext ?? process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  const dirs = [...(op.path ?? process.env["PATH"] ?? "").split(delimiter), ...(op.extras ?? [])].filter((d) => d !== "" && isAbsolute(d));
  for (const dir of new Set(dirs)) {
    for (const ext of exts) {
      const candidato = join(dir, plataforma === "win32" && /\.[A-Za-z]{2,4}$/.test(exe) ? exe : `${exe}${ext}`);
      if (!executavelEm(candidato, plataforma)) continue;
      try { return { ok: true, caminho: realpathSync(candidato) }; } catch { /* quebrou no caminho: tenta o próximo */ }
    }
  }
  return { ok: false, erro: `Programa não encontrado no PATH: ${exe}` };
}

export const ehSymlink = (p: string): boolean => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
export const SEPARADOR = sep;
