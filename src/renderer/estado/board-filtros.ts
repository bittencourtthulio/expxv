// Filtros do Board: lógica pura + persistência por workspace em localStorage (com try/catch: a tela funciona sem).
import { COLUNAS_BOARD, SELOS_CARD, type ColunaBoard, type FiltrosBoard, type SeloCard } from "../../compartilhado/custo";

export type FiltrosUi = Omit<FiltrosBoard, "workspace_id">;
export const FILTROS_VAZIOS: FiltrosUi = { agrupar: "nenhum" };
const CHAVE = (ws: string): string => `board.filtros.${ws}`;

export const filtrosVazios = (f: FiltrosUi): boolean =>
  (f.trabalho_ids?.length ?? 0) === 0 && f.mission_id === undefined && (f.colunas?.length ?? 0) === 0 && (f.selos?.length ?? 0) === 0 &&
  f.modelo === undefined && f.com_custo === undefined && (f.busca ?? "") === "" && (f.agrupar ?? "nenhum") === "nenhum" && f.mostrar_descartados !== true;

/** Valida o que veio do storage (nunca confia): descarta campo desconhecido ou de tipo errado. */
export function sanearFiltros(bruto: unknown): FiltrosUi {
  if (typeof bruto !== "object" || bruto === null) return { ...FILTROS_VAZIOS };
  const o = bruto as Record<string, unknown>;
  const f: FiltrosUi = { agrupar: "nenhum" };
  if (Array.isArray(o["trabalho_ids"])) { const t = o["trabalho_ids"].filter((x): x is string => typeof x === "string").slice(0, 50); if (t.length > 0) f.trabalho_ids = t; }
  if (typeof o["mission_id"] === "string" && o["mission_id"] !== "") f.mission_id = o["mission_id"];
  if (Array.isArray(o["colunas"])) { const c = o["colunas"].filter((x): x is ColunaBoard => (COLUNAS_BOARD as readonly unknown[]).includes(x)); if (c.length > 0) f.colunas = c; }
  if (Array.isArray(o["selos"])) { const s = o["selos"].filter((x): x is SeloCard => (SELOS_CARD as readonly unknown[]).includes(x)); if (s.length > 0) f.selos = s; }
  if (typeof o["modelo"] === "string" && o["modelo"] !== "") f.modelo = o["modelo"];
  if (typeof o["com_custo"] === "boolean") f.com_custo = o["com_custo"];
  if (typeof o["busca"] === "string" && o["busca"] !== "") f.busca = o["busca"].slice(0, 120);
  if (o["agrupar"] === "trabalho" || o["agrupar"] === "fase") f.agrupar = o["agrupar"];
  if (o["mostrar_descartados"] === true) f.mostrar_descartados = true;
  return f;
}

export interface ArmazemLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const padrao = (): ArmazemLike | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function lerFiltros(ws: string, armazem: ArmazemLike | null = padrao()): FiltrosUi {
  try {
    const t = armazem?.getItem(CHAVE(ws));
    return t === null || t === undefined ? { ...FILTROS_VAZIOS } : sanearFiltros(JSON.parse(t));
  } catch { return { ...FILTROS_VAZIOS }; }
}
export function gravarFiltros(ws: string, f: FiltrosUi, armazem: ArmazemLike | null = padrao()): void {
  try {
    if (filtrosVazios(f)) armazem?.removeItem(CHAVE(ws)); else armazem?.setItem(CHAVE(ws), JSON.stringify(f));
  } catch { /* storage bloqueado: segue sem persistir */ }
}
