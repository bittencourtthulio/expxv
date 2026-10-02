// Utilidades puras e determinísticas: datas (UTC), percentis, mediana, hash, texto, PRNG com semente.
import type { ConfigAgil } from "../../compartilhado/agil";

export type Relogio = () => number;
export const relogioSistema: Relogio = () => Date.now();

// ---- datas (tudo em UTC; dia = AAAA-MM-DD) ----
export const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isNaN(v) ? null : v;
};
export const isoDe = (t: number): string => new Date(t).toISOString();
export const diaDe = (iso: string): string => iso.slice(0, 10);
const DIA_MS = 86_400_000;
export const diaParaMs = (dia: string): number => Date.parse(`${dia}T00:00:00.000Z`);
export const fimDoDia = (dia: string): number => diaParaMs(dia) + DIA_MS - 1;
export const somarDias = (dia: string, n: number): string => new Date(diaParaMs(dia) + n * DIA_MS).toISOString().slice(0, 10);
export const diaDaSemana = (dia: string): number => new Date(diaParaMs(dia)).getUTCDay();
export const ehDiaUtil = (dia: string, c: Pick<ConfigAgil, "dias_uteis" | "feriados">): boolean => c.dias_uteis.includes(diaDaSemana(dia)) && !c.feriados.includes(dia);
export function intervaloDias(inicio: string, fim: string): string[] {
  const out: string[] = [];
  for (let d = inicio, i = 0; d <= fim && i < 4000; d = somarDias(d, 1), i++) out.push(d);
  return out;
}
export const diasUteis = (inicio: string, fim: string, c: Pick<ConfigAgil, "dias_uteis" | "feriados">): string[] => intervaloDias(inicio, fim).filter((d) => ehDiaUtil(d, c));
/** último dia útil estritamente antes de `dia`. */
export function diaUtilAnterior(dia: string, c: Pick<ConfigAgil, "dias_uteis" | "feriados">): string {
  let d = somarDias(dia, -1);
  for (let i = 0; i < 60 && !ehDiaUtil(d, c); i++) d = somarDias(d, -1);
  return d;
}
/** data AAAA-MM-DD sem hora vira o fim do dia (e sinaliza que o instante não é preciso). */
export function instante(texto: string | null | undefined): { iso: string; preciso: boolean } | null {
  if (!texto) return null;
  const t = String(texto).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { iso: isoDe(fimDoDia(t)), preciso: false };
  const v = ms(t);
  return v === null ? null : { iso: isoDe(v), preciso: true };
}

// ---- estatística ----
/** percentil por interpolação linear sobre amostra ORDENADA (p em 0..100). */
export function percentilOrdenado(ordenado: readonly number[], p: number): number | null {
  const n = ordenado.length;
  if (n === 0) return null;
  if (n === 1) return ordenado[0] as number;
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = ordenado[lo] as number;
  const b = ordenado[hi] as number;
  return a + (b - a) * (pos - lo);
}
export const ordenar = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);
export const mediana = (xs: readonly number[]): number | null => percentilOrdenado(ordenar(xs), 50);
export const media = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
export const soma = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
export const arredondar = (v: number, casas = 4): number => Math.round(v * 10 ** casas) / 10 ** casas;

// ---- hash e PRNG ----
/** FNV-1a 32 bits em hex: estável, sem crypto (dedupe, não segurança). */
export function hash(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
export function prng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- ids ----
export type GeradorId = (prefixo: string) => string;
/** ids ordenáveis no tempo: prefixo + tempo(base36) + contador; o relógio é injetado. */
export function criarGeradorId(relogio: Relogio): GeradorId {
  let n = 0;
  return (prefixo) => `${prefixo}_${relogio().toString(36).padStart(9, "0")}${(n++).toString(36).padStart(5, "0")}`;
}

// ---- texto ----
export const truncar = (t: string, max: number): string => (t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`);
export const normalizar = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const tokens = (t: string): string[] => normalizar(t).split(/[^a-z0-9]+/).filter((x) => x.length > 2);
export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
const SEGREDOS = [
  /\b(sk|pk|ghp|gho|ghs|ghu|github_pat|xox[abprs]|AKIA|ASIA|AIza|ya29|glpat|npm|hf|rk_live|sk_live|pk_live|SG)[-_.A-Za-z0-9]{12,}/g,
  /\b(senha|password|passwd|pwd|token|secret|segredo|api[_-]?key|chave)\s*[:=]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi, // URL com usuário:senha@
];
/** nunca deixa segredo aparente entrar em auditoria/log (erros citam o nome, nunca o valor). */
export function redigirSegredos(t: string): string {
  return SEGREDOS.reduce((acc, r) => acc.replace(r, "[redigido]"), t);
}
