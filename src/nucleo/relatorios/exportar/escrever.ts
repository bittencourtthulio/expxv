// Escrita da exportação: NUNCA sobrescreve (cria `nome`, `nome-2`, … com a flag exclusiva `wx`), cria subpasta própria para "pasta" e gera o ZIP "store". Quem decide o
// destino é `destino.ts`; aqui só se grava. Cada nome de arquivo do pacote é conferido (sem `..`, sem barra inicial).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { invalido } from "../erros";
import { nomeDePacoteValido } from "../seguranca";
import { criarZip } from "../formatos/zip";

export interface ArquivoExportar { nome: string; conteudo: string }
export interface FsExportar { mkdir: typeof mkdir; writeFile: typeof writeFile }
const fsReal: FsExportar = { mkdir, writeFile };

async function criarUnico<T>(tentar: (n: number) => Promise<T>): Promise<T> {
  for (let n = 1; n <= 200; n++) {
    try { return await tentar(n); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  throw invalido("não foi possível escolher um nome livre no destino");
}
const comSufixo = (base: string, n: number, ext = ""): string => (n === 1 ? `${base}${ext}` : `${base}-${n}${ext}`);

export async function exportarPasta(destino: string, nomePasta: string, arquivos: readonly ArquivoExportar[], fs: FsExportar = fsReal): Promise<{ nome: string; bytes: number }> {
  for (const a of arquivos) if (!nomeDePacoteValido(a.nome) && a.nome !== "manifesto.json") throw invalido("nome de arquivo inválido");
  const pasta = await criarUnico(async (n) => { const p = join(destino, comSufixo(nomePasta, n)); await fs.mkdir(p); return p; });
  let bytes = 0;
  for (const a of arquivos) {
    const p = join(pasta, ...a.nome.split("/"));
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, a.conteudo, { encoding: "utf8", flag: "wx" });
    bytes += Buffer.byteLength(a.conteudo, "utf8");
  }
  return { nome: pasta.slice(destino.length + 1), bytes };
}

export async function exportarZip(destino: string, nomeZip: string, arquivos: readonly ArquivoExportar[], quando: Date, fs: FsExportar = fsReal): Promise<{ nome: string; bytes: number }> {
  for (const a of arquivos) if (!nomeDePacoteValido(a.nome) && a.nome !== "manifesto.json") throw invalido("nome de arquivo inválido");
  const dados = criarZip(arquivos.map((a) => ({ nome: `${nomeZip}/${a.nome}`, dados: new TextEncoder().encode(a.conteudo) })), quando);
  return criarUnico(async (n) => {
    const nome = comSufixo(nomeZip, n, ".zip");
    await fs.writeFile(join(destino, nome), dados, { flag: "wx" });
    return { nome, bytes: dados.length };
  });
}
