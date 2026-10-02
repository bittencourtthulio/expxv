// Contexto, raízes e limites da varredura (T-07.04). `home` é injetável; o override por ambiente só vale com o modo e2e ligado.
import { createHash } from "node:crypto";
import { open, readdir, realpath, stat, lstat, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { variavelDeAmbiente } from "../produto";
import type { CacheVarredura, ItemEscaneado, WorkspaceVarredura } from "./tipos";

export const LIMITES = {
  profundidade: 4,
  entradasPorRaiz: 2000,
  skillMd: 256 * 1024,
  frontmatter: 8 * 1024,
  concorrencia: 16,
} as const;

export interface ContextoVarredura {
  home: string;
  workspaces: WorkspaceVarredura[];
  abort: AbortSignal | undefined;
  cache: CacheVarredura;
  /** nome normalizado → hashes sha256 conhecidos do SKILL.md embarcado */
  embarcadas: ReadonlyMap<string, ReadonlySet<string>>;
  /** leitura injetável (contador nos testes de P-24). */
  lerArquivo(caminho: string, max: number): Promise<Buffer>;
  /** instante fixo da varredura (visto_em). */
  agora: string;
}

export interface OpcoesContexto {
  home?: string;
  workspaces?: WorkspaceVarredura[];
  abort?: AbortSignal;
  cache?: CacheVarredura;
  embarcadas?: ReadonlyMap<string, ReadonlySet<string>>;
  lerArquivo?: ContextoVarredura["lerArquivo"];
  env?: NodeJS.ProcessEnv;
  agora?: string;
}

/** Home resolvida em runtime; o override só com `<PREFIXO>_E2E=1` e `<PREFIXO>_E2E_HOME`. */
export function resolverHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env[variavelDeAmbiente("E2E")] === "1") {
    const h = env[variavelDeAmbiente("E2E_HOME")];
    if (typeof h === "string" && isAbsolute(h)) return h;
  }
  return homedir();
}

export async function lerAte(caminho: string, max: number): Promise<Buffer> {
  const fh = await open(caminho, "r");
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export function criarContexto(o: OpcoesContexto = {}): ContextoVarredura {
  return {
    home: o.home ?? resolverHome(o.env),
    workspaces: o.workspaces ?? [],
    abort: o.abort,
    cache: o.cache ?? new Map(),
    embarcadas: o.embarcadas ?? new Map(),
    lerArquivo: o.lerArquivo ?? lerAte,
    agora: o.agora ?? new Date().toISOString(),
  };
}

export const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export function abortado(ctx: ContextoVarredura): boolean {
  return ctx.abort?.aborted === true;
}

/** Caminho relativo seguro (sem `..`), com separador `/`. */
export function relativoA(base: string, abs: string): string | null {
  const r = relative(base, abs);
  if (r === "" || r.startsWith("..") || isAbsolute(r)) return null;
  return r.split(sep).join("/");
}

/** Está `alvo` dentro de `raiz` (ou é ela)? Ambos já resolvidos. */
export function dentroDe(raiz: string, alvo: string): boolean {
  const r = relative(raiz, alvo);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

export interface EntradaDir {
  nome: string;
  /** caminho absoluto (como listado, sem resolver symlink) */
  abs: string;
  ehDir: boolean;
  ehArquivo: boolean;
  ehSymlink: boolean;
  /** se symlink: alvo resolvido, ou null se quebrado */
  alvo: string | null;
  /** se symlink e o alvo sai das raízes conhecidas */
  foraDasRaizes: boolean;
}

/** Raízes conhecidas: a casa e a raiz de cada workspace (já resolvidas por `realpath` quando possível). */
export async function raizesConhecidas(ctx: ContextoVarredura): Promise<string[]> {
  const brutas = [ctx.home, ...ctx.workspaces.map((w) => w.raiz)];
  const out: string[] = [];
  for (const r of brutas) {
    out.push(resolve(r));
    try {
      out.push(await realpath(r));
    } catch {
      /* raiz ausente */
    }
  }
  return [...new Set(out)];
}

/** Lista uma pasta (≤ 2 000 entradas). Pasta ausente = lista vazia (não é erro). Symlink é resolvido com a regra de raízes. */
export async function listarPasta(ctx: ContextoVarredura, dir: string, raizes: readonly string[]): Promise<EntradaDir[]> {
  let nomes: string[];
  try {
    nomes = (await readdir(dir)).sort().slice(0, LIMITES.entradasPorRaiz);
  } catch {
    return [];
  }
  const saida: EntradaDir[] = [];
  for (const nome of nomes) {
    if (abortado(ctx)) break;
    const abs = join(dir, nome);
    let l;
    try {
      l = await lstat(abs);
    } catch {
      continue;
    }
    if (!l.isSymbolicLink()) {
      saida.push({ nome, abs, ehDir: l.isDirectory(), ehArquivo: l.isFile(), ehSymlink: false, alvo: abs, foraDasRaizes: false });
      continue;
    }
    let alvo: string | null = null;
    try {
      alvo = await realpath(abs);
    } catch {
      alvo = null;
    }
    if (alvo === null) {
      saida.push({ nome, abs, ehDir: false, ehArquivo: false, ehSymlink: true, alvo: null, foraDasRaizes: false });
      continue;
    }
    const fora = !raizes.some((r) => dentroDe(r, alvo as string));
    if (fora) {
      saida.push({ nome, abs, ehDir: false, ehArquivo: false, ehSymlink: true, alvo, foraDasRaizes: true });
      continue;
    }
    let s;
    try {
      s = await stat(alvo);
    } catch {
      saida.push({ nome, abs, ehDir: false, ehArquivo: false, ehSymlink: true, alvo: null, foraDasRaizes: false });
      continue;
    }
    saida.push({ nome, abs, ehDir: s.isDirectory(), ehArquivo: s.isFile(), ehSymlink: true, alvo, foraDasRaizes: false });
  }
  return saida;
}

export async function destinoDoLink(abs: string): Promise<string | null> {
  try {
    return await readlink(abs);
  } catch {
    return null;
  }
}
