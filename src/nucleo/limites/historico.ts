// Histórico, previsão, eficiência e alertas de consumo (Fase 9, T-09.09). PURO: sem I/O, sem relógio global (o `agora` entra por parâmetro).
// Regras: custo/limite desconhecido NUNCA vira 0 (sem valor = sem amostra); a previsão só usa o ciclo atual e diz `insuficiente` em vez de inventar.
import type { AccountUsage, AlertaLimite, AmostraLimite, ConfiancaPrevisao, JanelaKind, PrevisaoZerar } from "../../compartilhado/limites";
import type { AmostraComFonte } from "../banco/repos/limite-amostra";

const MIN = 60_000;
const H = 3_600_000;
const DIA = 24 * H;

/** Grava só quando muda ≥ 1 ponto ou passam 10 min; nunca mais de 1 gravação por série a cada 60 s. */
export const MUDANCA_MIN_PONTOS = 1;
export const CARIMBO_MS = 10 * MIN;
export const INTERVALO_MIN_GRAVACAO_MS = 60_000;
/** Limiar do alerta `consumo_alto` no gargalo. */
export const LIMIAR_CONSUMO_ALTO_PCT = 85;
/** Meta semanal padrão de aproveitamento (P-32). */
export const META_SEMANAL_PADRAO_PCT = 90;

export function deveGravarAmostra(ultima: { ts: string; usado_pct: number } | undefined, usadoPct: number, agoraMs: number): boolean {
  if (ultima === undefined) return true;
  const t = Date.parse(ultima.ts);
  if (!Number.isFinite(t)) return true;
  const passou = agoraMs - t;
  if (passou < INTERVALO_MIN_GRAVACAO_MS) return false;
  return Math.abs(usadoPct - ultima.usado_pct) >= MUDANCA_MIN_PONTOS || passou >= CARIMBO_MS;
}

/** Amostras do uso derivado: uma por janela com valor (e por balde de modelo com valor). Fonte `nenhuma` e valores nulos não geram nada. */
export function amostrasDoUso(uso: AccountUsage, agoraMs: number): AmostraComFonte[] {
  if (uso.fonte === "nenhuma") return [];
  const ts = new Date(agoraMs).toISOString();
  const saida: AmostraComFonte[] = [];
  for (const j of uso.windows) {
    if (j.used_pct === null || !Number.isFinite(j.used_pct)) continue;
    saida.push({ conta_id: uso.account_id, janela: j.kind, balde: "", ts, usado_pct: Math.min(100, Math.max(0, j.used_pct)), reinicia_em: j.resets_at, fonte: uso.fonte });
  }
  for (const [nome, b] of Object.entries(uso.model_buckets)) {
    if (b.used_pct === null || !Number.isFinite(b.used_pct) || nome === "") continue;
    saida.push({ conta_id: uso.account_id, janela: "modelo", balde: nome, ts, usado_pct: Math.min(100, Math.max(0, b.used_pct)), reinicia_em: b.resets_at, fonte: uso.fonte });
  }
  return saida;
}

// ---------------------------------------------------------------- previsão

/** Janela de regressão e mínimos por janela (5 h: 60 min / 15 min; semanal e mensal: 24 h / 6 h; crédito: gasto por dia). */
const PARAMETROS: Record<JanelaKind, { regressao_ms: number; minimo_ms: number; ciclo_ms: number | null }> = {
  five_hour: { regressao_ms: 60 * MIN, minimo_ms: 15 * MIN, ciclo_ms: 5 * H },
  weekly: { regressao_ms: DIA, minimo_ms: 6 * H, ciclo_ms: 7 * DIA },
  monthly: { regressao_ms: DIA, minimo_ms: 6 * H, ciclo_ms: 30 * DIA },
  credit: { regressao_ms: DIA, minimo_ms: 6 * H, ciclo_ms: null },
};
const MIN_AMOSTRAS = 3;
/** Queda maior que isto entre duas amostras seguidas = ciclo novo (reset). */
const QUEDA_DE_RESET_PCT = 2;

interface Ponto {
  t: number;
  p: number;
  reinicia: string | null;
}

/** Só as amostras do ciclo atual: depois da última queda (reset) e com o mesmo `reinicia_em` da mais recente. */
function cicloAtual(amostras: readonly AmostraLimite[]): Ponto[] {
  const pts: Ponto[] = amostras
    .map((a) => ({ t: Date.parse(a.ts), p: a.usado_pct, reinicia: a.reinicia_em }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p))
    .sort((a, b) => a.t - b.t);
  if (pts.length === 0) return [];
  let inicio = 0;
  for (let i = 1; i < pts.length; i++) {
    const anterior = pts[i - 1] as Ponto;
    const atual = pts[i] as Ponto;
    if (anterior.p - atual.p > QUEDA_DE_RESET_PCT) inicio = i;
  }
  const ultimo = pts[pts.length - 1] as Ponto;
  if (ultimo.reinicia !== null) {
    const alvo = Date.parse(ultimo.reinicia);
    // `reinicia_em` pode oscilar poucos segundos entre leituras; só um salto grande marca outro ciclo
    for (let i = pts.length - 2; i >= inicio; i--) {
      const r = (pts[i] as Ponto).reinicia === null ? NaN : Date.parse((pts[i] as Ponto).reinicia as string);
      if (Number.isFinite(r) && Math.abs(r - alvo) > 10 * MIN) {
        inicio = i + 1;
        break;
      }
    }
  }
  return pts.slice(inicio);
}

/** Inclinação (pontos por hora) por mínimos quadrados. */
function regressao(pts: readonly Ponto[]): number | null {
  const n = pts.length;
  if (n < 2) return null;
  const t0 = (pts[0] as Ponto).t;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const q of pts) {
    const x = (q.t - t0) / H;
    sx += x;
    sy += q.p;
    sxx += x * x;
    sxy += x * q.p;
  }
  const den = n * sxx - sx * sx;
  return den === 0 ? null : (n * sxy - sx * sy) / den;
}

export function preverZerar(amostras: readonly AmostraLimite[], janela: JanelaKind, agoraMs: number): PrevisaoZerar {
  const insuficiente = (atual: number | null): PrevisaoZerar => ({ janela, atual_pct: atual, ritmo_pct_por_hora: null, zera_em: null, antes_do_reset: false, confianca: "insuficiente" });
  const ciclo = cicloAtual(amostras);
  if (ciclo.length === 0) return insuficiente(null);
  const ultimo = ciclo[ciclo.length - 1] as Ponto;
  const par = PARAMETROS[janela];
  const duracao = ultimo.t - (ciclo[0] as Ponto).t;
  if (ciclo.length < MIN_AMOSTRAS || duracao < par.minimo_ms) return insuficiente(ultimo.p);

  const recentes = ciclo.filter((q) => q.t >= ultimo.t - par.regressao_ms);
  const reg = regressao(recentes.length >= 2 ? recentes : ciclo) ?? 0;
  const medio = duracao > 0 ? (ultimo.p - (ciclo[0] as Ponto).p) / (duracao / H) : 0;
  // média móvel exponencial (0,5) entre o ritmo recente e o ritmo médio do ciclo
  const ritmo = 0.5 * reg + 0.5 * medio;
  const base = { janela, atual_pct: ultimo.p } as const;
  const fracaoCoberta = par.ciclo_ms === null ? duracao / par.regressao_ms : duracao / par.ciclo_ms;
  const confianca: ConfiancaPrevisao = ciclo.length >= 8 && fracaoCoberta >= 0.5 ? "alta" : ciclo.length >= 5 ? "media" : "baixa";
  if (!(ritmo > 0)) return { ...base, ritmo_pct_por_hora: Math.max(0, Math.round(ritmo * 1000) / 1000), zera_em: null, antes_do_reset: false, confianca };
  const horas = Math.max(0, 100 - ultimo.p) / ritmo;
  const zeraMs = agoraMs + horas * H;
  const reset = ultimo.reinicia === null ? NaN : Date.parse(ultimo.reinicia);
  return {
    ...base,
    ritmo_pct_por_hora: Math.round(ritmo * 1000) / 1000,
    zera_em: new Date(zeraMs).toISOString(),
    antes_do_reset: Number.isFinite(reset) && zeraMs < reset,
    confianca,
  };
}

// ---------------------------------------------------------------- alertas

export interface ContaParaAlerta {
  conta_id: string;
  /** `null` = a conta ainda não tem snapshot. */
  uso: AccountUsage | null;
  previsoes: readonly PrevisaoZerar[];
}

const LIMITE_VAI_ESTOURAR_MS: Partial<Record<JanelaKind, number>> = { five_hour: 2 * H, weekly: DIA, monthly: DIA };
const SOBRA_MIN_PONTOS = 30;
const SOBRA_FALTAM_MAX_MS = 48 * H;

/**
 * Alertas puros por conta. `desdeDe(chave)` devolve o instante em que a condição foi vista pela primeira vez (o chamador mantém o registro e o renova a cada hora),
 * então a lista não "repete" o mesmo alerta a cada consulta.
 */
export function alertasDeLimite(contas: readonly ContaParaAlerta[], rotulos: Readonly<Record<string, string>>, agoraMs: number, desdeDe: (chave: string) => string): AlertaLimite[] {
  const saida: AlertaLimite[] = [];
  const rotulo = (id: string): string => rotulos[id] ?? id;
  for (const c of contas) {
    const nome = rotulo(c.conta_id);
    const add = (tipo: AlertaLimite["tipo"], texto: string): void => void saida.push({ tipo, conta_id: c.conta_id, texto, desde: desdeDe(`${tipo}|${c.conta_id}`) });
    const uso = c.uso;
    const comValor = uso === null ? [] : uso.windows.filter((j) => j.used_pct !== null);
    if (uso === null || uso.fonte === "nenhuma" || comValor.length === 0) {
      add("sem_dado", `Sem dado de limite para a conta ${nome}.`);
      continue;
    }
    const gargalo = comValor.reduce((m, j) => ((j.used_pct as number) > (m.used_pct as number) ? j : m));
    if ((gargalo.used_pct as number) >= LIMIAR_CONSUMO_ALTO_PCT) add("consumo_alto", `A conta ${nome} está com ${Math.round(gargalo.used_pct as number)}% da janela ${nomeJanela(gargalo.kind)} usada.`);
    for (const p of c.previsoes) {
      const lim = LIMITE_VAI_ESTOURAR_MS[p.janela];
      if (lim === undefined || p.zera_em === null || !p.antes_do_reset) continue;
      const falta = Date.parse(p.zera_em) - agoraMs;
      if (falta >= 0 && falta < lim) {
        add("vai_estourar", `A conta ${nome} deve zerar a janela ${nomeJanela(p.janela)} em cerca de ${duracaoCurta(falta)} (antes do reset).`);
        break;
      }
    }
    const semanal = comValor.find((j) => j.kind === "weekly" && j.resets_at !== null);
    if (semanal !== undefined) {
      const falta = Date.parse(semanal.resets_at as string) - agoraMs;
      if (falta > 0 && falta < SOBRA_FALTAM_MAX_MS) {
        const decorrido = (1 - falta / (7 * DIA)) * 100;
        if (decorrido - (semanal.used_pct as number) > SOBRA_MIN_PONTOS) add("cota_sobrando", `A conta ${nome} usou ${Math.round(semanal.used_pct as number)}% da semana com ${Math.round(decorrido)}% do ciclo corrido: ainda há folga.`);
      }
    }
  }
  return saida;
}

const nomeJanela = (k: JanelaKind): string => (k === "five_hour" ? "de 5 horas" : k === "weekly" ? "semanal" : k === "monthly" ? "mensal" : "de crédito");
function duracaoCurta(ms: number): string {
  const min = Math.max(1, Math.round(ms / MIN));
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
}

// ---------------------------------------------------------------- semana e eficiência

/** Segunda-feira (UTC) da semana de `ms`, `YYYY-MM-DD`. */
export function semanaInicioIso(ms: number): string {
  const d = new Date(ms);
  const dia = (d.getUTCDay() + 6) % 7; // segunda = 0
  const seg = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia);
  return new Date(seg).toISOString().slice(0, 10);
}

/** Bateu 100% com mais de 25% da janela ainda por correr (semanal e de 5 h). */
export function estouroPrecoce(janela: "five_hour" | "weekly", usadoPct: number, reiniciaEm: string | null, agoraMs: number): boolean {
  if (usadoPct < 100 || reiniciaEm === null) return false;
  const reset = Date.parse(reiniciaEm);
  if (!Number.isFinite(reset)) return false;
  const ciclo = janela === "weekly" ? 7 * DIA : 5 * H;
  return reset - agoraMs > ciclo * 0.25;
}
