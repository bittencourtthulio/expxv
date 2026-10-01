// pickAccount (Fase 9, T-09.12, D-55): a ÚNICA função que escolhe conta. PURA e determinística: sem I/O, sem `Date.now()`
// (o relógio chega em `opcoes.agora`), sem aleatoriedade; só importa TIPOS. A ordem de entrada nunca altera o resultado
// (desempate final por `conta_id`). Dado desconhecido NUNCA vira folga: conta sem dado é rebaixada, nunca promovida.
import type { CandidataConta, MotivoDescarte, OpcoesPick, ResultadoPick } from "../../compartilhado/harness";
import type { JanelaKind } from "../../compartilhado/limites";

/** Ordena "sem data" depois de qualquer data (crédito sem reset, conta sem dado). Inteiro seguro: serializa em JSON. */
const SEM_DATA = Number.MAX_SAFE_INTEGER;

const emMs = (iso: string | null): number | null => {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export interface Gargalo {
  kind: JanelaKind | "modelo";
  used_pct: number;
  resets_at: string | null;
  resets_ms: number | null;
}
export interface MedicaoUso {
  tier: 1 | 2 | 3 | 4;
  gargalo: Gargalo | null;
  /** alguma janela medida ≥ `limiar_esgotamento_pct`. */
  esgotada: boolean;
  /** só o balde do modelo está esgotado. */
  modelo_esgotado: boolean;
}

function janelaRelevante(kind: JanelaKind, janela: OpcoesPick["janela"]): boolean {
  // `credit` (saldo em USD) trava a conta qualquer que seja a janela pedida; as demais obedecem ao filtro.
  return janela === "auto" || kind === "credit" || kind === janela;
}

/** Mede a conta: janelas relevantes + balde do modelo; vencida (`resets_at ≤ agora`) e `used_pct:null` são desconhecidas. */
export function medirUso(c: CandidataConta, o: OpcoesPick): MedicaoUso {
  const uso = c.uso;
  if (uso === null || uso.status !== "ok" || uso.fonte === "nenhuma") return { tier: 4, gargalo: null, esgotada: false, modelo_esgotado: false };
  const medidas: Array<Gargalo & { balde: boolean }> = [];
  const acrescentar = (kind: JanelaKind | "modelo", used: number | null, resets: string | null, balde: boolean): void => {
    if (used === null || !Number.isFinite(used)) return;
    const ms = emMs(resets);
    if (ms !== null && ms <= o.agora) return; // vencida = desconhecida
    medidas.push({ kind, used_pct: used, resets_at: resets, resets_ms: ms, balde });
  };
  for (const w of uso.windows) if (janelaRelevante(w.kind, o.janela)) acrescentar(w.kind, w.used_pct, w.resets_at, false);
  if (o.modelo !== null) {
    const b = Object.prototype.hasOwnProperty.call(uso.model_buckets, o.modelo) ? uso.model_buckets[o.modelo] : undefined;
    if (b) acrescentar("modelo", b.used_pct, b.resets_at, true);
  }
  if (medidas.length === 0) return { tier: 2, gargalo: null, esgotada: false, modelo_esgotado: false }; // provável folga, sem prova
  const esgotada = medidas.some((m) => !m.balde && m.used_pct >= o.limiar_esgotamento_pct);
  const modelo_esgotado = !esgotada && medidas.some((m) => m.balde && m.used_pct >= o.limiar_esgotamento_pct);
  // gargalo: maior uso; desempate: reseta antes (sem data por último); depois kind (determinismo)
  let g = medidas[0] as Gargalo & { balde: boolean };
  for (const m of medidas) {
    const a = m.resets_ms ?? SEM_DATA;
    const b = g.resets_ms ?? SEM_DATA;
    if (m.used_pct > g.used_pct || (m.used_pct === g.used_pct && (a < b || (a === b && m.kind < g.kind)))) g = m;
  }
  const quente = g.used_pct >= o.limiar_troca_pct;
  const tier: 1 | 2 | 3 = quente ? 3 : uso.confianca === "estimado" || uso.confianca === "desconhecido" ? 2 : 1;
  return { tier, gargalo: { kind: g.kind, used_pct: g.used_pct, resets_at: g.resets_at, resets_ms: g.resets_ms }, esgotada, modelo_esgotado };
}

/** Motivo de descarte (1.º que se aplica) ou `null`. `fixadaNoWorkspace` = existe candidata fixada a ESTE workspace. */
export function motivoDeDescarte(c: CandidataConta, o: OpcoesPick, fixadaNoWorkspace: boolean): MotivoDescarte | null {
  if (o.excluir.includes(c.conta_id)) return "excluida";
  if (!c.habilitada) return "desabilitada";
  if (c.auth === "expirada") return "auth";
  // pin DURO: se a fixada não serve, nenhuma outra serve (o Router passa ao próximo executor)
  if (o.conta_fixa_id !== null) {
    if (c.conta_id !== o.conta_fixa_id) return "fora_do_pin";
  } else if (fixadaNoWorkspace ? !c.fixada_em.includes(o.workspace_id) : c.fixada_em.length > 0 && !c.fixada_em.includes(o.workspace_id)) return "fora_do_pin";
  if (o.evitar_reservadas && (c.reservada_modelos.length > 0 || c.reservada_papeis.length > 0)) {
    const serve = (o.modelo !== null && c.reservada_modelos.includes(o.modelo)) || c.reservada_papeis.includes(o.papel);
    if (!serve) return "reservada";
  }
  const cd = emMs(c.cooldown_ate);
  if (cd !== null && cd > o.agora) return "cooldown";
  return null;
}

const comparar = (a: ReadonlyArray<number | string>, b: ReadonlyArray<number | string>): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
};

function descrever(tier: 1 | 2 | 3 | 4, m: MedicaoUso, o: OpcoesPick): string {
  const g = m.gargalo;
  if (tier === 4) return "sem dado de limite";
  if (g === null) return "sem prova de folga (janelas vencidas ou sem dado)";
  const base = `gargalo ${g.kind} ${Math.round(g.used_pct * 10) / 10}% usado, ${g.resets_at ? `reinicia ${g.resets_at}` : "sem data de reinício"}`;
  if (tier === 3) return `quente (≥ ${o.limiar_troca_pct}%): ${base}`;
  if (tier === 2) return `estimado: ${base}`;
  return `medido: ${base}`;
}

/**
 * `pickAccount(candidatas, opcoes)` — o algoritmo único (D-55).
 * Filtra → mede → classifica em níveis 1..4 → ordena pela estratégia. `escolhida` = 1.ª do melhor nível não vazio (ou `null`).
 * `expires_first`: `(gargalo.resets_at ↑ [sem data = +∞], gargalo.used_pct ↑, conta_id)`; `max_slack`: `(folga ↓, resets_at ↑, conta_id)`.
 */
export function pickAccount(candidatas: readonly CandidataConta[], opcoes: OpcoesPick): ResultadoPick {
  const descartadas: ResultadoPick["descartadas"] = [];
  const viaveis: Array<{ conta_id: string; tier: 1 | 2 | 3 | 4; chave: Array<number | string>; motivo: string }> = [];
  const fixadaNoWorkspace = opcoes.conta_fixa_id === null && candidatas.some((c) => c.fixada_em.includes(opcoes.workspace_id));
  for (const c of candidatas) {
    const d = motivoDeDescarte(c, opcoes, fixadaNoWorkspace);
    if (d !== null) {
      descartadas.push({ conta_id: c.conta_id, motivo: d });
      continue;
    }
    const m = medirUso(c, opcoes);
    if (m.esgotada) {
      descartadas.push({ conta_id: c.conta_id, motivo: "esgotada" });
      continue;
    }
    if (m.modelo_esgotado) {
      descartadas.push({ conta_id: c.conta_id, motivo: "modelo_esgotado" });
      continue;
    }
    const g = m.gargalo;
    const reset = g?.resets_ms ?? SEM_DATA;
    const chave: Array<number | string> =
      opcoes.estrategia === "max_slack" ? [g === null ? 1 : g.used_pct - 100, reset, c.conta_id] : [reset, g === null ? 0 : g.used_pct, c.conta_id];
    viaveis.push({ conta_id: c.conta_id, tier: m.tier, chave, motivo: descrever(m.tier, m, opcoes) });
  }
  viaveis.sort((a, b) => a.tier - b.tier || comparar(a.chave, b.chave));
  descartadas.sort((a, b) => (a.conta_id < b.conta_id ? -1 : a.conta_id > b.conta_id ? 1 : 0));
  return { escolhida: viaveis[0]?.conta_id ?? null, ranking: viaveis, descartadas };
}
