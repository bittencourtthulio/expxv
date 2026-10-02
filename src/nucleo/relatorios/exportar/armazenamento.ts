// Armazenamento do pacote em `<raiz do workspace>/<pasta do produto>/relatorios/<sprint>/r<N>/` (D-04: o ADE NUNCA escreve em `docs/**` do método). Escrita ATÔMICA
// (pasta temporária + rename; arquivo temporário + rename), `rN` imutável (nunca sobrescreve), referências sempre RELATIVAS e travadas por regex; a pasta-base não pode ser
// symlink (evitaria escapar da raiz). `fs` é injetado: testes usam diretório temporário e um `fs` espionado.
import { mkdir, readFile, rename, rm, stat, writeFile, lstat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PRODUTO } from "../../produto";
import { invalido, naoEncontrado, regraViolada } from "../erros";
import { nomeDePacoteValido } from "../seguranca";

export const REF_BASE = `${PRODUTO.pastaNoProjeto}/relatorios`;
export const refPacote = (sprintId: string, versao: number): string => `${REF_BASE}/${sprintId}/r${versao}`;
const RE_REF = new RegExp(`^${PRODUTO.pastaNoProjeto.replace(/\./g, "\\.")}/relatorios/[A-Za-z0-9_-]{1,64}/r[1-9][0-9]{0,5}$`);
/** referência de pasta de pacote válida: só `<pasta do produto>/relatorios/<sprint>/r<N>`, sem `..`, sem barra inicial, sem unidade de disco. */
export const refDePacoteValida = (ref: string): boolean => RE_REF.test(ref);

export interface FsRelatorios {
  mkdir: typeof mkdir; readFile: typeof readFile; rename: typeof rename; rm: typeof rm; stat: typeof stat; writeFile: typeof writeFile; lstat: typeof lstat;
}
export const fsReal: FsRelatorios = { mkdir, readFile, rename, rm, stat, writeFile, lstat };

export interface ArquivoGravar { nome: string; conteudo: string }
export interface Armazenamento {
  gravarPacote(workspaceId: string, ref: string, arquivos: readonly ArquivoGravar[]): Promise<void>;
  substituirArquivos(workspaceId: string, ref: string, arquivos: readonly ArquivoGravar[]): Promise<void>;
  ler(workspaceId: string, ref: string, nome: string): Promise<string | null>;
  existe(workspaceId: string, ref: string): Promise<boolean>;
}

export function criarArmazenamento(d: { raizDe: (workspaceId: string) => string | null; fs?: FsRelatorios }): Armazenamento {
  const fs = d.fs ?? fsReal;
  const raiz = (ws: string): string => {
    const r = d.raizDe(ws);
    if (r === null || r === "") throw naoEncontrado("workspace não encontrado");
    return resolve(r);
  };
  /** garante `<raiz>/<pasta>/relatorios` e recusa symlink em qualquer trecho. */
  async function base(ws: string): Promise<string> {
    const r = raiz(ws);
    let atual = r;
    for (const parte of REF_BASE.split("/")) {
      atual = join(atual, parte);
      try {
        const st = await fs.lstat(atual);
        if (st.isSymbolicLink() || !st.isDirectory()) throw regraViolada("a pasta de relatórios do projeto não pode ser um atalho");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") await fs.mkdir(atual);
        else throw e;
      }
    }
    return atual;
  }
  const abs = async (ws: string, ref: string): Promise<string> => {
    if (!refDePacoteValida(ref)) throw invalido("referência de pacote inválida");
    const b = await base(ws);
    const alvo = resolve(raiz(ws), ref);
    if (relative(b, alvo).startsWith("..") || !alvo.startsWith(b + sep)) throw regraViolada("destino fora da pasta de relatórios");
    return alvo;
  };
  const nomesOk = (arquivos: readonly ArquivoGravar[]): void => { for (const a of arquivos) if (!nomeDePacoteValido(a.nome) && a.nome !== "manifesto.json") throw invalido("nome de arquivo inválido"); };

  return {
    async gravarPacote(ws, ref, arquivos) {
      nomesOk(arquivos);
      const alvo = await abs(ws, ref);
      try { await fs.stat(alvo); throw regraViolada("esta versão do pacote já existe e é imutável"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      await fs.mkdir(dirname(alvo), { recursive: true });
      const tmp = `${alvo}.tmp-${process.pid}-${Date.now().toString(36)}`;
      try {
        for (const a of arquivos) {
          const p = join(tmp, ...a.nome.split("/"));
          await fs.mkdir(dirname(p), { recursive: true });
          await fs.writeFile(p, a.conteudo, { encoding: "utf8", flag: "wx" });
        }
        await fs.rename(tmp, alvo);
      } catch (e) {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        throw e;
      }
    },
    async substituirArquivos(ws, ref, arquivos) {
      nomesOk(arquivos);
      const alvo = await abs(ws, ref);
      for (const a of arquivos) {
        const p = join(alvo, ...a.nome.split("/"));
        const tmp = `${p}.tmp-${process.pid}-${Date.now().toString(36)}`;
        try {
          await fs.writeFile(tmp, a.conteudo, { encoding: "utf8", flag: "wx" });
          await fs.rename(tmp, p);
        } catch (e) {
          await fs.rm(tmp, { force: true }).catch(() => undefined);
          throw e;
        }
      }
    },
    async ler(ws, ref, nome) {
      if (!nomeDePacoteValido(nome) && nome !== "manifesto.json") throw invalido("nome de arquivo inválido");
      const alvo = await abs(ws, ref);
      // arquivo do pacote é SEMPRE arquivo comum: atalho (symlink) no arquivo ou na subpasta é recusado (um repositório hostil não faz o app ler outro arquivo)
      let atual = alvo;
      try {
        for (const [i, parte] of nome.split("/").entries()) {
          atual = join(atual, parte);
          const st = await fs.lstat(atual);
          const ultimo = i === nome.split("/").length - 1;
          if (st.isSymbolicLink() || (ultimo ? !st.isFile() : !st.isDirectory())) throw regraViolada("arquivo do pacote inválido");
        }
        return await fs.readFile(atual, "utf8");
      } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    },
    async existe(ws, ref) {
      try { await fs.stat(await abs(ws, ref)); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
    },
  };
}
