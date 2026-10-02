import type { Commit } from "../vcs";
import { caminhoWc, revisaoSvn, rodarSvn, type OpcoesBaseSvn } from "./comum";
import { documento, filho, filhosDe, textoDe } from "./xml";

// T-06.25: `svn log --xml -v` paginado por `-r`, `svn blame --xml`, e o histórico para churn/hotspots (Fase 17).

export interface CaminhoLog {
  acao: "A" | "M" | "D" | "R";
  tipo: "file" | "dir";
  /** Caminho no REPOSITÓRIO (`/trunk/src/a.ts`). */
  caminho: string;
  copiadoDe?: string;
  copiadoRev?: number;
}

export interface EntradaLog {
  revisao: number;
  autor: string;
  /** ISO 8601. */
  data: string;
  mensagem: string;
  caminhos: CaminhoLog[];
}

export function parseLogXml(xml: string): EntradaLog[] {
  return filhosDe(documento(xml, "log"), "logentry").map((e) => {
    const paths = filho(e, "paths");
    return {
      revisao: Number(e.attrs.revision ?? 0),
      autor: textoDe(e, "author") ?? "",
      data: textoDe(e, "date") ?? "",
      mensagem: textoDe(e, "msg") ?? "",
      caminhos: filhosDe(paths, "path").map((p): CaminhoLog => {
        const c: CaminhoLog = { acao: (["A", "M", "D", "R"].includes(p.attrs.action ?? "") ? p.attrs.action : "M") as CaminhoLog["acao"], tipo: p.attrs.kind === "dir" ? "dir" : "file", caminho: p.texto };
        if (p.attrs["copyfrom-path"] !== undefined) {
          c.copiadoDe = p.attrs["copyfrom-path"];
          if (/^\d+$/.test(p.attrs["copyfrom-rev"] ?? "")) c.copiadoRev = Number(p.attrs["copyfrom-rev"]);
        }
        return c;
      }),
    };
  });
}

/** Revisão como `Commit` comum (hash = número da revisão). */
export function paraCommit(e: EntradaLog): Commit {
  return { hash: String(e.revisao), hashCurto: `r${e.revisao}`, pais: e.revisao > 1 ? [String(e.revisao - 1)] : [], autor: e.autor, email: "", data: e.data, assunto: e.mensagem.split("\n")[0] ?? "" };
}

export interface PaginaLogSvn {
  entradas: EntradaLog[];
  /** Cursor da próxima página (`desde`); null no fim do histórico. */
  proximo: number | null;
}

export interface OpcoesLogSvn extends OpcoesBaseSvn {
  /** Padrão 200 (P-19). */
  limite?: number;
  /** Cursor: revisão onde começar (descendo). Padrão HEAD. */
  desde?: number | "HEAD";
  /** Última revisão a considerar. Padrão 1. */
  ate?: number;
  caminho?: string;
  /** Padrão true (`-v`: caminhos alterados). */
  caminhos?: boolean;
  /** Para na criação do ramo (`--stop-on-copy`). */
  pararNaCopia?: boolean;
}

export async function logSvn(raiz: string, op: OpcoesLogSvn = {}): Promise<PaginaLogSvn> {
  const limite = Math.min(Math.max(1, Math.floor(op.limite ?? 200)), 5000);
  const ate = op.ate ?? 1;
  const flags = ["--xml", ...(op.caminhos === false ? [] : ["-v"]), "-l", String(limite), "-r", `${revisaoSvn(op.desde ?? "HEAD")}:${revisaoSvn(ate)}`, ...(op.pararNaCopia === true ? ["--stop-on-copy"] : [])];
  const r = await rodarSvn(raiz, "log", flags, op.caminho === undefined ? [] : [caminhoWc(op.caminho)], { ...op, timeoutMs: 120_000, maxBytes: 64 * 1024 * 1024 });
  const entradas = parseLogXml(r.stdout);
  return { entradas, proximo: proximoCursor(entradas, limite, ate) };
}

/** Cursor da próxima página: só há mais quando a página veio cheia e ainda há revisões abaixo. */
export function proximoCursor(entradas: readonly EntradaLog[], limite: number, ate = 1): number | null {
  const ultima = entradas[entradas.length - 1];
  return entradas.length >= limite && ultima !== undefined && ultima.revisao - 1 >= ate ? ultima.revisao - 1 : null;
}

// ---- churn / hotspots (função pura sobre o log XML) ----------------------------------------------

export interface ChurnArquivo {
  caminho: string;
  commits: number;
  autores: string[];
  primeira: string;
  ultima: string;
  adicoes: number;
  modificacoes: number;
  remocoes: number;
}

/**
 * Churn por arquivo a partir de entradas do log (`-v`). `prefixo` = caminho do ramo no repositório
 * (ex.: `/trunk`): só conta o que está sob ele e devolve caminhos relativos a ele. Diretórios não contam.
 */
export function churnDeLog(entradas: readonly EntradaLog[], op: { prefixo?: string } = {}): ChurnArquivo[] {
  const pref = op.prefixo === undefined ? "" : `/${op.prefixo.replace(/^\/+|\/+$/g, "")}/`;
  const mapa = new Map<string, ChurnArquivo & { _a: Set<string> }>();
  for (const e of entradas) {
    for (const c of e.caminhos) {
      if (c.tipo === "dir") continue;
      let rel = c.caminho;
      if (pref !== "") {
        if (!rel.startsWith(pref)) continue;
        rel = rel.slice(pref.length);
      } else rel = rel.replace(/^\//, "");
      let x = mapa.get(rel);
      if (!x) {
        x = { caminho: rel, commits: 0, autores: [], primeira: e.data, ultima: e.data, adicoes: 0, modificacoes: 0, remocoes: 0, _a: new Set() };
        mapa.set(rel, x);
      }
      x.commits++;
      x._a.add(e.autor);
      if (e.data < x.primeira) x.primeira = e.data;
      if (e.data > x.ultima) x.ultima = e.data;
      if (c.acao === "A") x.adicoes++;
      else if (c.acao === "D") x.remocoes++;
      else x.modificacoes++;
    }
  }
  return [...mapa.values()]
    .map(({ _a, ...r }) => ({ ...r, autores: [..._a].sort() }))
    .sort((a, b) => b.commits - a.commits || (a.caminho < b.caminho ? -1 : 1));
}

/** Arquivos mais mexidos (hotspots): ordena por commits, depois autores distintos. */
export function hotspotsDeChurn(churn: readonly ChurnArquivo[], op: { topo?: number; minimoCommits?: number } = {}): ChurnArquivo[] {
  return churn
    .filter((c) => c.commits >= (op.minimoCommits ?? 2) && c.remocoes < c.adicoes + 1)
    .sort((a, b) => b.commits - a.commits || b.autores.length - a.autores.length || (a.caminho < b.caminho ? -1 : 1))
    .slice(0, op.topo ?? 20);
}

// ---- blame ---------------------------------------------------------------------------------------

export interface LinhaBlameSvn {
  linha: number;
  revisao: number | null;
  autor: string | null;
  data: string | null;
  /** Com `--use-merge-history`: de onde a linha veio por merge. */
  mesclada?: { revisao: number; autor: string | null; data: string | null; caminho: string };
  texto?: string;
}

export function parseBlameXml(xml: string): LinhaBlameSvn[] {
  const alvo = filhosDe(documento(xml, "blame"), "target")[0];
  return filhosDe(alvo, "entry").map((e) => {
    const c = filho(e, "commit");
    const m = filho(e, "merged");
    const l: LinhaBlameSvn = { linha: Number(e.attrs["line-number"] ?? 0), revisao: c && /^\d+$/.test(c.attrs.revision ?? "") ? Number(c.attrs.revision) : null, autor: textoDe(c, "author"), data: textoDe(c, "date") };
    if (m) {
      const mc = filho(m, "commit");
      l.mesclada = { revisao: Number(mc?.attrs.revision ?? 0), autor: textoDe(mc, "author"), data: textoDe(mc, "date"), caminho: m.attrs.path ?? "" };
    }
    return l;
  });
}

export async function blameSvn(raiz: string, caminho: string, op: OpcoesBaseSvn & { revisao?: number; usarMerge?: boolean; comTexto?: boolean } = {}): Promise<LinhaBlameSvn[]> {
  const cam = caminhoWc(caminho);
  const flags = ["--xml", ...(op.usarMerge === true ? ["-g"] : []), ...(op.revisao !== undefined ? ["-r", `1:${revisaoSvn(op.revisao)}`] : [])];
  const r = await rodarSvn(raiz, "blame", flags, [cam], { ...op, timeoutMs: 60_000, maxBytes: 32 * 1024 * 1024 });
  const linhas = parseBlameXml(r.stdout);
  if (op.comTexto === true) {
    const t = await rodarSvn(raiz, "cat", op.revisao !== undefined ? ["-r", revisaoSvn(op.revisao)] : [], [cam], { ...op, timeoutMs: 60_000, maxBytes: 32 * 1024 * 1024 });
    const partes = t.stdout.split("\n");
    for (const l of linhas) l.texto = (partes[l.linha - 1] ?? "").replace(/\r$/, "");
  }
  return linhas;
}
