import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { executarGit, type OpcoesGit } from "./git";
import { ArvoreSujaErro, NomeInvalidoErro, SufixoEsgotadoErro, WorktreeInvalidoErro } from "./erros";
import { slugificar } from "./slug";
import { exigirArvoreLimpa, ramoExiste, raizDoRepo, statusResumo, validarNomeBranch } from "./status";

type Op = Omit<OpcoesGit, "cwd">;

export interface Worktree {
  caminho: string;
  head: string | null;
  /** Nome curto (sem refs/heads/); null se destacado ou bare. */
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  /** A primeira entrada do `worktree list` é sempre a árvore principal. */
  principal: boolean;
}

/** Interpreta a saída de `git worktree list --porcelain` (blocos separados por linha em branco). */
export function parseWorktreeList(saida: string): Worktree[] {
  const lista: Worktree[] = [];
  for (const bloco of saida.split(/\r?\n\r?\n/)) {
    const linhas = bloco.split(/\r?\n/).filter((l) => l !== "");
    if (linhas.length === 0) continue;
    const w: Worktree = { caminho: "", head: null, branch: null, bare: false, detached: false, locked: false, prunable: false, principal: lista.length === 0 };
    for (const l of linhas) {
      const [chave, ...resto] = l.split(" ");
      const valor = resto.join(" ");
      if (chave === "worktree") w.caminho = valor;
      else if (chave === "HEAD") w.head = valor;
      else if (chave === "branch") w.branch = valor.replace(/^refs\/heads\//, "");
      else if (chave === "bare") w.bare = true;
      else if (chave === "detached") w.detached = true;
      else if (chave === "locked") w.locked = true;
      else if (chave === "prunable") w.prunable = true;
    }
    if (w.caminho !== "") lista.push(w);
  }
  return lista;
}

export async function worktreeList(repo: string, op: Op = {}): Promise<Worktree[]> {
  const r = await executarGit(["worktree", "list", "--porcelain"], { ...op, cwd: repo });
  return parseWorktreeList(r.stdout);
}

async function real(p: string): Promise<string> {
  return realpath(p).catch(() => resolve(p));
}

export interface OpcoesWorktreeAdd extends Op {
  repo: string;
  /** Nome da branch nova (criada com `-b`). Em colisão, recebe sufixo numérico (`-2`, `-3`…). */
  branch: string;
  /** Padrão: `../<repo>--<slug da branch>` ao lado da raiz. Relativo é resolvido a partir da raiz. */
  caminho?: string;
  /** Ponto de partida da branch. Padrão: HEAD. */
  base?: string;
  /** Erro nominal (ArvoreSujaErro) se a árvore do repo tiver alterações. Padrão false. */
  exigirArvoreLimpa?: boolean;
}

export interface ResultadoWorktreeAdd {
  caminho: string;
  branch: string;
  slug: string;
  /** Sufixo numérico aplicado por colisão (1 = nenhum). */
  tentativa: number;
}

/**
 * Cria um worktree com branch nova (`git worktree add -b`). Colisão de branch ou de pasta avança o
 * sufixo numérico das duas juntas. Com `caminho` explícito, pasta ocupada é erro (não se adivinha).
 */
export async function worktreeAdd(opcoes: OpcoesWorktreeAdd): Promise<ResultadoWorktreeAdd> {
  const { repo, branch, caminho, base, exigirArvoreLimpa: limpa, ...op } = opcoes;
  if (base !== undefined && (base === "" || base.startsWith("-") || /\s/.test(base))) throw new NomeInvalidoErro(base);
  const raiz = await raizDoRepo(repo, op);
  if (limpa) await exigirArvoreLimpa(raiz, op);
  await validarNomeBranch(raiz, branch, op);

  const slug = slugificar(branch);
  const padrao = join(dirname(raiz), `${basename(raiz)}--${slug}`);
  const explicito = caminho === undefined ? undefined : isAbsolute(caminho) ? caminho : resolve(raiz, caminho);

  for (let n = 1; n <= 200; n++) {
    const sufixo = n === 1 ? "" : `-${n}`;
    const ramo = branch + sufixo;
    const pasta = explicito ?? padrao + sufixo;
    const ramoOcupado = await ramoExiste(raiz, ramo, op);
    const pastaOcupada = existsSync(pasta);
    if (explicito !== undefined && pastaOcupada) throw new WorktreeInvalidoErro(`O caminho já existe: ${pasta}`);
    if (ramoOcupado || pastaOcupada) {
      continue;
    }
    await executarGit(["worktree", "add", "-b", ramo, pasta, ...(base ? [base] : [])], { ...op, cwd: raiz });
    return { caminho: await real(pasta), branch: ramo, slug: slug + sufixo, tentativa: n };
  }
  throw new SufixoEsgotadoErro(branch);
}

export interface OpcoesWorktreeRemove extends Op {
  repo: string;
  caminho: string;
  /** Também apaga a branch, mas só se já estiver integrada (`branch -d`, nunca `-D`). Padrão false. */
  apagarBranch?: boolean;
}

/**
 * Remove um worktree secundário. Recusa a árvore principal e árvore com alterações
 * (ArvoreSujaErro): nunca usa --force. Única operação destrutiva do serviço, só por chamada explícita.
 */
export async function worktreeRemove(opcoes: OpcoesWorktreeRemove): Promise<{ branch_apagada: boolean }> {
  const { repo, caminho, apagarBranch, ...op } = opcoes;
  const raiz = await raizDoRepo(repo, op);
  const alvo = await real(isAbsolute(caminho) ? caminho : resolve(raiz, caminho));
  const lista = await worktreeList(raiz, op);
  let achado: Worktree | undefined;
  for (const w of lista) if ((await real(w.caminho)) === alvo) achado = w;
  if (!achado) throw new WorktreeInvalidoErro(`Não é um worktree deste repositório: ${alvo}`);
  if (achado.principal) throw new WorktreeInvalidoErro("A árvore principal não pode ser removida.");
  if (existsSync(achado.caminho) && (await statusResumo(achado.caminho, op)).sujo) throw new ArvoreSujaErro(achado.caminho);
  await executarGit(["worktree", "remove", achado.caminho], { ...op, cwd: raiz });
  let apagada = false;
  if (apagarBranch && achado.branch) {
    const r = await executarGit(["branch", "-d", achado.branch], { ...op, cwd: raiz, tolerar: [1] });
    apagada = r.codigo === 0;
  }
  return { branch_apagada: apagada };
}
