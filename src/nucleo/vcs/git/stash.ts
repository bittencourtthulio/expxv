import { GitErro, NomeInvalidoErro } from "../../git/erros";
import type { Diff } from "../vcs";
import { parseDiff } from "./diff";
import { caminhoSeguro, escrita, rodarGit, type OpcoesBase } from "./comum";

// T-06.11 · Stash. Só a operação (a confirmação de apagar é da UI). Pop com conflito NUNCA apaga o stash
// (o git já mantém a entrada; aqui conferimos e informamos). Apagar devolve o hash para `restaurarStashApagado`.

export interface Stash {
  indice: number;
  ref: string;
  hash: string;
  mensagem: string;
  /** Branch onde foi criado (do texto do reflog). */
  ramo: string | null;
  /** ISO 8601. */
  data: string;
}

const refDe = (indice: number): string => {
  if (!Number.isInteger(indice) || indice < 0) throw new NomeInvalidoErro(String(indice));
  return `stash@{${indice}}`;
};

export async function listarStashes(raiz: string, op: OpcoesBase = {}): Promise<Stash[]> {
  const r = await rodarGit(raiz, ["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%aI%x1e"], op);
  const lista: Stash[] = [];
  for (const reg of r.stdout.split("\x1e")) {
    const [gd, hash, gs, data] = reg.replace(/^\n/, "").split("\x1f");
    if (gd === undefined || hash === undefined) continue;
    const m = /^stash@\{(\d+)\}$/.exec(gd);
    if (!m) continue;
    lista.push({ indice: Number(m[1]), ref: gd, hash, mensagem: gs ?? "", ramo: /^(?:WIP on|On) ([^:]+):/.exec(gs ?? "")?.[1] ?? null, data: data ?? "" });
  }
  return lista;
}

export interface OpcoesCriarStash extends OpcoesBase {
  mensagem?: string;
  naoRastreados?: boolean;
  /** Só estes caminhos (relativos, literais). */
  caminhos?: readonly string[];
  /** Mantém o que já está no índice (`--keep-index`). */
  manterIndice?: boolean;
}

export async function criarStash(raiz: string, opcoes: OpcoesCriarStash = {}): Promise<{ criado: boolean; ref: string | null; hash: string | null }> {
  const { mensagem, naoRastreados, caminhos, manterIndice, ...op } = opcoes;
  if (mensagem !== undefined && (mensagem.includes("\0") || mensagem.length > 500)) throw new NomeInvalidoErro(mensagem.slice(0, 40));
  const antes = (await listarStashes(raiz, op))[0]?.hash ?? null;
  const args = ["stash", "push", ...(naoRastreados ? ["--include-untracked"] : []), ...(manterIndice ? ["--keep-index"] : []), ...(mensagem ? ["-m", mensagem] : [])];
  if (caminhos && caminhos.length > 0) args.push("--", ...caminhos.map((c) => `:(literal)${caminhoSeguro(c)}`)); // GIT_LITERAL_PATHSPECS quebraria o --include-untracked
  await escrita(raiz, args, op);
  const topo = (await listarStashes(raiz, op))[0]?.hash ?? null;
  if (topo === null || topo === antes) return { criado: false, ref: null, hash: null };
  return { criado: true, ref: "stash@{0}", hash: topo };
}

async function existe(raiz: string, indice: number, op: OpcoesBase): Promise<Stash> {
  const lista = await listarStashes(raiz, op);
  const s = lista.find((x) => x.indice === indice);
  if (!s) throw new GitErro(`Stash inexistente: ${refDe(indice)}`);
  return s;
}

export interface ResultadoAplicar {
  aplicado: boolean;
  conflito: boolean;
  /** Arquivos em conflito (quando `conflito`). */
  arquivos: string[];
  /** O stash continua na lista (sempre true em apply; em pop só some se aplicou sem conflito). */
  stashMantido: boolean;
  /** Saída do git quando falhou sem ser conflito (ex.: mudanças locais seriam sobrescritas). */
  motivo?: string;
}

async function aplicarOuPop(raiz: string, indice: number, modo: "apply" | "pop", restaurarIndice: boolean, op: OpcoesBase): Promise<ResultadoAplicar> {
  const alvo = await existe(raiz, indice, op);
  const r = await escrita(raiz, ["stash", modo, ...(restaurarIndice ? ["--index"] : []), alvo.ref], { ...op, tolerar: [1] });
  if (r.codigo === 0) return { aplicado: true, conflito: false, arquivos: [], stashMantido: modo === "apply" };
  const saida = `${r.stdout}\n${r.stderr}`;
  const u = await rodarGit(raiz, ["diff", "--name-only", "--diff-filter=U", "-z"], op);
  const arquivos = u.stdout.split("\0").filter((x) => x !== "");
  const conflito = arquivos.length > 0 || /CONFLICT|Merge conflict/.test(saida);
  const mantido = (await listarStashes(raiz, op)).some((s) => s.hash === alvo.hash);
  return { aplicado: false, conflito, arquivos, stashMantido: mantido, ...(conflito ? {} : { motivo: saida.trim().slice(0, 2000) }) };
}

export const aplicarStash = (raiz: string, indice: number, opcoes: OpcoesBase & { restaurarIndice?: boolean } = {}): Promise<ResultadoAplicar> => {
  const { restaurarIndice = false, ...op } = opcoes;
  return aplicarOuPop(raiz, indice, "apply", restaurarIndice, op);
};

/** `stash pop`: com conflito (ou qualquer falha) o stash é MANTIDO. */
export const popStash = (raiz: string, indice = 0, opcoes: OpcoesBase & { restaurarIndice?: boolean } = {}): Promise<ResultadoAplicar> => {
  const { restaurarIndice = false, ...op } = opcoes;
  return aplicarOuPop(raiz, indice, "pop", restaurarIndice, op);
};

/** Apaga a entrada. Devolve hash e mensagem para `restaurarStashApagado` (o objeto ainda está no repositório até o gc). */
export async function apagarStash(raiz: string, indice: number, op: OpcoesBase = {}): Promise<{ hash: string; mensagem: string }> {
  const alvo = await existe(raiz, indice, op);
  await escrita(raiz, ["stash", "drop", alvo.ref], op);
  return { hash: alvo.hash, mensagem: alvo.mensagem };
}

export async function restaurarStashApagado(raiz: string, hash: string, mensagem: string, op: OpcoesBase = {}): Promise<void> {
  if (!/^[0-9a-f]{40,64}$/.test(hash)) throw new NomeInvalidoErro(hash);
  await escrita(raiz, ["stash", "store", "-m", mensagem === "" ? "restaurado" : mensagem, hash], op);
}

/** Diff do stash (inclui os não rastreados, se houver). */
export async function diffStash(raiz: string, indice: number, op: OpcoesBase = {}): Promise<Diff> {
  const alvo = await existe(raiz, indice, op);
  const r = await rodarGit(raiz, ["stash", "show", "-p", "--include-untracked", "--no-color", "--no-ext-diff", "--no-textconv", alvo.ref], { ...op, maxBytes: 8 * 1024 * 1024 });
  const d = parseDiff(r.stdout, { truncado: r.truncado });
  d.grande = r.truncado;
  return d;
}
