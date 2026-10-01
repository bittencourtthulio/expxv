import { open } from "node:fs/promises";
import { join } from "node:path";
import { caminhoSeguro, rodarGit, type OpcoesBase } from "./comum";
import { listarSubmodulos } from "./submodulos";

// T-06.15 · Recursos especiais: LFS (por ponteiro, sem baixar objetos), sparse-checkout e clones parciais (`--filter`).
// Só LEITURA e sempre degradando com aviso: nada aqui baixa, inicializa ou altera config. Leituras não buscam objetos
// faltantes na rede (GIT_NO_LAZY_FETCH, imposto pelo executor).

export interface PonteiroLfs {
  oid: string;
  tamanho: number;
}

/** Interpreta o texto de um ponteiro LFS (`version … / oid sha256:… / size N`). null se não for ponteiro. */
export function parsePonteiroLfs(texto: string): PonteiroLfs | null {
  if (!/^version https:\/\/git-lfs\.github\.com\/spec\/v\d+\r?\n/.test(texto)) return null;
  const oid = /^oid sha256:([0-9a-f]{64})\r?$/m.exec(texto)?.[1];
  const tam = /^size (\d+)\r?$/m.exec(texto)?.[1];
  return oid === undefined || tam === undefined ? null : { oid, tamanho: Number(tam) };
}

/** Lê o arquivo da árvore de trabalho (no máximo 1 KiB) e diz se é um ponteiro LFS ainda não baixado. */
export async function lerPonteiroLfs(raiz: string, caminho: string): Promise<PonteiroLfs | null> {
  const rel = caminhoSeguro(caminho);
  const fh = await open(join(raiz, rel), "r").catch(() => null);
  if (fh === null) return null;
  try {
    const buf = Buffer.alloc(1024);
    const { bytesRead } = await fh.read(buf, 0, 1024, 0);
    return parsePonteiroLfs(buf.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await fh.close();
  }
}

/** O caminho está sob `filter=lfs` (gitattributes)? */
export async function ehArquivoLfs(raiz: string, caminho: string, op: OpcoesBase = {}): Promise<boolean> {
  const r = await rodarGit(raiz, ["check-attr", "filter", "--", caminhoSeguro(caminho)], { ...op, tolerar: [128] });
  return /: filter: lfs\s*$/m.test(r.stdout);
}

export interface Especiais {
  lfs: { configurado: boolean; padroes: string[]; instalado: boolean };
  sparse: { ativo: boolean; cone: boolean; padroes: string[] };
  parcial: { ativo: boolean; remoto: string | null; filtro: string | null };
  submodulos: number;
  /** Mensagens curtas (pt-BR) do que está degradado e por quê. */
  avisos: string[];
}

export async function detectarEspeciais(raiz: string, op: OpcoesBase = {}): Promise<Especiais> {
  const cfg = async (chave: string): Promise<string | null> => {
    const r = await rodarGit(raiz, ["config", "--get", chave], { ...op, tolerar: [1] });
    return r.codigo === 0 ? r.stdout.trim() : null;
  };
  const grep = await rodarGit(raiz, ["grep", "-h", "-I", "--no-index", "-e", "filter=lfs", "--", ".gitattributes"], { ...op, tolerar: [1, 128] });
  const padroes = grep.codigo === 0 ? grep.stdout.split("\n").map((l) => l.trim().split(/\s+/)[0] ?? "").filter((x) => x !== "" && !x.startsWith("#")) : [];
  const [processo, filtroCfg, sparse, cone, ext] = await Promise.all([cfg("filter.lfs.process"), cfg("filter.lfs.clean"), cfg("core.sparseCheckout"), cfg("core.sparseCheckoutCone"), cfg("extensions.partialclone")]);
  // clone parcial moderno: `remote.<nome>.promisor` / `remote.<nome>.partialclonefilter`; antigo: `extensions.partialclone`
  const pr = await rodarGit(raiz, ["config", "-z", "--get-regexp", "^remote\\..+\\.(promisor|partialclonefilter)$"], { ...op, tolerar: [1] });
  let parcialRemoto: string | null = ext;
  let filtro: string | null = null;
  for (const reg of pr.stdout.split("\0")) {
    const nl = reg.indexOf("\n");
    const m = /^remote\.(.+)\.(promisor|partialclonefilter)$/.exec(nl < 0 ? "" : reg.slice(0, nl));
    if (!m) continue;
    if (m[2] === "partialclonefilter") filtro = reg.slice(nl + 1);
    if (m[2] === "partialclonefilter" || reg.slice(nl + 1) === "true") parcialRemoto = parcialRemoto ?? (m[1] as string);
  }
  const sparseAtivo = sparse === "true";
  let padroesSparse: string[] = [];
  if (sparseAtivo) {
    const l = await rodarGit(raiz, ["sparse-checkout", "list"], { ...op, tolerar: [1, 128] });
    padroesSparse = l.codigo === 0 ? l.stdout.split("\n").map((x) => x.trim()).filter((x) => x !== "") : [];
  }
  const subs = (await listarSubmodulos(raiz, op)).length;
  const lfs = { configurado: padroes.length > 0, padroes, instalado: processo !== null || filtroCfg !== null };
  const avisos: string[] = [];
  if (lfs.configurado && !lfs.instalado) avisos.push("O repositório usa Git LFS, mas o git-lfs não está configurado aqui: arquivos grandes aparecem como ponteiros (nada é baixado).");
  else if (lfs.configurado) avisos.push("O repositório usa Git LFS: o app mostra ponteiros e nunca baixa objetos LFS sozinho.");
  if (sparseAtivo) avisos.push(`Sparse-checkout ativo (${padroesSparse.length} regra(s)): só parte dos arquivos está na pasta; o status respeita isso.`);
  if (parcialRemoto !== null) avisos.push(`Clone parcial${filtro ? ` (${filtro})` : ""}: conteúdo ausente não é buscado na rede por leituras automáticas; diff/blame de arquivos não baixados ficam incompletos.`);
  if (subs > 0) avisos.push(`${subs} submódulo(s): aparecem como ponteiro; inicializar usa a rede e pede confirmação.`);
  return { lfs, sparse: { ativo: sparseAtivo, cone: cone === "true", padroes: padroesSparse }, parcial: { ativo: parcialRemoto !== null, remoto: parcialRemoto, filtro }, submodulos: subs, avisos };
}
