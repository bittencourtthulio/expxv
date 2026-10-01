import { statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { executarGit, type OpcoesGit } from "./git";
import { ArvoreSujaErro, GitErro, NaoEhRepoErro, NomeInvalidoErro } from "./erros";

type Op = Omit<OpcoesGit, "cwd">;

export interface StatusResumo {
  /** null em HEAD destacado. */
  branch: string | null;
  sujo: boolean;
  limpo: boolean;
  staged: number;
  modificados: number;
  nao_rastreados: number;
  conflitos: number;
  ahead: number;
  behind: number;
}

export interface DiffItem {
  caminho: string;
  insercoes: number;
  delecoes: number;
}
export interface DiffStat {
  arquivos: number;
  insercoes: number;
  delecoes: number;
  itens: DiffItem[];
}

function diretorioExiste(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** true se `dir` está dentro de uma árvore de trabalho git. Pasta inexistente ou fora de repo: false. */
export async function ehRepo(dir: string, op: Op = {}): Promise<boolean> {
  if (!diretorioExiste(dir)) return false;
  const r = await executarGit(["rev-parse", "--is-inside-work-tree"], { ...op, cwd: dir, tolerar: [128, 1] });
  return r.codigo === 0 && r.stdout.trim() === "true";
}

/** Raiz (caminho real) da árvore de trabalho que contém `dir`. Lança NaoEhRepoErro fora de repo. */
export async function raizDoRepo(dir: string, op: Op = {}): Promise<string> {
  if (!diretorioExiste(dir)) throw new NaoEhRepoErro(dir);
  const r = await executarGit(["rev-parse", "--show-toplevel"], { ...op, cwd: dir, tolerar: [128, 1] });
  const raiz = r.stdout.trim();
  if (r.codigo !== 0 || raiz === "") throw new NaoEhRepoErro(dir);
  return realpath(raiz).catch(() => raiz);
}

/** Branch atual (funciona em repo recém-criado, sem commits). null em HEAD destacado. */
export async function branchAtual(dir: string, op: Op = {}): Promise<string | null> {
  const r = await executarGit(["symbolic-ref", "--short", "-q", "HEAD"], { ...op, cwd: dir, tolerar: [1, 128] });
  if (r.codigo === 0) return r.stdout.trim() || null;
  if (r.codigo === 1) return null; // destacado
  throw new NaoEhRepoErro(dir);
}

/** Contagens do `git status --porcelain` e sujo/limpo. Não lê o conteúdo dos arquivos. */
export async function statusResumo(dir: string, op: Op = {}): Promise<StatusResumo> {
  const r = await executarGit(["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=normal"], { ...op, cwd: dir, tolerar: [128] });
  if (r.codigo !== 0) throw new NaoEhRepoErro(dir);
  const tokens = r.stdout.split("\0");
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let staged = 0;
  let modificados = 0;
  let nao = 0;
  let conflitos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    if (t === "") continue;
    if (t.startsWith("## ")) {
      const corpo = t.slice(3);
      if (corpo.startsWith("HEAD (no branch)")) branch = null;
      else if (corpo.startsWith("No commits yet on ")) branch = corpo.slice("No commits yet on ".length);
      else if (corpo.startsWith("Initial commit on ")) branch = corpo.slice("Initial commit on ".length);
      else branch = (corpo.split("...")[0] as string).split(" ")[0] as string;
      ahead = Number(/ahead (\d+)/.exec(corpo)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(corpo)?.[1] ?? 0);
      continue;
    }
    const x = t[0] as string;
    const y = t[1] as string;
    if (x === "R" || x === "C") i++; // entrada de renomeação traz o caminho de origem à parte
    if (x === "?" && y === "?") nao++;
    else if (x === "!" && y === "!") continue;
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) conflitos++;
    else {
      if (x !== " ") staged++;
      if (y !== " ") modificados++;
    }
  }
  const sujo = staged + modificados + nao + conflitos > 0;
  return { branch, sujo, limpo: !sujo, staged, modificados, nao_rastreados: nao, conflitos, ahead, behind };
}

export async function ramoExiste(dir: string, branch: string, op: Op = {}): Promise<boolean> {
  await validarNomeBranch(dir, branch, op);
  const r = await executarGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { ...op, cwd: dir, tolerar: [1] });
  return r.codigo === 0;
}

export async function validarNomeBranch(dir: string, branch: string, op: Op = {}): Promise<void> {
  if (branch === "" || branch.startsWith("-") || /\s/.test(branch)) throw new NomeInvalidoErro(branch);
  const r = await executarGit(["check-ref-format", `refs/heads/${branch}`], { ...op, cwd: dir, tolerar: [1] });
  if (r.codigo !== 0) throw new NomeInvalidoErro(branch);
}

/** Erro nominal se a árvore de `dir` tem qualquer alteração (inclui não rastreados). */
export async function exigirArvoreLimpa(dir: string, op: Op = {}): Promise<void> {
  const s = await statusResumo(dir, op);
  if (s.sujo) throw new ArvoreSujaErro(dir);
}

/**
 * Estatística de diff. Sem `base`: árvore de trabalho contra HEAD. Com `base`: `base...HEAD`
 * (o que a branch acrescentou desde o ancestral comum).
 */
export async function diffStat(dir: string, opcoes: Op & { base?: string } = {}): Promise<DiffStat> {
  const { base, ...op } = opcoes;
  if (base !== undefined && (base === "" || base.startsWith("-") || /\s/.test(base))) throw new NomeInvalidoErro(base);
  const args = ["diff", "--numstat", "-z", ...(base ? [`${base}...HEAD`] : ["HEAD"])];
  let r = await executarGit(args, { ...op, cwd: dir, tolerar: [128] });
  if (r.codigo !== 0 && !base) r = await executarGit(["diff", "--numstat", "-z"], { ...op, cwd: dir }); // repo sem commits
  else if (r.codigo !== 0) throw new GitErro(`git diff falhou: ${r.stderr.trim()}`, args, r.codigo, r.stderr);
  const tokens = r.stdout.split("\0");
  const itens: DiffItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    if (t === "") continue;
    const [ins, del, ...resto] = t.split("\t");
    let caminho = resto.join("\t");
    if (caminho === "") {
      i += 2; // renomeação: "ins\tdel\t\0origem\0destino\0"
      caminho = (tokens[i] as string | undefined) ?? "";
    }
    itens.push({ caminho, insercoes: ins === "-" ? 0 : Number(ins), delecoes: del === "-" ? 0 : Number(del) });
  }
  return {
    arquivos: itens.length,
    insercoes: itens.reduce((a, b) => a + b.insercoes, 0),
    delecoes: itens.reduce((a, b) => a + b.delecoes, 0),
    itens,
  };
}
