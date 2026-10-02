// Preferências da barra lateral agrupada (acordeão: um grupo aberto por vez): grupo aberto, telas fixadas (até 3) e modo só-ícones.
// Persistência em localStorage (try/catch: a casca funciona sem), como os demais ajustes de interface do renderer.
import { GRUPOS, TELAS, type GrupoId, type TelaId } from "../casca/telas";

export const MAX_FIXADAS = 3;
export const CHAVE_MENU = "casca.menu.v1";

export interface PrefsMenu {
  abertos: GrupoId[];
  fixados: TelaId[];
  compacto: boolean;
}

/** Primeiro uso: só o grupo de trabalho diário aberto; nada fixado; menu expansível por hover. */
export const PREFS_PADRAO: PrefsMenu = { abertos: ["trabalho"], fixados: [], compacto: false };

const gruposValidos = new Set<string>(GRUPOS.map((g) => g.id));
const telasValidas = new Set<string>(TELAS.map((t) => t.id));

/** Valida o que veio do storage (nunca confia): descarta ids desconhecidos e duplicados e respeita o teto de fixados. */
export function sanearPrefs(bruto: unknown): PrefsMenu {
  if (typeof bruto !== "object" || bruto === null) return { ...PREFS_PADRAO, abertos: [...PREFS_PADRAO.abertos] };
  const o = bruto as Record<string, unknown>;
  const unicos = <T extends string>(v: unknown, validos: Set<string>, max: number): T[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === "string" && validos.has(x)))].slice(0, max) : [];
  return {
    // acordeão: no máximo um grupo aberto por vez (o último gravado vale)
    abertos: Array.isArray(o["abertos"]) ? unicos<GrupoId>(o["abertos"], gruposValidos, GRUPOS.length).slice(-1) : [...PREFS_PADRAO.abertos],
    fixados: unicos<TelaId>(o["fixados"], telasValidas, MAX_FIXADAS),
    compacto: o["compacto"] === true,
  };
}

export interface ArmazemLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
const padrao = (): ArmazemLike | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function lerPrefs(armazem: ArmazemLike | null = padrao()): PrefsMenu {
  try {
    const t = armazem?.getItem(CHAVE_MENU);
    return t === null || t === undefined ? sanearPrefs(null) : sanearPrefs(JSON.parse(t));
  } catch { return sanearPrefs(null); }
}

export function gravarPrefs(p: PrefsMenu, armazem: ArmazemLike | null = padrao()): void {
  try { armazem?.setItem(CHAVE_MENU, JSON.stringify(p)); } catch { /* sem storage: vale só nesta sessão */ }
}

export const alternarGrupo = (p: PrefsMenu, g: GrupoId, aberto?: boolean): PrefsMenu => {
  const esta = p.abertos.includes(g);
  const quer = aberto ?? !esta;
  if (quer === esta) return p;
  // acordeão: abrir um grupo fecha os demais
  return { ...p, abertos: quer ? [g] : p.abertos.filter((x) => x !== g) };
};

/** Fixa ou desafixa; ao passar de 3, a fixação mais antiga sai (a nova sempre entra). */
export const alternarFixada = (p: PrefsMenu, t: TelaId): PrefsMenu =>
  p.fixados.includes(t)
    ? { ...p, fixados: p.fixados.filter((x) => x !== t) }
    : { ...p, fixados: [...p.fixados, t].slice(-MAX_FIXADAS) };

export interface Selo { valor: number; critico?: boolean }
export type Selos = Partial<Record<TelaId, Selo>>;

/** Soma os selos das telas de um grupo (para o cabeçalho do grupo fechado). */
export function agregarSelos(selos: Selos, telas: readonly TelaId[]): Selo | null {
  let valor = 0;
  let critico = false;
  for (const t of telas) {
    const s = selos[t];
    if (s === undefined || s.valor <= 0) continue;
    valor += s.valor;
    critico ||= s.critico === true;
  }
  return valor > 0 ? { valor, critico } : null;
}

export const formatarSelo = (valor: number): string => (valor > 99 ? "99+" : String(valor));
