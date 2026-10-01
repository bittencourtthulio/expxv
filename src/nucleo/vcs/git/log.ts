import { GitErro } from "../../git/erros";
import type { Commit, Diff } from "../vcs";
import { caminhoSeguro, resolverRev, rodarGit, type OpcoesBase } from "./comum";
import { ParserDiff } from "./diff";

// T-06.10 · Histórico, grafo (pistas/lanes), busca, detalhe do commit e blame.
// Saída do git sempre com separadores de controle (0x1e entre registros, NUL entre campos): mensagens com
// quebras de linha, aspas ou qualquer texto nunca confundem o parser. Texto de busca/autor/caminho nunca
// vira opção (`--grep=<x>` é um argumento só; caminhos vão depois de `--`; revisões validadas).

export class CursorObsoletoErro extends GitErro {
  override name = "CursorObsoletoErro";
  constructor() {
    super("O histórico mudou desde a última página; recomece do topo.");
  }
}

export interface CommitLog extends Commit {
  /** Decorações (`HEAD -> main`, `origin/main`, `tag: v1`). */
  refs: string[];
}

/** Uma linha do grafo. Colunas são índices de pista (0 = esquerda). */
export interface LinhaGrafo {
  hash: string;
  /** Pista em que o commit é desenhado. */
  coluna: number;
  /** Pistas que chegam de cima e terminam neste commit (inclui `coluna` quando há filhos; vazio em ponta de ramo). */
  entra: number[];
  /** Pistas que só atravessam a linha (continuam abaixo). */
  passa: number[];
  /** Para cada pai (mesma ordem de `pais`), a pista pela qual a linha desce. Pais iguais compartilham pista. */
  saidas: number[];
  /** Quantidade de pistas ocupadas depois desta linha (largura mínima do desenho). */
  largura: number;
}

export interface CursorLog {
  /** Último commit da página anterior. */
  hash: string;
  /** Posição dele (0-based) na listagem. */
  indice: number;
  /** Estado das pistas depois dele (hash esperado em cada coluna). */
  pistas: Array<string | null>;
}

export interface OpcoesLog extends OpcoesBase {
  /** Padrão 200 (máx. 5000). */
  limite?: number;
  cursor?: CursorLog;
  /** Revisão inicial (padrão HEAD). */
  rev?: string;
  /** Todas as refs (`--all`). */
  todos?: boolean;
  /** Texto na mensagem (`--grep`, literal e sem diferenciar maiúsculas; `regex: true` aceita expressão). */
  busca?: string;
  regex?: boolean;
  autor?: string;
  /** Limita a commits que tocam o caminho. */
  caminho?: string;
  /** `-S` (muda a contagem da string) ou `-G` (muda linhas que casam a regex). */
  pickaxe?: { tipo: "S" | "G"; texto: string };
  /** Ordenação topológica estrita (mais lenta em históricos enormes). Padrão: ordem cronológica do git (rápida). */
  topologica?: boolean;
}

export interface PaginaLog {
  commits: CommitLog[];
  /** null quando há filtro (busca/autor/caminho/pickaxe): o grafo só faz sentido no histórico inteiro. */
  grafo: LinhaGrafo[] | null;
  /** null na última página. */
  proximo: CursorLog | null;
  duracaoMs: number;
}

const RS = "\x1e";
export const FORMATO_LOG = `--format=${RS}%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s`;
const LIMITE_MAX = 5000;

export function parseLog(saida: string): CommitLog[] {
  const out: CommitLog[] = [];
  for (const reg of saida.split(RS)) {
    if (reg === "") continue;
    const c = reg.split("\0");
    if (c.length < 7 || !/^[0-9a-f]{40,64}$/.test(c[0] as string)) continue;
    const hash = c[0] as string;
    out.push({
      hash,
      hashCurto: hash.slice(0, 7),
      pais: (c[1] as string).split(" ").filter((x) => x !== ""),
      autor: c[2] as string,
      email: c[3] as string,
      data: c[4] as string,
      refs: (c[5] as string).split(", ").map((x) => x.trim()).filter((x) => x !== ""),
      assunto: (c.slice(6).join("\0")).replace(/\n$/, ""),
    });
  }
  return out;
}

/**
 * Algoritmo de pistas. Entrada: commits na ordem do log (filhos antes dos pais) e o estado das pistas.
 * Cada pista guarda o hash que ela espera encontrar abaixo. Merge octopus: cada pai ganha a sua pista
 * (ou se junta à pista que já o espera). Tolerante a ordem imperfeita: pai que apareceu antes do filho vira pista nova.
 */
export function calcularPistas(commits: ReadonlyArray<{ hash: string; pais: readonly string[] }>, inicial: ReadonlyArray<string | null> = []): { linhas: LinhaGrafo[]; pistas: Array<string | null> } {
  const slots: Array<string | null> = [...inicial];
  const livre = (): number => {
    const i = slots.indexOf(null);
    if (i >= 0) return i;
    slots.push(null);
    return slots.length - 1;
  };
  const linhas: LinhaGrafo[] = [];
  for (const c of commits) {
    const entra: number[] = [];
    slots.forEach((h, i) => {
      if (h === c.hash) entra.push(i);
    });
    const coluna = entra.length > 0 ? (entra[0] as number) : livre();
    for (const i of entra) slots[i] = null;
    const passa: number[] = [];
    slots.forEach((h, i) => {
      if (h !== null) passa.push(i);
    });
    const saidas: number[] = [];
    c.pais.forEach((p, k) => {
      const j = slots.indexOf(p);
      if (j >= 0) {
        saidas.push(j);
        return;
      }
      const alvo = k === 0 ? coluna : livre();
      slots[alvo] = p;
      saidas.push(alvo);
    });
    while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
    linhas.push({ hash: c.hash, coluna, entra, passa, saidas, largura: Math.max(slots.length, coluna + 1) });
  }
  return { linhas, pistas: slots };
}

const textoBusca = (s: string, nome: string): string => {
  if (typeof s !== "string" || s === "" || s.length > 500 || s.includes("\0")) throw new GitErro(`${nome} inválido para o histórico.`);
  return s;
};

function filtrosLog(op: OpcoesLog): string[] {
  const f: string[] = [];
  if (op.busca !== undefined) f.push(`--grep=${textoBusca(op.busca, "Texto de busca")}`, "-i", ...(op.regex === true ? ["-E"] : ["-F"]));
  if (op.autor !== undefined) f.push(`--author=${textoBusca(op.autor, "Autor")}`);
  if (op.pickaxe !== undefined) {
    if (op.pickaxe.tipo !== "S" && op.pickaxe.tipo !== "G") throw new GitErro("Tipo de pickaxe inválido.");
    f.push(`-${op.pickaxe.tipo}${textoBusca(op.pickaxe.texto, "Texto do pickaxe")}`);
  }
  return f;
}

/** Página do histórico. Sem commits (repositório novo) devolve página vazia. */
export async function logGit(raiz: string, op: OpcoesLog = {}): Promise<PaginaLog> {
  const inicio = performance.now();
  const { executor, executavel, signal } = op;
  const base: OpcoesBase = { ...(executor ? { executor } : {}), ...(executavel ? { executavel } : {}), ...(signal ? { signal } : {}) };
  const limite = Math.min(LIMITE_MAX, Math.max(1, Math.floor(op.limite ?? 200)));
  const filtros = filtrosLog(op);
  const caminho = op.caminho === undefined ? undefined : caminhoSeguro(op.caminho);
  const comFiltro = filtros.length > 0 || caminho !== undefined;
  const alvo = op.todos === true ? ["--all"] : [op.rev === undefined ? "HEAD" : await resolverRev(raiz, op.rev, base)];
  const pular = op.cursor === undefined ? 0 : Math.max(0, Math.floor(op.cursor.indice));
  const args = [
    "log", "--no-color", "--no-ext-diff", FORMATO_LOG,
    ...(op.topologica === true ? ["--topo-order"] : []),
    `-n${limite + 1 + (op.cursor !== undefined ? 1 : 0)}`,
    ...(pular > 0 ? [`--skip=${pular}`] : []),
    ...filtros, ...alvo, "--", ...(caminho === undefined ? [] : [caminho]),
  ];
  const r = await rodarGit(raiz, args, { ...base, tolerar: [128], maxBytes: 64 * 1024 * 1024 });
  let lista = r.codigo === 0 ? parseLog(r.stdout) : [];
  if (op.cursor !== undefined) {
    // o cursor é o ÚLTIMO commit exibido (posição `indice`): a listagem recomeça nele e ele é descartado.
    if (lista[0]?.hash !== op.cursor.hash) throw new CursorObsoletoErro();
    lista = lista.slice(1);
  }
  const temMais = lista.length > limite;
  const commits = lista.slice(0, limite);
  let grafo: LinhaGrafo[] | null = null;
  let proximo: CursorLog | null = null;
  const indiceBase = op.cursor === undefined ? 0 : op.cursor.indice + 1;
  if (!comFiltro) {
    const g = calcularPistas(commits, op.cursor?.pistas ?? []);
    grafo = g.linhas;
    if (temMais && commits.length > 0) proximo = { hash: (commits[commits.length - 1] as CommitLog).hash, indice: indiceBase + commits.length - 1, pistas: g.pistas };
  } else if (temMais && commits.length > 0) {
    proximo = { hash: (commits[commits.length - 1] as CommitLog).hash, indice: indiceBase + commits.length - 1, pistas: [] };
  }
  return { commits, grafo, proximo, duracaoMs: performance.now() - inicio };
}

/** Histórico de UM arquivo seguindo renomeações (`--follow`). */
export async function historicoArquivo(raiz: string, caminho: string, op: OpcoesBase & { limite?: number } = {}): Promise<CommitLog[]> {
  const c = caminhoSeguro(caminho);
  const limite = Math.min(LIMITE_MAX, Math.max(1, Math.floor(op.limite ?? 200)));
  const { limite: _l, ...base } = op;
  void _l;
  const r = await rodarGit(raiz, ["log", "--no-color", "--no-ext-diff", "--follow", FORMATO_LOG, `-n${limite}`, "--", c], { ...base, tolerar: [128] });
  return r.codigo === 0 ? parseLog(r.stdout) : [];
}

// ---- detalhe do commit -----------------------------------------------------------------------

export interface DetalheCommit extends CommitLog {
  corpo: string;
  commiter: string;
  /** Totais e diff completo (arquivos com hunks) pelo parser da 6A. Merge: contra o primeiro pai. */
  diff: Diff;
  insercoes: number;
  delecoes: number;
}

export async function detalheCommit(raiz: string, rev: string, op: OpcoesBase & { limiteBytes?: number } = {}): Promise<DetalheCommit> {
  const { limiteBytes = 4 * 1024 * 1024, ...base } = op;
  const hash = await resolverRev(raiz, rev, base);
  const m = await rodarGit(raiz, ["show", "-s", "--no-color", `--format=${RS}%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%cn%x00%B`, hash], base);
  const reg = m.stdout.split(RS)[1] ?? "";
  const c = reg.split("\0");
  if (c.length < 9) throw new GitErro(`Não foi possível ler o commit ${rev}.`);
  const pais = (c[1] as string).split(" ").filter((x) => x !== "");
  const parser = new ParserDiff();
  const args = ["diff-tree", "-p", "-M", "--no-commit-id", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", "-U3", ...(pais.length === 0 ? ["--root", hash] : [pais[0] as string, hash])];
  const r = await rodarGit(raiz, args, { ...base, maxBytes: limiteBytes, aoStdout: (b) => parser.escrever(b), tolerar: [128] });
  const diff = parser.finalizar(r.truncado);
  diff.grande = r.truncado;
  const corpo = (c.slice(8).join("\0")).replace(/\n+$/, "");
  return {
    hash, hashCurto: hash.slice(0, 7), pais, autor: c[2] as string, email: c[3] as string, data: c[4] as string,
    refs: (c[5] as string).split(", ").map((x) => x.trim()).filter((x) => x !== ""),
    assunto: c[6] as string, commiter: c[7] as string, corpo,
    diff, insercoes: diff.arquivos.reduce((a, f) => a + f.insercoes, 0), delecoes: diff.arquivos.reduce((a, f) => a + f.delecoes, 0),
  };
}

// ---- blame -------------------------------------------------------------------------------------

export interface LinhaBlame {
  /** Número da linha no arquivo atual (1-based). */
  linha: number;
  /** Número da linha no commit de origem. */
  linhaOriginal: number;
  hash: string;
  autor: string;
  email: string;
  /** ISO 8601. */
  data: string;
  resumo: string;
  /** Primeiro commit do histórico (a linha vem "de antes"). */
  limite: boolean;
  /** Arquivo no commit de origem (renomeações). */
  arquivo: string;
  conteudo: string;
}

/** `blame --porcelain`: cabeçalho `<hash> <orig> <final> [n]`, metadados só na 1ª ocorrência do commit, linha de conteúdo com TAB. */
export function parseBlamePorcelain(saida: string): LinhaBlame[] {
  const meta = new Map<string, { autor: string; email: string; data: string; resumo: string; limite: boolean; arquivo: string }>();
  const out: LinhaBlame[] = [];
  let atual: { hash: string; orig: number; final: number } | null = null;
  for (const l of saida.split("\n")) {
    if (atual === null) {
      const m = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(l);
      if (m) {
        atual = { hash: m[1] as string, orig: Number(m[2]), final: Number(m[3]) };
        if (!meta.has(atual.hash)) meta.set(atual.hash, { autor: "", email: "", data: "", resumo: "", limite: false, arquivo: "" });
      }
      continue;
    }
    const mt = meta.get(atual.hash) as { autor: string; email: string; data: string; resumo: string; limite: boolean; arquivo: string };
    if (l.startsWith("\t")) {
      out.push({ linha: atual.final, linhaOriginal: atual.orig, hash: atual.hash, autor: mt.autor, email: mt.email, data: mt.data, resumo: mt.resumo, limite: mt.limite, arquivo: mt.arquivo, conteudo: l.slice(1) });
      atual = null;
    } else if (l.startsWith("author ")) mt.autor = l.slice(7);
    else if (l.startsWith("author-mail ")) mt.email = l.slice(12).replace(/^<|>$/g, "");
    else if (l.startsWith("author-time ")) mt.data = new Date(Number(l.slice(12)) * 1000).toISOString();
    else if (l.startsWith("summary ")) mt.resumo = l.slice(8);
    else if (l === "boundary") mt.limite = true;
    else if (l.startsWith("filename ")) mt.arquivo = l.slice(9);
  }
  return out;
}

/** Blame de um arquivo (ignora espaços: `-w`). `rev` opcional (padrão HEAD). */
export async function blameGit(raiz: string, caminho: string, op: OpcoesBase & { rev?: string } = {}): Promise<LinhaBlame[]> {
  const c = caminhoSeguro(caminho);
  const { rev, ...base } = op;
  const alvo = rev === undefined ? [] : [await resolverRev(raiz, rev, base)];
  const r = await rodarGit(raiz, ["blame", "--porcelain", "-w", ...alvo, "--", c], { ...base, maxBytes: 64 * 1024 * 1024 });
  return parseBlamePorcelain(r.stdout);
}
