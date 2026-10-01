/**
 * Pasta do produto dentro do repositório do usuário (05-CONTRATOS §5): criada sob demanda, com
 * `.gitignore` interno `*`. Nada daqui escreve fora dela. Caminhos de entrada são validados contra
 * `..` e links simbólicos que escapam da raiz.
 */
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PRODUTO } from "../produto";

export const pastaDoProduto = (raiz: string): string => join(raiz, PRODUTO.pastaNoProjeto);

export function caminhoBriefing(mission_id: string, task_ref: string): string {
  return join(PRODUTO.pastaNoProjeto, "missoes", mission_id, `briefing-${task_ref}.md`);
}

export function caminhoRelatorio(mission_id: string, task_ref: string): string {
  return join(PRODUTO.pastaNoProjeto, "missoes", mission_id, "relatorios", `${task_ref}.md`);
}

/** Identificadores que entram em nomes de arquivo: sem separadores, sem `..`. */
export const ID_DE_ARQUIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Resolve `caminho` (relativo ou absoluto) e devolve o absoluto só se ficar dentro de `base`. */
export function resolverDentro(base: string, caminho: string): string | null {
  if (caminho.includes("\0")) return null;
  const absoluto = resolve(base, caminho);
  const rel = relative(resolve(base), absoluto);
  if (rel === "" ) return absoluto;
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return absoluto;
}

/** Como `resolverDentro`, mas também segue links simbólicos de um caminho existente. */
export async function resolverDentroReal(base: string, caminho: string): Promise<string | null> {
  const absoluto = resolverDentro(base, caminho);
  if (absoluto === null) return null;
  try {
    const [real, raizReal] = await Promise.all([realpath(absoluto), realpath(base)]);
    const rel = relative(raizReal, real);
    return rel.startsWith("..") || isAbsolute(rel) ? null : real;
  } catch {
    return null;
  }
}

/** `absoluto` está dentro da pasta do produto de `raiz`? */
export function dentroDaPastaDoProduto(raiz: string, absoluto: string): boolean {
  const pasta = resolve(pastaDoProduto(raiz));
  const alvo = resolve(absoluto);
  return alvo === pasta || alvo.startsWith(pasta + sep);
}

export async function garantirPastaDoProduto(raiz: string): Promise<void> {
  const pasta = pastaDoProduto(raiz);
  await mkdir(pasta, { recursive: true });
  try {
    await writeFile(join(pasta, ".gitignore"), "*\n", { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

/** Grava texto dentro da pasta do produto (cria pastas e o .gitignore). `rel` é relativo à raiz e precisa ficar na pasta do produto. */
export async function gravarNaPastaDoProduto(raiz: string, rel: string, conteudo: string): Promise<string> {
  const absoluto = resolverDentro(raiz, rel);
  if (absoluto === null || !dentroDaPastaDoProduto(raiz, absoluto)) throw new Error("Caminho fora da pasta do produto.");
  await garantirPastaDoProduto(raiz);
  await mkdir(dirname(absoluto), { recursive: true });
  await writeFile(absoluto, conteudo, "utf8");
  return absoluto;
}
