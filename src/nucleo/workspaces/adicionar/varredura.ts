// "Encontrar projetos nesta máquina" (D-609). Varredura OPT-IN, leve e limitada: só lê nomes de diretório e o `.git/HEAD`; nunca abre código, não segue link simbólico,
// não desce dentro de projeto achado, ignora pastas pesadas/ocultas, para em 2 000 diretórios e cede o event loop a cada ~12 ms (nunca trava o main > 50 ms). Cancelável.
import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const MAX_DIRETORIOS = 2000;
export const MAX_PROFUNDIDADE = 3;
const ORCAMENTO_MS = 12;
const TAMANHO_LOTE = 10;

export const IGNORADAS = new Set(["node_modules", ".git", "Library", "dist", ".venv", "venv", "build", "target", ".cache", ".Trash", "Applications", "__pycache__", "vendor", "coverage"]);
/** Pastas do macOS que pedem permissão ao serem lidas: nunca entram como filhas da pasta pessoal (só como raiz explícita). */
export const PROTEGIDAS_DA_CASA = new Set(["Desktop", "Documents", "Downloads", "Movies", "Music", "Pictures", "Public", "Library", "Applications"]);
export const MANIFESTOS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json", "Gemfile", "mix.exs", "deno.json", "Package.swift", "pubspec.yaml"] as const;

export interface RaizVarredura {
  caminho: string;
  /** quantos níveis abaixo da raiz são examinados (a pasta pessoal usa 1). */
  profundidade: number;
  /** a raiz é a pasta pessoal: filhas protegidas são puladas. */
  casa?: boolean;
}

/** Locais comuns de projetos (D-609), relativos à pasta pessoal. */
export function raizesPadrao(casa: string): RaizVarredura[] {
  const sub = ["orca/projects", "Developer", "Projetos", "Documents/Projetos", "code", "dev", "src", "workspace"].map((p): RaizVarredura => ({ caminho: join(casa, ...p.split("/")), profundidade: MAX_PROFUNDIDADE }));
  return [...sub, { caminho: casa, profundidade: 1, casa: true }];
}

export interface AchadoBruto {
  caminho: string;
  nome: string;
  branch: string | null;
  e_git: boolean;
  manifesto: string | null;
}

export interface OpcoesVarredura {
  raizes: readonly RaizVarredura[];
  sinal: AbortSignal;
  aoLote: (itens: AchadoBruto[], visitados: number) => void;
  maxDiretorios?: number;
  ignoradas?: ReadonlySet<string>;
  /** relógio injetável (testes). */
  agora?: () => number;
  ceder?: () => Promise<void>;
}

export interface ResumoVarredura {
  visitados: number;
  total: number;
  limiteAtingido: boolean;
  cancelada: boolean;
}

/** Branch atual lendo só `.git/HEAD` (nenhum processo). `null` se detached, ilegível ou sem repositório. */
export async function lerBranch(pasta: string): Promise<{ e_git: boolean; branch: string | null }> {
  const git = join(pasta, ".git");
  let cabeca = join(git, "HEAD");
  try {
    let texto: string;
    try {
      texto = (await readFile(cabeca, "utf8")).slice(0, 512);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOTDIR" && (e as NodeJS.ErrnoException).code !== "EISDIR") throw e;
      const ponteiro = /^gitdir:\s*(.+)$/m.exec((await readFile(git, "utf8")).slice(0, 1024))?.[1]?.trim();
      if (ponteiro === undefined || ponteiro === "") return { e_git: true, branch: null };
      cabeca = join(isAbsolute(ponteiro) ? ponteiro : resolve(dirname(git), ponteiro), "HEAD");
      texto = (await readFile(cabeca, "utf8")).slice(0, 512);
    }
    const m = /^ref:\s*refs\/heads\/(\S{1,200})/m.exec(texto);
    return { e_git: true, branch: m?.[1] ?? null };
  } catch {
    return { e_git: false, branch: null };
  }
}

const cederPadrao = (): Promise<void> => new Promise((r) => setImmediate(r));

export async function varrerProjetos(op: OpcoesVarredura): Promise<ResumoVarredura> {
  const max = op.maxDiretorios ?? MAX_DIRETORIOS;
  const ignoradas = op.ignoradas ?? IGNORADAS;
  const agora = op.agora ?? ((): number => performance.now());
  const ceder = op.ceder ?? cederPadrao;
  const vistos = new Set<string>();
  const lote: AchadoBruto[] = [];
  let visitados = 0;
  let total = 0;
  let marca = agora();
  const descarregar = (): void => {
    if (lote.length === 0) return;
    op.aoLote(lote.splice(0, lote.length), visitados);
  };
  const resumo = (limite: boolean, cancelada: boolean): ResumoVarredura => {
    descarregar();
    return { visitados, total, limiteAtingido: limite, cancelada };
  };

  for (const raiz of op.raizes) {
    const fila: Array<{ pasta: string; nivel: number }> = [{ pasta: raiz.caminho, nivel: 0 }];
    for (let i = 0; i < fila.length; i++) {
      if (op.sinal.aborted) return resumo(false, true);
      if (visitados >= max) return resumo(true, false);
      const { pasta, nivel } = fila[i] as { pasta: string; nivel: number };
      if (vistos.has(pasta)) continue;
      vistos.add(pasta);
      visitados++;
      let itens: Dirent[];
      try {
        itens = await readdir(pasta, { withFileTypes: true });
      } catch {
        continue; // inexistente ou sem permissão: pula em silêncio
      }
      if (op.sinal.aborted) return resumo(false, true);
      const nomes = new Set(itens.map((d) => d.name));
      const manifesto = MANIFESTOS.find((m) => nomes.has(m)) ?? null;
      if (nivel > 0 && (nomes.has(".git") || manifesto !== null)) {
        const g = nomes.has(".git") ? await lerBranch(pasta) : { e_git: false, branch: null };
        lote.push({ caminho: pasta, nome: pasta.split(/[\\/]/).pop() ?? pasta, branch: g.branch, e_git: g.e_git || nomes.has(".git"), manifesto });
        total++;
        if (lote.length >= TAMANHO_LOTE) descarregar();
      } else if (nivel < raiz.profundidade) {
        for (const d of itens) {
          if (!d.isDirectory() || d.isSymbolicLink()) continue;
          if (d.name.startsWith(".") || ignoradas.has(d.name)) continue;
          if (raiz.casa === true && nivel === 0 && PROTEGIDAS_DA_CASA.has(d.name)) continue;
          fila.push({ pasta: join(pasta, d.name), nivel: nivel + 1 });
        }
      }
      if (agora() - marca > ORCAMENTO_MS) {
        descarregar();
        await ceder();
        marca = agora();
      }
    }
  }
  return resumo(false, false);
}
