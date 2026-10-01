import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { GitErro, NomeInvalidoErro } from "../../git/erros";
import { caminhoSeguro, escrita, type OpcoesBase } from "./comum";
import { OperacaoRecusadaErro } from "./guardas";
import { entradasNaoMescladas } from "./merge";

// T-06.13 · Conflitos: parser de marcadores (merge e diff3/zdiff3 com base), modelo por hunk, resolução por hunk
// (nossa/deles/base/ambas/editar), marcar resolvido (`git add` do arquivo) e conflitos que não são de texto
// (modo, binário, adição dupla, exclusão x modificação) com erro nominal e opções.
// Linhas são mantidas COM o fim de linha original (CRLF/LF), então resolver nunca altera o resto do arquivo.
// Atenção: em rebase o git inverte os lados ("nossa" = a base sobre a qual se reaplica); os rótulos dos marcadores dizem quem é quem.

export type Resolucao = "nossa" | "deles" | "base" | "ambas" | { editar: string };

export interface HunkConflito {
  id: number;
  /** 1-based: linha do marcador de abertura no arquivo. */
  linha: number;
  rotuloNossa: string;
  rotuloDeles: string;
  rotuloBase: string | null;
  nossa: string;
  deles: string;
  /** null no estilo `merge` (sem diff3). */
  base: string | null;
}

export type ParteConflito = { tipo: "texto"; texto: string } | { tipo: "conflito"; hunk: HunkConflito };

export interface ArquivoConflito {
  partes: ParteConflito[];
  hunks: HunkConflito[];
  estilo: "merge" | "diff3";
}

export class ResolucaoInvalidaErro extends GitErro {
  override name = "ResolucaoInvalidaErro";
}
export class ConflitoPendenteErro extends GitErro {
  override name = "ConflitoPendenteErro";
  constructor(readonly caminho: string, readonly restantes: number) {
    super(`${caminho} ainda tem ${restantes} conflito(s) sem resolver.`);
  }
}
/** O conflito não é de texto: o modelo por hunk não se aplica. */
export class ConflitoNaoTextualErro extends GitErro {
  override name = "ConflitoNaoTextualErro";
  constructor(readonly caminho: string, readonly tipo: TipoConflito, readonly opcoes: OpcaoArquivo[]) {
    super(`Conflito de tipo "${tipo}" em ${caminho}: escolha ${opcoes.join(" / ")} para o arquivo inteiro.`);
  }
}

const linhasComFim = (t: string): string[] => t.match(/[^\n]*\n|[^\n]+/g) ?? [];
const semFim = (l: string): string => l.replace(/\r?\n$/, "");

/** Interpreta marcadores. Tolerante: hunk sem fechamento volta como texto puro (nada se perde). */
export function parseConflitos(texto: string): ArquivoConflito {
  const linhas = linhasComFim(texto);
  const partes: ParteConflito[] = [];
  const hunks: HunkConflito[] = [];
  let estilo: ArquivoConflito["estilo"] = "merge";
  let buf: string[] = [];
  const despejar = (): void => {
    if (buf.length > 0) {
      partes.push({ tipo: "texto", texto: buf.join("") });
      buf = [];
    }
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i] as string;
    const ab = /^(<{7,})(?: (.*))?$/.exec(semFim(l));
    if (!ab) {
      buf.push(l);
      continue;
    }
    const n = (ab[1] as string).length;
    const re = (c: string): RegExp => new RegExp(`^${c}{${n}}(?: (.*))?$`);
    const reBase = re("\\|");
    const reMeio = new RegExp(`^={${n}}$`);
    const reFim = re(">");
    let fase: "nossa" | "base" | "deles" = "nossa";
    const nossa: string[] = [];
    const base: string[] = [];
    const deles: string[] = [];
    let rotBase: string | null = null;
    let rotDeles = "";
    let fechou = -1;
    for (let j = i + 1; j < linhas.length; j++) {
      const lj = linhas[j] as string;
      const s = semFim(lj);
      if (fase === "nossa" && reBase.test(s)) {
        fase = "base";
        rotBase = reBase.exec(s)?.[1] ?? "";
        continue;
      }
      if (fase !== "deles" && reMeio.test(s)) {
        fase = "deles";
        continue;
      }
      if (fase === "deles" && reFim.test(s)) {
        rotDeles = reFim.exec(s)?.[1] ?? "";
        fechou = j;
        break;
      }
      (fase === "nossa" ? nossa : fase === "base" ? base : deles).push(lj);
    }
    if (fechou < 0 || (fase as string) !== "deles") {
      buf.push(l); // sem fechamento: trata a linha como texto e segue
      continue;
    }
    despejar();
    const temBase = rotBase !== null;
    if (temBase) estilo = "diff3";
    const hunk: HunkConflito = { id: hunks.length, linha: i + 1, rotuloNossa: ab[2] ?? "", rotuloDeles: rotDeles, rotuloBase: rotBase, nossa: nossa.join(""), deles: deles.join(""), base: temBase ? base.join("") : null };
    hunks.push(hunk);
    partes.push({ tipo: "conflito", hunk });
    i = fechou;
  }
  despejar();
  return { partes, hunks, estilo };
}

const fim = (t: string, eol: string): string => (t === "" || t.endsWith("\n") ? t : t + eol);

/** Aplica resoluções por id; hunks sem resolução mantêm os marcadores originais. */
export function aplicarResolucoes(arq: ArquivoConflito, resolucoes: Readonly<Record<number, Resolucao>>, eol = "\n"): { texto: string; restantes: number } {
  let restantes = 0;
  const saida: string[] = [];
  for (const p of arq.partes) {
    if (p.tipo === "texto") {
      saida.push(p.texto);
      continue;
    }
    const h = p.hunk;
    const r = resolucoes[h.id];
    if (r === undefined) {
      restantes++;
      saida.push(`<<<<<<< ${h.rotuloNossa}${eol}${h.nossa}`);
      if (h.base !== null) saida.push(`||||||| ${h.rotuloBase ?? ""}${eol}${h.base}`);
      saida.push(`=======${eol}${h.deles}>>>>>>> ${h.rotuloDeles}${eol}`);
      continue;
    }
    if (r === "nossa") saida.push(h.nossa);
    else if (r === "deles") saida.push(h.deles);
    else if (r === "ambas") saida.push(fim(h.nossa, eol) + h.deles);
    else if (r === "base") {
      if (h.base === null) throw new ResolucaoInvalidaErro(`O hunk ${h.id} não tem versão base (conflito sem diff3).`);
      saida.push(h.base);
    } else if (typeof r === "object" && r !== null && typeof r.editar === "string") saida.push(r.editar);
    else throw new ResolucaoInvalidaErro(`Resolução inválida para o hunk ${h.id}.`);
  }
  return { texto: saida.join(""), restantes };
}

// ---- arquivos -----------------------------------------------------------------------------------------

async function caminhoNaRaiz(raiz: string, caminho: string): Promise<string> {
  const rel = caminhoSeguro(caminho);
  const abs = join(raiz, rel);
  const info = await lstat(abs).catch(() => null);
  if (info === null) throw new GitErro(`Arquivo inexistente: ${rel}`);
  if (info.isSymbolicLink()) throw new NomeInvalidoErro(caminho);
  const real = await realpath(abs);
  const base = await realpath(raiz);
  if (real !== base && !real.startsWith(base + sep)) throw new NomeInvalidoErro(caminho);
  return abs;
}

function lerUtf8(buf: Buffer): string | null {
  if (buf.subarray(0, 8000).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

export type TipoConflito = "texto" | "binario" | "modo" | "adicao-dupla" | "exclusao-modificacao";
export type OpcaoArquivo = "nossa" | "deles" | "remover";

export interface InfoConflito {
  caminho: string;
  tipo: TipoConflito;
  /** Quem apagou/adicionou, para exclusão x modificação e adições. */
  lado?: "nos-apagamos" | "eles-apagaram" | "adicionado-por-nos" | "adicionado-por-eles" | "ambos-adicionaram";
  /** Escolhas válidas para o ARQUIVO inteiro (texto aceita também resolução por hunk). */
  opcoes: OpcaoArquivo[];
  hunks: number;
}

/** Classifica o conflito de um caminho pelos estágios do índice (1 base, 2 nossa, 3 deles). */
export async function classificarConflito(raiz: string, caminho: string, op: OpcoesBase = {}): Promise<InfoConflito> {
  const rel = caminhoSeguro(caminho);
  const e = (await entradasNaoMescladas(raiz, op)).filter((x) => x.caminho === rel);
  if (e.length === 0) throw new GitErro(`${rel} não está em conflito.`);
  const s = (n: number) => e.find((x) => x.estagio === n);
  const [b, n2, t3] = [s(1), s(2), s(3)];
  if (b && n2 && !t3) return { caminho: rel, tipo: "exclusao-modificacao", lado: "eles-apagaram", opcoes: ["nossa", "remover"], hunks: 0 };
  if (b && t3 && !n2) return { caminho: rel, tipo: "exclusao-modificacao", lado: "nos-apagamos", opcoes: ["deles", "remover"], hunks: 0 };
  if (n2 && !t3 && !b) return { caminho: rel, tipo: "exclusao-modificacao", lado: "adicionado-por-nos", opcoes: ["nossa", "remover"], hunks: 0 };
  if (t3 && !n2 && !b) return { caminho: rel, tipo: "exclusao-modificacao", lado: "adicionado-por-eles", opcoes: ["deles", "remover"], hunks: 0 };
  if (n2 && t3 && n2.modo !== t3.modo) return { caminho: rel, tipo: "modo", opcoes: ["nossa", "deles"], hunks: 0 };
  const buf = await readFile(await caminhoNaRaiz(raiz, rel)).catch(() => null);
  const texto = buf === null ? null : lerUtf8(buf);
  if (texto === null) return { caminho: rel, tipo: "binario", opcoes: ["nossa", "deles"], hunks: 0 };
  const hunks = parseConflitos(texto).hunks.length;
  return { caminho: rel, tipo: !b ? "adicao-dupla" : "texto", ...(!b ? { lado: "ambos-adicionaram" as const } : {}), opcoes: ["nossa", "deles"], hunks };
}

export async function listarConflitos(raiz: string, op: OpcoesBase = {}): Promise<InfoConflito[]> {
  const nomes = [...new Set((await entradasNaoMescladas(raiz, op)).map((x) => x.caminho))];
  const out: InfoConflito[] = [];
  for (const c of nomes) out.push(await classificarConflito(raiz, c, op));
  return out;
}

/** Modelo por hunk de um arquivo em conflito de texto. Outros tipos: ConflitoNaoTextualErro com as opções. */
export async function lerConflitos(raiz: string, caminho: string, op: OpcoesBase = {}): Promise<ArquivoConflito & { info: InfoConflito; eol: "lf" | "crlf" }> {
  const info = await classificarConflito(raiz, caminho, op);
  if (info.tipo === "binario" || info.tipo === "modo" || info.tipo === "exclusao-modificacao") throw new ConflitoNaoTextualErro(info.caminho, info.tipo, info.opcoes);
  const texto = lerUtf8(await readFile(await caminhoNaRaiz(raiz, info.caminho))) ?? "";
  return { ...parseConflitos(texto), info, eol: texto.includes("\r\n") ? "crlf" : "lf" };
}

/**
 * Resolve hunks do arquivo (grava só o que foi resolvido). Com todos resolvidos e `marcar` (padrão), faz `git add`.
 * Hunks não citados continuam com marcadores.
 */
export async function resolverHunks(raiz: string, caminho: string, resolucoes: Readonly<Record<number, Resolucao>>, opcoes: OpcoesBase & { marcar?: boolean } = {}): Promise<{ restantes: number; marcado: boolean }> {
  const { marcar = true, ...op } = opcoes;
  const m = await lerConflitos(raiz, caminho, op);
  for (const k of Object.keys(resolucoes)) if (!m.hunks.some((h) => String(h.id) === k)) throw new ResolucaoInvalidaErro(`Hunk inexistente: ${k}`);
  const { texto, restantes } = aplicarResolucoes(m, resolucoes, m.eol === "crlf" ? "\r\n" : "\n");
  await writeFile(await caminhoNaRaiz(raiz, m.info.caminho), texto);
  if (restantes === 0 && marcar) {
    await escrita(raiz, ["add", "--", m.info.caminho], op);
    return { restantes: 0, marcado: true };
  }
  return { restantes, marcado: false };
}

/** Marca o arquivo como resolvido (`git add`); recusa se ainda houver marcadores de conflito. */
export async function marcarResolvido(raiz: string, caminho: string, op: OpcoesBase = {}): Promise<void> {
  const rel = caminhoSeguro(caminho);
  const abs = await caminhoNaRaiz(raiz, rel);
  const texto = lerUtf8(await readFile(abs));
  if (texto !== null) {
    const n = parseConflitos(texto).hunks.length;
    if (n > 0) throw new ConflitoPendenteErro(rel, n);
  }
  await escrita(raiz, ["add", "--", rel], op);
}

/** Resolve o arquivo inteiro: nossa, deles ou remover (modo/binário/exclusão x modificação/adição dupla). */
export async function resolverArquivo(raiz: string, caminho: string, escolha: OpcaoArquivo, op: OpcoesBase = {}): Promise<void> {
  const info = await classificarConflito(raiz, caminho, op);
  if (!info.opcoes.includes(escolha) && !(info.tipo === "texto" || info.tipo === "adicao-dupla")) {
    throw new OperacaoRecusadaErro(`Escolha inválida para este conflito (${info.tipo}): ${info.opcoes.join(" / ")}.`, "confirmacao-invalida", info.opcoes);
  }
  if (escolha === "remover") {
    await escrita(raiz, ["rm", "-q", "--", info.caminho], op);
    return;
  }
  await escrita(raiz, ["checkout", escolha === "nossa" ? "--ours" : "--theirs", "--", info.caminho], op);
  await escrita(raiz, ["add", "--", info.caminho], op);
}
