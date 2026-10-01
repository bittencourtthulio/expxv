// Normalização tolerante de limites (T-09.03). Recebe o que uma fonte local gravou (statusline, rollout, JSON do dono)
// e devolve o schema único `LimitSnapshot`. NUNCA lança; lixo vira `desconhecido` (`used_pct: null`), jamais zero.
import type { BaldeModelo, ConfiancaLimite, FonteLimite, JanelaKind, JanelaLimite, LimitSnapshot, StatusLimite } from "../../compartilhado/limites";
import { FONTES_LIMITE } from "../../compartilhado/limites";

export interface ContaRef {
  id: string;
  provedor: string;
}
export interface OpcoesNormalizar {
  /** epoch ms; padrão `Date.now()`. Usado como `fetched_at` quando a fonte não informa e como teto (nunca no futuro). */
  agora?: number;
  fonte?: FonteLimite;
}

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const CHAVES_PCT = ["used_percentage", "used_percent", "utilization", "used_pct", "percent_used", "usedPercent", "usado_pct", "percentage", "percent", "pct"];
/** chaves cuja escala é explicitamente 0..1. */
const CHAVES_FRACAO = ["used_fraction", "fraction_used", "fraction", "ratio", "used_ratio"];
const CHAVES_RESET = ["resets_at", "reset_at", "resetsAt", "resets", "reset_time", "reinicia_em", "resetAt"];
const CHAVES_RESET_EM_S = ["resets_in_seconds", "reset_in_seconds", "resets_in_s", "seconds_until_reset"];
const CHAVES_RESET_EM_MIN = ["resets_in_minutes", "reset_in_minutes", "minutes_until_reset"];

function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const limpo = v.trim().replace(/%$/, "").replace(",", ".");
    if (limpo === "") return null;
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Percentual 0..100 ou `null`. Negativo, NaN e lixo → null; 100 < v ≤ 110 satura em 100; (0,1] na escala de percentual é ambíguo → null. */
export function lerPercentual(v: unknown, fracao = false): number | null {
  const n = numero(v);
  if (n === null || n < 0) return null;
  if (fracao) return n <= 1 ? Math.round(n * 1e6) / 1e4 : null;
  if (n > 0 && n <= 1) return null; // 0.5 pode ser 0,5% ou 50%: não adivinhamos
  if (n > 110) return null;
  return Math.min(100, n);
}

/** ISO | epoch s | epoch ms | string numérica → ISO UTC com ms, ou null. */
export function lerInstante(v: unknown): string | null {
  let ms: number | null = null;
  if (typeof v === "number" || (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    ms = n >= 1e11 ? n : n * 1000;
  } else if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v);
    ms = Number.isNaN(t) ? null : t;
  }
  if (ms === null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function primeiro(o: Obj, chaves: readonly string[]): unknown {
  for (const c of chaves) if (c in o && o[c] !== null && o[c] !== undefined) return o[c];
  return undefined;
}

function pctDe(o: Obj): number | null {
  const p = primeiro(o, CHAVES_PCT);
  if (p !== undefined) return lerPercentual(p);
  const f = primeiro(o, CHAVES_FRACAO);
  if (f !== undefined) return lerPercentual(f, true);
  return null;
}

function resetDe(o: Obj, base: number): string | null {
  const abs = primeiro(o, CHAVES_RESET);
  if (abs !== undefined) {
    const i = lerInstante(abs);
    if (i !== null) return i;
  }
  const s = numero(primeiro(o, CHAVES_RESET_EM_S));
  if (s !== null && s >= 0) return new Date(base + s * 1000).toISOString();
  const m = numero(primeiro(o, CHAVES_RESET_EM_MIN));
  if (m !== null && m >= 0) return new Date(base + m * 60_000).toISOString();
  return null;
}

/** `window_minutes` → janela (300 → five_hour, 10080 → weekly, 43200 → monthly); outro valor → null (janela ignorada). */
export function janelaDeMinutos(min: unknown): JanelaKind | null {
  const n = numero(min);
  if (n === 300) return "five_hour";
  if (n === 10080) return "weekly";
  if (n === 43200) return "monthly";
  return null;
}

/** Nome de chave → janela. `seven_day_<familia>` e `five_hour_<familia>` viram balde (família em `balde`). */
function janelaDeChave(chave: string): { kind: JanelaKind; balde: string | null } | null {
  const k = chave.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const simples: Record<string, JanelaKind> = {
    five_hour: "five_hour", "5h": "five_hour", fivehour: "five_hour", session: "five_hour", "5_hour": "five_hour",
    seven_day: "weekly", "7d": "weekly", weekly: "weekly", week: "weekly", sevenday: "weekly", "7_day": "weekly",
    monthly: "monthly", month: "monthly", thirty_day: "monthly", "30d": "monthly",
    credit: "credit", credits: "credit",
  };
  const s = simples[k];
  if (s !== undefined) return { kind: s, balde: null };
  const m = /^(five_hour|seven_day|monthly)_([a-z0-9][a-z0-9._]{0,40})$/.exec(k);
  if (m) {
    const kind: JanelaKind = m[1] === "five_hour" ? "five_hour" : m[1] === "seven_day" ? "weekly" : "monthly";
    return { kind, balde: (m[2] as string).replace(/_/g, "-") };
  }
  return null;
}

const CONFIANCA_DA_FONTE: Record<FonteLimite, ConfiancaLimite> = {
  claude_statusline: "medido",
  codex_rollout: "medido",
  openrouter_api: "medido",
  manual: "manual",
  estimado: "estimado",
  nenhuma: "desconhecido",
};
export const confiancaDaFonte = (f: FonteLimite): ConfiancaLimite => CONFIANCA_DA_FONTE[f];

function fonteValida(v: unknown): FonteLimite | null {
  return typeof v === "string" && (FONTES_LIMITE as readonly string[]).includes(v) ? (v as FonteLimite) : null;
}

function vazio(conta: ContaRef, agora: number, status: StatusLimite = "unavailable"): LimitSnapshot {
  return { account_id: conta.id, provider: conta.provedor, fetched_at: new Date(agora).toISOString(), fonte: "nenhuma", confianca: "desconhecido", status, windows: [], model_buckets: {} };
}

function juntarJanela(mapa: Map<JanelaKind, JanelaLimite>, j: JanelaLimite): void {
  const atual = mapa.get(j.kind);
  if (atual === undefined || (atual.used_pct === null && j.used_pct !== null)) mapa.set(j.kind, j);
}

/**
 * Aceita: o próprio schema (`windows`/`model_buckets`), `rate_limits` da statusline do Claude
 * (`five_hour`, `seven_day`, `seven_day_<familia>`), `primary`/`secondary` do rollout do Codex (com `window_minutes`) e
 * variações de chave. Nunca lança.
 */
export function normalizarSnapshot(bruto: unknown, conta: ContaRef, opcoes: OpcoesNormalizar = {}): LimitSnapshot {
  const agora = opcoes.agora ?? Date.now();
  try {
    if (!ehObj(bruto)) return vazio(conta, agora);
    const raiz = ehObj(bruto["rate_limits"]) ? (bruto["rate_limits"] as Obj) : bruto;

    let obs = agora;
    const t = lerInstante(primeiro(bruto, ["fetched_at", "recebido_em", "observed_at", "timestamp", "ts", "updated_at"]));
    if (t !== null) obs = Math.min(Date.parse(t), agora); // nunca no futuro

    const janelas = new Map<JanelaKind, JanelaLimite>();
    const baldes: Record<string, BaldeModelo> = {};
    const poeBalde = (nome: string, b: BaldeModelo): void => {
      const atual = baldes[nome];
      if (atual === undefined || (atual.used_pct === null && b.used_pct !== null)) baldes[nome] = b;
    };
    const absorver = (o: Obj, kind: JanelaKind, balde: string | null): void => {
      const used = pctDe(o);
      const resets = resetDe(o, obs);
      if (balde !== null) poeBalde(balde, { used_pct: used, resets_at: resets, kind });
      else juntarJanela(janelas, { kind, used_pct: used, resets_at: resets });
    };

    // formato canônico
    if (Array.isArray(raiz["windows"])) {
      for (const w of raiz["windows"] as unknown[]) {
        if (!ehObj(w)) continue;
        const kind = typeof w["kind"] === "string" ? janelaDeChave(w["kind"])?.kind : janelaDeMinutos(w["window_minutes"]);
        if (kind) absorver(w, kind, null);
      }
    }
    if (ehObj(raiz["model_buckets"])) {
      for (const [nome, b] of Object.entries(raiz["model_buckets"] as Obj)) {
        if (!ehObj(b) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(nome)) continue;
        const kind = typeof b["kind"] === "string" ? (janelaDeChave(b["kind"])?.kind ?? "weekly") : "weekly";
        absorver(b, kind, nome);
      }
    }
    // chaves nomeadas (statusline do Claude) e `primary`/`secondary` (Codex)
    for (const [chave, valor] of Object.entries(raiz)) {
      if (!ehObj(valor) || chave === "model_buckets" || chave === "credit" || chave === "credits") continue;
      if (chave === "primary" || chave === "secondary") {
        const kind = janelaDeMinutos(valor["window_minutes"] ?? valor["window_mins"]);
        if (kind !== null) absorver(valor, kind, null); // janela de duração desconhecida é ignorada
        continue;
      }
      const j = janelaDeChave(chave);
      if (j !== null) absorver(valor, j.kind, j.balde);
    }

    // crédito (conta paga por uso)
    let credit: LimitSnapshot["credit"];
    const c = ehObj(raiz["credit"]) ? (raiz["credit"] as Obj) : ehObj(bruto["credit"]) ? (bruto["credit"] as Obj) : undefined;
    if (c !== undefined) {
      const limit = numero(primeiro(c, ["limit_usd", "limit", "total"]));
      const used = numero(primeiro(c, ["used_usd", "used", "usage"]));
      const rem = numero(primeiro(c, ["remaining_usd", "remaining", "balance"]));
      credit = {
        limit_usd: limit !== null && limit > 0 ? limit : null,
        used_usd: used !== null && used >= 0 ? used : null,
        remaining_usd: rem !== null && rem >= 0 ? rem : null,
      };
      if (!janelas.has("credit")) {
        const pct = credit.limit_usd !== null && credit.used_usd !== null ? Math.min(100, (credit.used_usd / credit.limit_usd) * 100) : null;
        janelas.set("credit", { kind: "credit", used_pct: pct, resets_at: null });
      }
    }
    const credito = janelas.get("credit");
    if (credito !== undefined) credito.resets_at = null; // crédito não tem reset

    const fonte = opcoes.fonte ?? fonteValida(bruto["fonte"]) ?? "nenhuma";
    const temAlgo = janelas.size > 0 || Object.keys(baldes).length > 0;
    const statusBruto = bruto["status"];
    const status: StatusLimite = statusBruto === "auth_error" ? "auth_error" : temAlgo ? "ok" : "unavailable";
    const temDado = [...janelas.values()].some((j) => j.used_pct !== null) || Object.values(baldes).some((b) => b.used_pct !== null);
    const confianca = temDado ? confiancaDaFonte(fonte) : "desconhecido";
    const snap: LimitSnapshot = {
      account_id: conta.id,
      provider: conta.provedor,
      fetched_at: new Date(obs).toISOString(),
      fonte,
      confianca,
      status,
      windows: [...janelas.values()],
      model_buckets: baldes,
    };
    if (credit !== undefined) snap.credit = credit;
    return snap;
  } catch {
    return vazio(conta, agora);
  }
}
