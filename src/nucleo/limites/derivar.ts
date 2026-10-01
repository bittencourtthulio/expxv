// `derivarUso` (T-09.03): do snapshot persistido/em cache ao `AccountUsage` com gargalo, folga e idade. Puro, sem relógio.
// Invariantes: janela vencida (`resets_at <= agora`) vira DESCONHECIDA (nunca "0% usado"); `bottleneck`/`slack_pct`
// só de janelas não vencidas e não nulas; crédito `used = usado/limite*100` só com limite informado; confiança nunca
// `medido` para fonte estimado/nenhuma; nenhum caminho devolve 0 por omissão.
import type { AccountUsage, BaldeModelo, JanelaKind, JanelaLimite, LimitSnapshot } from "../../compartilhado/limites";

const ORDEM: readonly JanelaKind[] = ["five_hour", "weekly", "monthly", "credit"];
const IDADE_DESCONHECIDA = Number.MAX_SAFE_INTEGER;

const pctValido = (v: number | null): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(100, v) : null);

function vencida(resetsAt: string | null, agora: number): boolean {
  if (resetsAt === null) return false;
  const t = Date.parse(resetsAt);
  return Number.isFinite(t) && t <= agora;
}

export function derivarUso(snapshot: LimitSnapshot, agora: number): AccountUsage {
  const vencidas: JanelaKind[] = [];
  const windows: JanelaLimite[] = snapshot.windows.map((j) => {
    if (j.kind === "credit") {
      const c = snapshot.credit;
      const calculado = c !== undefined && c.limit_usd !== null && c.limit_usd > 0 && c.used_usd !== null && c.used_usd >= 0 ? Math.min(100, (c.used_usd / c.limit_usd) * 100) : null;
      // com bloco `credit`, só vale a conta limite/usado: sem limite informado o percentual é desconhecido
      return { kind: "credit", used_pct: c !== undefined ? calculado : pctValido(j.used_pct), resets_at: null };
    }
    if (vencida(j.resets_at, agora)) {
      vencidas.push(j.kind);
      return { kind: j.kind, used_pct: null, resets_at: j.resets_at };
    }
    return { kind: j.kind, used_pct: pctValido(j.used_pct), resets_at: j.resets_at };
  });
  // conta de crédito sem entrada `credit` em windows, mas com `credit` preenchido
  if (snapshot.credit !== undefined && !windows.some((j) => j.kind === "credit")) {
    const c = snapshot.credit;
    const pct = c.limit_usd !== null && c.limit_usd > 0 && c.used_usd !== null && c.used_usd >= 0 ? Math.min(100, (c.used_usd / c.limit_usd) * 100) : null;
    windows.push({ kind: "credit", used_pct: pct, resets_at: null });
  }
  const model_buckets: Record<string, BaldeModelo> = {};
  for (const [nome, b] of Object.entries(snapshot.model_buckets)) {
    model_buckets[nome] = vencida(b.resets_at, agora) ? { ...b, used_pct: null } : { ...b, used_pct: pctValido(b.used_pct) };
  }

  let bottleneck: JanelaKind | null = null;
  let maior = -1;
  for (const k of ORDEM) {
    for (const j of windows) {
      if (j.kind !== k || j.used_pct === null) continue;
      if (j.used_pct > maior) {
        maior = j.used_pct;
        bottleneck = k;
      }
    }
  }
  const slack_pct = bottleneck === null ? null : Math.max(0, Math.round((100 - maior) * 1e6) / 1e6);

  const t = Date.parse(snapshot.fetched_at);
  const idade_s = Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / 1000)) : IDADE_DESCONHECIDA;

  let confianca = snapshot.confianca;
  if ((snapshot.fonte === "estimado" || snapshot.fonte === "nenhuma") && confianca === "medido") confianca = snapshot.fonte === "estimado" ? "estimado" : "desconhecido";
  const temDado = bottleneck !== null || Object.values(model_buckets).some((b) => b.used_pct !== null);
  if (!temDado) confianca = "desconhecido";

  return { ...snapshot, confianca, windows, model_buckets, bottleneck, slack_pct, idade_s, vencidas };
}

/** Maior `used_pct` conhecido do gargalo (ou `null`). */
export function usoDoGargalo(u: AccountUsage): number | null {
  return u.slack_pct === null ? null : Math.round((100 - u.slack_pct) * 1e6) / 1e6;
}
