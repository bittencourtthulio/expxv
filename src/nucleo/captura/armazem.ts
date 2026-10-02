// Armazém de capturas (Fase 11, T-11.17): arquivos na pasta do produto no projeto, subpasta `capturas` (ou `<userData>/capturas` sem workspace). O índice é o próprio diretório (sem tabela: sem migration, sem
// divergência). Caminho SEMPRE relativo e sob a pasta permitida; escrita atômica (temp + rename); o app NUNCA apaga captura sozinho (só `remover`, por ação, para a lixeira).
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { CodigoErroCaptura, FormatoImagem, ItemCaptura, PaginaCapturas } from "../../compartilhado/captura";
import { LIMITES_CAPTURA } from "../../compartilhado/captura";
import { dimensoesJpeg, dimensoesPng, EXTENSAO, PADRAO_ID_IMAGEM, PADRAO_ID_QUADROS, radicalLivre } from "./imagem";

export class ErroCaptura extends Error {
  constructor(readonly codigo: CodigoErroCaptura, mensagem: string) {
    super(mensagem);
    this.name = "ErroCaptura";
  }
}

export interface OpcoesArmazem {
  /** pasta absoluta das capturas. */
  pasta: string;
  /** raiz para os caminhos relativos devolvidos (raiz do workspace ou `<userData>`). */
  raiz: string;
  /** pasta do produto no workspace: recebe um `.gitignore` `*` (nada do que o app grava vai para o git). */
  pastaProduto?: string;
  /** lixeira do sistema (`shell.trashItem`); sem ela `remover` recusa (nunca apaga de vez). */
  lixeira?: (caminhoAbsoluto: string) => Promise<void>;
  agora?: () => Date;
}

export interface Armazem {
  salvarImagem(bytes: Uint8Array, formato: FormatoImagem): Promise<ItemCaptura>;
  salvarEdicao(id: string, png: Uint8Array): Promise<ItemCaptura>;
  listar(depois: string | null, limite?: number): Promise<PaginaCapturas>;
  obter(id: string): Promise<ItemCaptura>;
  ler(id: string): Promise<{ bytes: Uint8Array; formato: FormatoImagem }>;
  caminhoAbsoluto(id: string): Promise<string>;
  iniciarQuadros(fps: number): Promise<{ id: string; pasta: string }>;
  gravarQuadro(id: string, numero: number, png: Uint8Array): Promise<void>;
  /** Fecha a gravação: grava `meta.json`; sem nenhum quadro remove a pasta vazia (nada órfão). */
  finalizarQuadros(id: string, quadros: number, fps: number): Promise<ItemCaptura | null>;
  remover(id: string): Promise<boolean>;
}

const ARQ_IMAGEM = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d{1,3})?)\.(png|jpg)$/;

async function existe(caminho: string): Promise<boolean> {
  try { await lstat(caminho); return true; } catch { return false; }
}

async function escreverAtomico(destino: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${destino}.${randomBytes(5).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, bytes, { flag: "wx", mode: 0o600 });
    await rename(tmp, destino);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new ErroCaptura("disco_sem_escrita", `Não foi possível gravar a captura (${(e as NodeJS.ErrnoException).code ?? "erro de disco"}). Confira a permissão e o espaço da pasta.`);
  }
}

export function criarArmazem(op: OpcoesArmazem): Armazem {
  const pasta = resolve(op.pasta);
  const raiz = resolve(op.raiz);
  const agora = op.agora ?? ((): Date => new Date());
  const pastaQuadros = join(pasta, "quadros");

  const relativoSeguro = (abs: string): string => {
    const r = relative(raiz, abs);
    if (r === "" || r.startsWith("..") || isAbsolute(r)) throw new ErroCaptura("captura_inexistente", "Caminho fora da pasta permitida.");
    return r;
  };

  async function preparar(): Promise<void> {
    try {
      await mkdir(pasta, { recursive: true, mode: 0o700 });
      if (op.pastaProduto !== undefined) await writeFile(join(op.pastaProduto, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);
      await writeFile(join(pasta, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);
    } catch (e) {
      throw new ErroCaptura("disco_sem_escrita", `Não foi possível criar a pasta de capturas (${(e as NodeJS.ErrnoException).code ?? "erro de disco"}).`);
    }
  }

  async function arquivoDaImagem(id: string): Promise<{ abs: string; formato: FormatoImagem; radical: string }> {
    if (!PADRAO_ID_IMAGEM.test(id)) throw new ErroCaptura("captura_inexistente", "Captura inexistente.");
    for (const [ext, formato] of [["png", "png"], ["jpg", "jpeg"]] as const) {
      const abs = join(pasta, `${id}.${ext}`);
      const info = await lstat(abs).catch(() => null);
      if (info === null) continue;
      if (!info.isFile()) throw new ErroCaptura("captura_inexistente", "Captura inválida (atalho ou pasta não é aceito).");
      return { abs, formato, radical: id };
    }
    throw new ErroCaptura("captura_inexistente", "Captura inexistente.");
  }

  async function itemDeImagem(id: string): Promise<ItemCaptura> {
    const { abs, formato } = await arquivoDaImagem(id);
    const info = await stat(abs);
    const cabeca = await lerPrefixo(abs, 65_536);
    const dim = formato === "png" ? dimensoesPng(cabeca) : dimensoesJpeg(cabeca);
    const anotada = (await existe(join(pasta, `${id}.orig.png`))) || (await existe(join(pasta, `${id}.orig.jpg`)));
    return {
      id, tipo: "imagem", formato, caminho: relativoSeguro(abs), bytes: info.size,
      largura: dim?.largura ?? null, altura: dim?.altura ?? null, anotada, fps: null, quadros: null, criado_em: info.birthtime.toISOString(),
    };
  }

  async function itemDeQuadros(id: string): Promise<ItemCaptura> {
    if (!PADRAO_ID_QUADROS.test(id)) throw new ErroCaptura("captura_inexistente", "Captura inexistente.");
    const dir = join(pastaQuadros, id.slice(2));
    const info = await lstat(dir).catch(() => null);
    if (info === null || !info.isDirectory()) throw new ErroCaptura("captura_inexistente", "Captura inexistente.");
    let fps: number | null = null;
    let quadros: number | null = null;
    try {
      const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as { fps?: unknown; quadros?: unknown };
      if (typeof meta.fps === "number") fps = meta.fps;
      if (typeof meta.quadros === "number") quadros = meta.quadros;
    } catch { /* gravação interrompida: sem meta */ }
    if (quadros === null) quadros = (await readdir(dir)).filter((n) => /^frame_\d{4}\.png$/.test(n)).length;
    return { id, tipo: "quadros", formato: null, caminho: relativoSeguro(dir), bytes: 0, largura: null, altura: null, anotada: false, fps, quadros, criado_em: info.birthtime.toISOString() };
  }

  async function obter(id: string): Promise<ItemCaptura> {
    return id.startsWith("q_") ? itemDeQuadros(id) : itemDeImagem(id);
  }

  return {
    obter,

    async salvarImagem(bytes, formato) {
      if (bytes.byteLength === 0) throw new ErroCaptura("indisponivel", "Imagem vazia.");
      await preparar();
      let radical = "";
      const ocupados = new Set<string>();
      for (const n of await readdir(pasta).catch(() => [] as string[])) { const m = ARQ_IMAGEM.exec(n); if (m?.[1] !== undefined) ocupados.add(m[1]); }
      radical = radicalLivre(agora(), (r) => ocupados.has(r));
      await escreverAtomico(join(pasta, `${radical}.${EXTENSAO[formato]}`), bytes);
      return itemDeImagem(radical);
    },

    async salvarEdicao(id, png) {
      if (png.byteLength === 0 || png.byteLength > LIMITES_CAPTURA.edicao_max_bytes) throw new ErroCaptura("indisponivel", "Imagem editada inválida (vazia ou acima de 25 MB).");
      if (dimensoesPng(png) === null) throw new ErroCaptura("indisponivel", "A edição precisa ser um PNG.");
      const atual = await arquivoDaImagem(id);
      const orig = join(pasta, `${id}.orig.${EXTENSAO[atual.formato]}`);
      // o original é preservado na PRIMEIRA edição e nunca mais é tocado
      if (!(await existe(join(pasta, `${id}.orig.png`))) && !(await existe(join(pasta, `${id}.orig.jpg`)))) {
        await copyFile(atual.abs, orig).catch((e: NodeJS.ErrnoException) => { throw new ErroCaptura("disco_sem_escrita", `Não foi possível preservar o original (${e.code ?? "erro de disco"}).`); });
      }
      await escreverAtomico(join(pasta, `${id}.png`), png);
      if (atual.formato === "jpeg") await rm(atual.abs, { force: true }).catch(() => undefined); // o JPEG original segue guardado em .orig.jpg
      return itemDeImagem(id);
    },

    async listar(depois, limite = LIMITES_CAPTURA.pagina) {
      const nomes = await readdir(pasta).catch(() => [] as string[]);
      const ids: string[] = [];
      for (const n of nomes) { const m = ARQ_IMAGEM.exec(n); if (m?.[1] !== undefined) ids.push(m[1]); }
      for (const n of await readdir(pastaQuadros).catch(() => [] as string[])) if (PADRAO_ID_IMAGEM.test(n)) ids.push(`q_${n}`);
      const chave = (id: string): string => (id.startsWith("q_") ? id.slice(2) : id);
      ids.sort((a, b) => (chave(a) === chave(b) ? (a < b ? 1 : -1) : chave(a) < chave(b) ? 1 : -1));
      const unicos = [...new Set(ids)];
      let inicio = 0;
      if (depois !== null) { const i = unicos.indexOf(depois); inicio = i < 0 ? unicos.length : i + 1; }
      const fatia = unicos.slice(inicio, inicio + limite);
      const itens: ItemCaptura[] = [];
      for (const id of fatia) { try { itens.push(await obter(id)); } catch { /* sumiu entre a listagem e a leitura */ } }
      return { itens, proximo: inicio + limite < unicos.length ? (fatia[fatia.length - 1] ?? null) : null };
    },

    async ler(id) {
      if (id.startsWith("q_")) throw new ErroCaptura("captura_inexistente", "Uma gravação de quadros não é uma imagem.");
      const { abs, formato } = await arquivoDaImagem(id);
      return { bytes: new Uint8Array(await readFile(abs)), formato };
    },

    async caminhoAbsoluto(id) {
      if (id.startsWith("q_")) {
        const dir = join(pastaQuadros, id.slice(2));
        await itemDeQuadros(id);
        return dir;
      }
      return (await arquivoDaImagem(id)).abs;
    },

    async iniciarQuadros(fps) {
      await preparar();
      await mkdir(pastaQuadros, { recursive: true, mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { throw new ErroCaptura("disco_sem_escrita", `Não foi possível criar a pasta de quadros (${e.code ?? "erro de disco"}).`); });
      const ocupados = new Set(await readdir(pastaQuadros).catch(() => [] as string[]));
      const radical = radicalLivre(agora(), (r) => ocupados.has(r));
      const dir = join(pastaQuadros, radical);
      await mkdir(dir, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { throw new ErroCaptura("disco_sem_escrita", `Não foi possível criar a pasta de quadros (${e.code ?? "erro de disco"}).`); });
      void fps;
      return { id: `q_${radical}`, pasta: dir };
    },

    async gravarQuadro(id, numero, png) {
      if (!PADRAO_ID_QUADROS.test(id) || !Number.isInteger(numero) || numero < 1 || numero > LIMITES_CAPTURA.quadros_max) throw new ErroCaptura("indisponivel", "Quadro inválido.");
      await escreverAtomico(join(pastaQuadros, id.slice(2), `frame_${String(numero).padStart(4, "0")}.png`), png);
    },

    async finalizarQuadros(id, quadros, fps) {
      if (!PADRAO_ID_QUADROS.test(id)) throw new ErroCaptura("captura_inexistente", "Captura inexistente.");
      const dir = join(pastaQuadros, id.slice(2));
      if (quadros <= 0) { await rm(dir, { recursive: true, force: true }).catch(() => undefined); return null; }
      await escreverAtomico(join(dir, "meta.json"), new TextEncoder().encode(JSON.stringify({ fps, quadros })));
      return itemDeQuadros(id);
    },

    async remover(id) {
      if (op.lixeira === undefined) throw new ErroCaptura("indisponivel", "Sem lixeira do sistema: a captura não será apagada.");
      const abs = await this.caminhoAbsoluto(id);
      await op.lixeira(abs);
      if (!id.startsWith("q_")) {
        for (const ext of ["png", "jpg"]) if (await existe(join(pasta, `${id}.orig.${ext}`))) await op.lixeira(join(pasta, `${id}.orig.${ext}`));
      }
      return true;
    },
  };
}

async function lerPrefixo(abs: string, n: number): Promise<Uint8Array> {
  const { open } = await import("node:fs/promises");
  const f = await open(abs, "r");
  try {
    const buf = new Uint8Array(n);
    const { bytesRead } = await f.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await f.close();
  }
}
