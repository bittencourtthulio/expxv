// Utilidades puras: relógio/ids injetados, hash, JSON canônico (chaves ordenadas) e formatação PT-BR.
import { createHash, randomBytes } from "node:crypto";

export type Relogio = () => number;
export type GeradorId = (prefixo: string) => string;
export const relogioSistema: Relogio = () => Date.now();
export const isoDe = (t: number): string => new Date(t).toISOString();
export const sha256 = (t: string | Uint8Array): string => createHash("sha256").update(t).digest("hex");

const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** id `<prefixo>_<ULID-like>`: tempo (10) + aleatório (16). Só [0-9A-Z]. */
export function criarGeradorId(relogio: Relogio = relogioSistema): GeradorId {
  return (prefixo) => {
    let t = relogio();
    let tempo = "";
    for (let i = 0; i < 10; i++) { tempo = ALFABETO[t % 32] + tempo; t = Math.floor(t / 32); }
    const r = randomBytes(16);
    let rnd = "";
    for (const b of r) rnd += ALFABETO[b % 32];
    return `${prefixo}_${tempo}${rnd}`;
  };
}

/** JSON canônico: chaves ordenadas em todos os níveis; `undefined` some. */
export function jsonCanonico(v: unknown): string {
  const ordenar = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(ordenar);
    if (typeof x === "object" && x !== null) return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, y]) => [k, ordenar(y)]));
    return x;
  };
  return JSON.stringify(ordenar(v));
}

const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export const numeroPt = (n: number | null | undefined): string => (n === null || n === undefined || !Number.isFinite(n) ? "—" : nf1.format(n));
export const pctPt = (f: number | null | undefined): string => (f === null || f === undefined || !Number.isFinite(f) ? "—" : `${nf1.format(f * 100)} %`);
export const horasPt = (h: number | null | undefined): string => (h === null || h === undefined || !Number.isFinite(h) ? "—" : `${nf1.format(h)} h`);
export const usdPt = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `US$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`);
export const dataPt = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = iso.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : "—";
};
export const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;
export function listaPt(itens: readonly string[]): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0] as string;
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1] as string}`;
}
export function truncarPalavra(t: string, max: number): string {
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const ult = corte.lastIndexOf(" ");
  return `${(ult > max * 0.5 ? corte.slice(0, ult) : corte).replace(/[\s,;:.-]+$/, "")}…`;
}
