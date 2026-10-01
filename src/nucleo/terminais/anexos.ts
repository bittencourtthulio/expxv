import { copyFile, lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { ItemAnexo, ResultadoAnexos } from "../../compartilhado/terminais";
import { PRODUTO } from "../produto";

export type { ItemAnexo, ResultadoAnexos };

/** Colar ou arrastar arquivo no terminal da CLI: o arquivo vai para o disco e o caminho vira texto do prompt. */
export const LIMITES_ANEXOS = {
  itens: 10,
  bytes: 25 * 1_024 * 1_024,
  nome_max: 80,
} as const;

/** Allowlist de dev: imagens, documentos, dados, código comum, logs, patches e pacotes. Nunca arquivo de ambiente, chaves nem executáveis. */
export const EXTENSOES_ANEXO: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".pdf",
  ".txt", ".md", ".json", ".csv", ".log", ".patch", ".diff", ".zip",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp",
  ".css", ".html", ".yml", ".yaml", ".toml", ".sh",
]);

/** Pasta (relativa à raiz do workspace) onde ficam os arquivos colados e os copiados de fora da raiz. */
export const PASTA_ANEXOS = join(PRODUTO.pastaNoProjeto, "entradas");

/** Nomes que começam assim guardam segredo de ambiente: nunca anexar, em nenhuma forma. */
const PREFIXO_PROIBIDO = ".en" + "v";
const CONTROLE = /[\u0000-\u001f\u007f]/;

export function sanitizarNome(bruto: string): string {
  const base = bruto.split(/[\\/]/).pop() ?? "";
  const limpo = base.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^[.\s]+/, "").trim();
  if (limpo === "") return "arquivo";
  const ext = extname(limpo);
  const corpo = limpo.slice(0, limpo.length - ext.length).slice(0, Math.max(1, LIMITES_ANEXOS.nome_max - ext.length));
  return `${corpo}${ext}`;
}

/** Caminho como o shell e as CLIs o leem: sem aspas quando é seguro, senão entre aspas simples. Nunca quebra linha. */
export function formatarCaminhoParaPrompt(caminho: string): string {
  if (CONTROLE.test(caminho)) throw new Error("Nome de arquivo com caractere de controle.");
  return /^[A-Za-z0-9_./@%+=:,-]+$/.test(caminho) ? caminho : `'${caminho.replaceAll("'", "'\\''")}'`;
}

function conferirTipo(nome: string): void {
  const base = (nome.split(/[\\/]/).pop() ?? "").toLowerCase();
  const ext = extname(base);
  if (base.startsWith(PREFIXO_PROIBIDO) || !EXTENSOES_ANEXO.has(ext)) {
    throw new Error(`Tipo de arquivo não aceito${ext === "" ? "" : ` (${ext})`}.`);
  }
}

function estaDentro(raiz: string, alvo: string): boolean {
  const r = relative(raiz, alvo);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
}

async function destinoLivre(pasta: string, nome: string): Promise<string> {
  for (let n = 0; n < 1_000; n++) {
    const ext = extname(nome);
    const candidato = join(pasta, n === 0 ? nome : `${nome.slice(0, nome.length - ext.length)}-${n}${ext}`);
    try { await stat(candidato); } catch { return candidato; }
  }
  throw new Error("Não foi possível escolher um nome para o arquivo.");
}

/** Cria a pasta do produto dentro do workspace com `.gitignore` interno `*` (nada do que o app grava vai para o git). */
async function prepararPasta(raizReal: string, sessaoId: string): Promise<string> {
  const pasta = join(raizReal, PASTA_ANEXOS, sessaoId.replace(/[^A-Za-z0-9_-]/g, "_"));
  await mkdir(pasta, { recursive: true });
  await writeFile(join(raizReal, PRODUTO.pastaNoProjeto, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);
  return pasta;
}

type Plano =
  | { tipo: "usar"; relativo: string }
  | { tipo: "copiar"; origem: string; nome: string }
  | { tipo: "gravar"; nome: string; bytes: Uint8Array };

/**
 * Prepara os anexos de uma sessão e devolve caminhos RELATIVOS à raiz, já formatados para o shell, sem Enter.
 * Tudo é validado antes de gravar qualquer coisa.
 */
export async function prepararAnexos(raiz: string, sessaoId: string, itens: readonly ItemAnexo[], agora: number = Date.now()): Promise<ResultadoAnexos> {
  if (itens.length === 0 || itens.length > LIMITES_ANEXOS.itens) throw new Error(`Anexe de 1 a ${LIMITES_ANEXOS.itens} arquivos por vez.`);
  const raizReal = await realpath(raiz);
  const planos: Plano[] = [];
  for (const item of itens) {
    if ("caminho" in item) {
      if (!isAbsolute(item.caminho) || CONTROLE.test(item.caminho)) throw new Error("Caminho de arquivo inválido.");
      const real = await realpath(item.caminho).catch(() => { throw new Error("Arquivo não encontrado."); });
      const info = await stat(real);
      if (!info.isFile()) throw new Error("Só arquivo regular pode ser anexado (pasta, dispositivo e afins não).");
      conferirTipo(item.caminho); // pelo nome dado; um atalho com nome inocente não esconde o destino
      conferirTipo(real);
      const lexico = resolve(item.caminho);
      const ligacao = await lstat(lexico);
      const realDentro = estaDentro(raizReal, real);
      const lexicoDentro = estaDentro(raizReal, lexico) || estaDentro(resolve(raiz), lexico);
      if ((ligacao.isSymbolicLink() || lexicoDentro) && !realDentro) throw new Error("Atalho (symlink) aponta para fora do workspace: recusado.");
      if (realDentro) { planos.push({ tipo: "usar", relativo: relative(raizReal, real) }); continue; }
      if (info.size > LIMITES_ANEXOS.bytes) throw new Error("Arquivo grande demais (máximo de 25 MB fora do workspace).");
      planos.push({ tipo: "copiar", origem: real, nome: sanitizarNome(basename(real)) });
    } else {
      conferirTipo(item.nome);
      if (item.bytes.byteLength === 0) throw new Error("Arquivo vazio.");
      if (item.bytes.byteLength > LIMITES_ANEXOS.bytes) throw new Error("Arquivo grande demais (máximo de 25 MB).");
      planos.push({ tipo: "gravar", nome: `${agora}-${sanitizarNome(item.nome)}`, bytes: item.bytes });
    }
  }
  const caminhos: string[] = [];
  let pasta: string | null = null;
  for (const plano of planos) {
    if (plano.tipo === "usar") { caminhos.push(plano.relativo); continue; }
    pasta ??= await prepararPasta(raizReal, sessaoId);
    const destino = await destinoLivre(pasta, plano.nome);
    if (plano.tipo === "copiar") await copyFile(plano.origem, destino); else await writeFile(destino, plano.bytes);
    caminhos.push(relative(raizReal, destino));
  }
  return { caminhos, texto: `${caminhos.map(formatarCaminhoParaPrompt).join(" ")} ` };
}
