// Horário de silêncio (T-20.11, PURO): janela `inicio..fim` que cruza a meia-noite, dias da semana, fuso local (injetável: horário de verão),
// exceção para críticos, silêncio de canal (`/silenciar`) e global ("silenciar tudo por 1 h").
import type { Severidade, SilencioDef } from "../../compartilhado/alertas";

export interface PartesLocais {
  /** 0 = domingo … 6 = sábado. */
  dia: number;
  /** minutos desde a meia-noite local. */
  minutos: number;
}
export type ResolverLocal = (ms: number) => PartesLocais;

export const partesDoSistema: ResolverLocal = (ms) => {
  const d = new Date(ms);
  return { dia: d.getDay(), minutos: d.getHours() * 60 + d.getMinutes() };
};

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** resolve a hora local num fuso IANA (usa a regra de horário de verão do fuso). */
export function partesNoFuso(tz: string): ResolverLocal {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (ms) => {
    let dia = 0;
    let h = 0;
    let m = 0;
    for (const p of f.formatToParts(new Date(ms))) {
      if (p.type === "weekday") dia = DIAS[p.value] ?? 0;
      else if (p.type === "hour") h = Number(p.value) % 24;
      else if (p.type === "minute") m = Number(p.value);
    }
    return { dia, minutos: h * 60 + m };
  };
}

export function minutosDe(hhmm: string | undefined): number | null {
  if (hhmm === undefined) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
}
export const horaValida = (hhmm: string): boolean => minutosDe(hhmm) !== null;

/** a janela está ativa em `p`? (sem considerar exceção de críticos) */
function janelaAtiva(def: SilencioDef, p: PartesLocais): boolean {
  const ini = minutosDe(def.inicio);
  const fim = minutosDe(def.fim);
  if (ini === null || fim === null || ini === fim) return false;
  const dias = def.dias !== undefined && def.dias.length > 0 ? def.dias : [0, 1, 2, 3, 4, 5, 6];
  if (ini < fim) return p.minutos >= ini && p.minutos < fim && dias.includes(p.dia);
  // cruza a meia-noite: a parte da madrugada pertence ao dia ANTERIOR (em que a janela começou)
  if (p.minutos >= ini) return dias.includes(p.dia);
  if (p.minutos < fim) return dias.includes((p.dia + 6) % 7);
  return false;
}

export interface SilencioTemporario {
  ate: string | null;
  incluir_criticos: boolean;
}
export interface ContextoSilencio {
  regra?: SilencioDef;
  global?: SilencioDef;
  /** "silenciar tudo por 1 h" (global) */
  global_temporario?: SilencioTemporario;
  /** `/silenciar` neste chat/canal */
  canal?: SilencioTemporario;
}

export interface ResultadoSilencio {
  silenciado: boolean;
  /** quando a supressão acaba (ms epoch), para liberar o resumo. */
  ate_ms: number | null;
  origem: "regra" | "global" | "global_temporario" | "canal" | null;
}

const LIVRE: ResultadoSilencio = { silenciado: false, ate_ms: null, origem: null };

/**
 * primeiro instante FORA da janela a partir de `ms`. Analítico (próxima vez que a hora local marca `fim`) com ajuste para
 * mudança de horário de verão; se falhar, varre minuto a minuto (até 26 h). Nunca devolve `null` para uma janela ativa.
 */
export function fimDaJanela(def: SilencioDef, ms: number, resolver: ResolverLocal): number | null {
  const alvo = minutosDe(def.fim);
  const base = Math.floor(ms / 60_000) * 60_000;
  if (alvo !== null) {
    const p = resolver(base);
    const delta = ((alvo - p.minutos + 1440) % 1440 || 1440) * 60_000;
    for (const ajuste of [0, -3_600_000, 3_600_000, -1_800_000, 1_800_000]) {
      const c = base + delta + ajuste;
      if (c > base && resolver(c).minutos === alvo && !janelaAtiva(def, resolver(c)) && janelaAtiva(def, resolver(c - 60_000))) return c;
    }
  }
  for (let t = base + 60_000; t <= base + 26 * 3_600_000; t += 60_000) if (!janelaAtiva(def, resolver(t))) return t;
  return null;
}

export function avaliarSilencio(ctx: ContextoSilencio, severidade: Severidade, agora: number, resolver: ResolverLocal = partesDoSistema): ResultadoSilencio {
  const critico = severidade === "critico";
  const temp = (s: SilencioTemporario | undefined, origem: "canal" | "global_temporario"): ResultadoSilencio | null => {
    if (s === undefined || s.ate === null) return null;
    const ate = Date.parse(s.ate);
    if (!Number.isFinite(ate) || ate <= agora) return null;
    if (critico && !s.incluir_criticos) return null;
    return { silenciado: true, ate_ms: ate, origem };
  };
  const t1 = temp(ctx.global_temporario, "global_temporario");
  if (t1 !== null) return t1;
  const t2 = temp(ctx.canal, "canal");
  if (t2 !== null) return t2;
  for (const [def, origem] of [[ctx.global, "global"], [ctx.regra, "regra"]] as const) {
    if (def === undefined || !janelaAtiva(def, resolver(agora))) continue;
    if (critico && def.excecao_critico !== false) continue;
    return { silenciado: true, ate_ms: fimDaJanela(def, agora, resolver), origem };
  }
  return LIVRE;
}
