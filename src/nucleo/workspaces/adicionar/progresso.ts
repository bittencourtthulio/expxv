// Parser da saída de `git clone --progress` (e de `gh repo clone -- --progress`) em eventos de progresso (D-602). Puro.
// O git escreve no stderr, separando atualizações por `\r` (mesma linha) e `\n`; um pedaço pode chegar partido no meio.
import type { FaseClone } from "../../../compartilhado/workspaces-adicionar";

export interface EventoProgressoGit {
  fase: FaseClone;
  /** 0–100 da fase (null = fase sem percentual, ex.: "Enumerating objects"). */
  percentual: number | null;
  bytes: number | null;
  velocidade_bps: number | null;
  /** linha limpa (para o anúncio de acessibilidade e para diagnóstico). */
  texto: string;
}

const UNIDADE: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
const UN_MIN: Record<string, number> = Object.fromEntries(Object.entries(UNIDADE).map(([k, v]) => [k.toLowerCase(), v]));
const paraBytes = (n: string, un: string): number => Math.round(Number(n) * (UN_MIN[un.toLowerCase()] ?? 1));
const FASE_POR_ROTULO: Record<string, FaseClone> = {
  "enumerating objects": "contando",
  "counting objects": "contando",
  "compressing objects": "comprimindo",
  "receiving objects": "recebendo",
  "resolving deltas": "resolvendo",
  "updating files": "extraindo",
  "checking out files": "extraindo",
  "filtering content": "extraindo",
};
const RE_PROGRESSO = /^(?:remote:\s*)?(Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files|Checking out files|Filtering content):\s*(?:(\d{1,3})%\s*\((\d+)\/(\d+)\))?(?:[,\s]*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)(?:\s*\|\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)\/s)?)?/i;

/** Uma linha do git → evento (ou null se não for progresso). */
export function parsearLinhaProgresso(linha: string): EventoProgressoGit | null {
  const t = linha.trim();
  if (t === "") return null;
  const m = RE_PROGRESSO.exec(t);
  if (m !== null) {
    const fase = FASE_POR_ROTULO[(m[1] as string).toLowerCase()] ?? "recebendo";
    const pct = m[2] === undefined ? null : Math.min(100, Math.max(0, Number(m[2])));
    const bytes = m[5] !== undefined && m[6] !== undefined ? paraBytes(m[5], m[6]) : null;
    const vel = m[7] !== undefined && m[8] !== undefined ? paraBytes(m[7], m[8]) : null;
    return { fase, percentual: pct, bytes, velocidade_bps: vel, texto: t };
  }
  if (/^Cloning into /i.test(t)) return { fase: "conectando", percentual: null, bytes: null, velocidade_bps: null, texto: "Conectando ao repositório…" };
  if (/^Submodule /i.test(t) || /^Cloning into .*submodule/i.test(t)) return { fase: "submodulos", percentual: null, bytes: null, velocidade_bps: null, texto: "Baixando submódulos…" };
  return null;
}

/** Acumulador com buffer: alimente com cada pedaço do stderr; devolve só os eventos completos (última atualização de cada linha). */
export class ParserProgressoGit {
  private resto = "";
  alimentar(pedaco: string): EventoProgressoGit[] {
    const todo = this.resto + pedaco;
    const partes = todo.split(/[\r\n]+/);
    this.resto = partes.pop() ?? "";
    // limita o buffer: linha sem fim por mais de 8 KiB é lixo
    if (this.resto.length > 8192) this.resto = "";
    const saida: EventoProgressoGit[] = [];
    for (const p of partes) {
      const e = parsearLinhaProgresso(p);
      if (e !== null) saida.push(e);
    }
    return saida;
  }
  /** descarrega o que sobrou (fim da saída). */
  encerrar(): EventoProgressoGit[] {
    const e = parsearLinhaProgresso(this.resto);
    this.resto = "";
    return e === null ? [] : [e];
  }
}

export function formatarBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  const un = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < un.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1).replace(".", ",")} ${un[i] as string}`;
}
export const formatarVelocidade = (bps: number | null): string => (bps === null ? "" : `${formatarBytes(bps)}/s`);
