// Formatação e regras puras da UI de limites/consumo (Fase 9, onda 7). Sem React, sem I/O.
// Regra de ouro (D-56): desconhecido NUNCA vira zero nem "folga": `null` aparece como "sem dado".
import type { AccountUsage, CotaGeral, JanelaKind, JanelaLimite, PrevisaoZerar } from "../../compartilhado/limites";

export const LIMIAR_AVISO_PCT = 85;
export const LIMIAR_ALERTA_PCT = 100;
/** Dado mais velho que isto aparece em itálico, com a idade no `title`. */
export const IDADE_VELHA_S = 30 * 60;

const ROTULO_JANELA: Record<JanelaKind, string> = { five_hour: "5h", weekly: "sem", monthly: "mês", credit: "créd" };
export const rotuloJanela = (k: JanelaKind): string => ROTULO_JANELA[k];
export const nomeJanela = (k: JanelaKind): string => ({ five_hour: "janela de 5 horas", weekly: "janela semanal", monthly: "janela mensal", credit: "crédito" })[k];

export const SEM_DADO = "sem dado";

export function formatarPct(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${Math.round(n)}%` : "—";
}

const fmtUsd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
/** `null` = desconhecido: nunca "US$ 0,00". */
export function formatarUsd(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? fmtUsd.format(n).replace(/\s/g, " ") : "custo desconhecido";
}

export function formatarDuracao(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d`;
}

export function formatarIdade(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  return s < 60 ? "agora há pouco" : `há ${formatarDuracao(s)}`;
}

export function formatarHora(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export type TomCota = "ok" | "aviso" | "alerta" | "semdado";
export interface EstadoCota {
  tom: TomCota;
  /** marcador textual: cor nunca é o único sinal. */
  sinal: "" | "▲" | "!" | "—";
  estimado: boolean;
  velho: boolean;
  vencida: boolean;
}

/** Estado visual de um percentual: ok (azul), >= 85 aviso `▲`, >= 100 alerta `!`, `null` sem dado `—`. */
export function estadoCota(pct: number | null | undefined, extra: { confianca?: string; idade_s?: number; vencida?: boolean } = {}): EstadoCota {
  const estimado = extra.confianca === "estimado";
  const velho = (extra.idade_s ?? 0) > IDADE_VELHA_S;
  const vencida = extra.vencida === true;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return { tom: "semdado", sinal: "—", estimado, velho, vencida };
  if (pct >= LIMIAR_ALERTA_PCT) return { tom: "alerta", sinal: "!", estimado, velho, vencida };
  if (pct >= LIMIAR_AVISO_PCT) return { tom: "aviso", sinal: "▲", estimado, velho, vencida };
  return { tom: "ok", sinal: "", estimado, velho, vencida };
}

/** Rótulo curto estável por conta: `cl·1`, `cl·2`, `co·1`… (2 letras do provedor + ordem entre as contas dele). */
export function rotulosCurtos(contas: ReadonlyArray<{ account_id: string; provider: string }>): Record<string, string> {
  const contagem = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const c of contas) {
    const n = (contagem.get(c.provider) ?? 0) + 1;
    contagem.set(c.provider, n);
    out[c.account_id] = `${c.provider.slice(0, 2).toLowerCase()}·${n}`;
  }
  return out;
}

export const ehCredito = (c: Pick<AccountUsage, "credit" | "provider">): boolean => c.credit !== undefined || c.provider === "openrouter";

const janelaPrincipal = (c: AccountUsage, kind: JanelaKind): JanelaLimite | undefined => c.windows.find((w) => w.kind === kind);

export interface PartesMedidor {
  rotulo: string;
  /** itens `5h 62%`, `sem 31%`, ou `US$ 7,10 restantes`/`sem limite`. */
  itens: Array<{ chave: string; texto: string; estado: EstadoCota }>;
  /** pior estado entre os itens (decide cor/sinal do conjunto). */
  estado: EstadoCota;
  aria: string;
  titulo: string;
}

/** Texto do medidor de UMA conta no rodapé (`cl·2 5h 62% sem 31%`). Conta de crédito mostra saldo, nunca 0%. */
export function partesMedidor(c: AccountUsage, rotulo: string): PartesMedidor {
  const extra = { confianca: c.confianca, idade_s: c.idade_s };
  const itens: PartesMedidor["itens"] = [];
  if (ehCredito(c)) {
    const rest = c.credit?.remaining_usd;
    const texto = typeof rest === "number" ? `${formatarUsd(rest)} restantes` : c.credit?.limit_usd === null ? "sem limite" : SEM_DADO;
    itens.push({ chave: "credit", texto, estado: estadoCota(typeof rest === "number" ? 0 : null, extra) });
  } else {
    for (const kind of ["five_hour", "weekly"] as const) {
      const w = janelaPrincipal(c, kind);
      if (w === undefined) continue;
      const vencida = c.vencidas.includes(kind);
      itens.push({ chave: kind, texto: `${rotuloJanela(kind)} ${formatarPct(w.used_pct)}${vencida ? "?" : ""}`, estado: estadoCota(w.used_pct, { ...extra, vencida }) });
    }
    if (itens.length === 0) itens.push({ chave: "nenhum", texto: SEM_DADO, estado: estadoCota(null, extra) });
  }
  const ordem: TomCota[] = ["alerta", "aviso", "ok", "semdado"];
  const pior = itens.map((i) => i.estado).sort((a, b) => ordem.indexOf(a.tom) - ordem.indexOf(b.tom))[0] ?? estadoCota(null);
  const resumo = itens.map((i) => i.texto).join(", ");
  const nota = [pior.estimado ? "estimado" : "", pior.velho ? `dado ${formatarIdade(c.idade_s)}` : ""].filter(Boolean).join("; ");
  return {
    rotulo,
    itens,
    estado: pior,
    aria: `Conta ${rotulo}: ${resumo}${nota ? ` (${nota})` : ""}${pior.tom === "alerta" ? ", limite atingido" : pior.tom === "aviso" ? ", consumo alto" : ""}`,
    titulo: `${rotulo} · ${resumo}${nota ? ` · ${nota}` : ""}`,
  };
}

/** Quanto falta para zerar, a partir da previsão (hover/foco). */
export function textoPrevisao(p: PrevisaoZerar): string {
  if (p.confianca === "insuficiente") return "dados insuficientes";
  if (p.zera_em === null) return "não zera neste ritmo";
  const hora = new Date(p.zera_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return p.antes_do_reset ? `zera às ${hora}, antes de resetar` : `zera às ${hora}`;
}

/** Chip da cota geral no topo: `pior cl·1 87% · folga 64% (3/4)`. */
export function textoChipGeral(g: CotaGeral | null, rotulos: Record<string, string>): { texto: string; estado: EstadoCota; aria: string } {
  if (g === null || g.cobertura.total === 0) return { texto: "cota —", estado: estadoCota(null), aria: "Cota geral: sem contas" };
  const cob = `${g.cobertura.com_dado}/${g.cobertura.total}`;
  if (g.pior === null) return { texto: `sem dado (${cob})`, estado: estadoCota(null), aria: `Cota geral: sem dado em nenhuma conta (${cob})` };
  const estado = estadoCota(g.pior.used_pct);
  // nome real da conta (o main o envia em `pior.rotulo`); o curto `cl·1` só quando ele falta
  const rot = g.pior.rotulo.trim() !== "" ? g.pior.rotulo : (rotulos[g.pior.conta_id] ?? g.pior.conta_id);
  const folga = g.folga_media_pct === null ? "folga —" : `folga ${formatarPct(g.folga_media_pct)}`;
  return {
    texto: `pior ${rot} ${formatarPct(g.pior.used_pct)} · ${folga} (${cob})`,
    estado,
    aria: `Cota geral: pior conta ${rot} em ${formatarPct(g.pior.used_pct)}, folga média ${formatarPct(g.folga_media_pct)}, ${cob} contas com dado${g.esgotadas > 0 ? `, ${g.esgotadas} esgotada(s)` : ""}`,
  };
}

/** Decimação simples (≤ `max` pontos) preservando primeiro e último. */
export function decimar<T>(pontos: readonly T[], max = 300): T[] {
  if (pontos.length <= max) return [...pontos];
  if (max < 2) return pontos.slice(0, Math.max(max, 0));
  const passo = (pontos.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(pontos[Math.round(i * passo)] as T);
  return out;
}

/** Duas contas com janelas idênticas ao mesmo tempo (provável mesma conta). */
export function contasParecemIguais(contas: readonly AccountUsage[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const chave = (c: AccountUsage): string | null => {
    const ws = c.windows.filter((w) => w.used_pct !== null && w.resets_at !== null).map((w) => `${w.kind}:${w.used_pct}:${w.resets_at}`).sort();
    return ws.length >= 2 ? `${c.provider}|${ws.join("|")}` : null;
  };
  const vistos = new Map<string, string>();
  for (const c of contas) {
    const k = chave(c);
    if (k === null) continue;
    const antes = vistos.get(k);
    if (antes !== undefined) out.push([antes, c.account_id]); else vistos.set(k, c.account_id);
  }
  return out;
}

// ---- Consumo por provedor → conta → modelo (rodapé, popover e tela Consumo) ----

const TITULO_JANELA: Record<JanelaKind, string> = { five_hour: "5 horas", weekly: "Semanal", monthly: "Mensal", credit: "Crédito" };
/** Rótulo curto de linha: "5 horas", "Semanal"… */
export const tituloJanela = (k: JanelaKind): string => TITULO_JANELA[k];

export interface TextoReinicio {
  /** "1 h 20 min" (ou "agora"); `null` = sem horário informado. */
  relativo: string | null;
  /** "14:30" se for hoje/até 24 h; "03/10 14:30" depois. */
  horario: string | null;
  /** "reinicia em 1 h 20 min · 14:30" ou "reinício não informado". */
  texto: string;
  /** versão falada: "reinicia em 1 h 20 min". */
  aria: string;
}

/** Quando a janela reinicia: tempo relativo + horário. Passado/inválido/ausente nunca vira "0": é "não informado". */
export function formatarReinicio(iso: string | null | undefined, agora: number = Date.now()): TextoReinicio {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return { relativo: null, horario: null, texto: "reinício não informado", aria: "reinício não informado" };
  if (t <= agora) return { relativo: null, horario: null, texto: "reinício vencido, aguardando nova leitura", aria: "reinício vencido" };
  const s = (t - agora) / 1000;
  const relativo = formatarDuracao(s);
  const d = new Date(t);
  const horario = s < 24 * 3600
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(", ", " ");
  return { relativo, horario, texto: `reinicia em ${relativo} · ${horario}`, aria: `reinicia em ${relativo}` };
}

/** "medido", "estimado", "manual" ou "sem dado": o selo de procedência de uma conta. */
export function seloConfianca(c: Pick<AccountUsage, "confianca">): string {
  return c.confianca === "medido" ? "medido" : c.confianca === "manual" ? "manual" : c.confianca === "estimado" ? "estimado" : SEM_DADO;
}

/** Percentual falado: "62 por cento" ou "sem dado". */
export const pctFalado = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? `${Math.round(n)} por cento` : SEM_DADO);

/** Rótulo de acessibilidade de uma barra: "Claude, conta Pessoal, janela de 5 horas, 62 por cento, reinicia em 1 h 20 min". */
export function ariaBarra(p: { provedor: string; conta: string; escopo: string; pct: number | null | undefined; reinicio?: TextoReinicio | null }): string {
  return [`${p.provedor}, conta ${p.conta}`, p.escopo, pctFalado(p.pct), p.reinicio?.relativo != null ? p.reinicio.aria : null].filter((x) => x !== null).join(", ");
}

/** Nome da conta para a pessoa: o rótulo gravado, ou o curto como último recurso. */
export const nomeConta = (c: Pick<AccountUsage, "account_id" | "account_label">, curto?: string): string =>
  c.account_label !== undefined && c.account_label.trim() !== "" ? c.account_label : (curto ?? c.account_id);

/** Janela do gargalo (a de maior uso não vencida), ou a primeira com dado; `null` sem nenhuma. */
export function janelaGargalo(c: AccountUsage): JanelaLimite | null {
  if (c.bottleneck !== null) {
    const w = c.windows.find((x) => x.kind === c.bottleneck);
    if (w !== undefined) return w;
  }
  return c.windows.find((w) => w.used_pct !== null) ?? c.windows[0] ?? null;
}

export interface ResumoRodape {
  /** texto curto do gargalo: "62%", "US$ 7,10" ou "—". */
  texto: string;
  pct: number | null;
  estado: EstadoCota;
  aria: string;
  titulo: string;
}

/** Entrada de UMA conta no rodapé: percentual do gargalo (ou saldo), estado e rótulos falado/hover com todas as janelas. */
export function resumoRodape(c: AccountUsage, provedor: string, nome: string, agora: number = Date.now()): ResumoRodape {
  const extra = { confianca: c.confianca, idade_s: c.idade_s };
  const nota = [c.confianca === "estimado" ? "estimado" : c.confianca === "manual" ? "manual" : "", estadoCota(null, extra).velho ? `dado ${formatarIdade(c.idade_s)}` : ""].filter(Boolean).join("; ");
  if (ehCredito(c)) {
    const rest = c.credit?.remaining_usd;
    const texto = typeof rest === "number" ? formatarUsd(rest) : c.credit?.limit_usd === null ? "sem limite" : "—";
    const falado = typeof rest === "number" ? `${formatarUsd(rest)} restantes` : c.credit?.limit_usd === null ? "sem limite" : SEM_DADO;
    const estado = estadoCota(typeof rest === "number" ? 0 : null, extra);
    return { texto, pct: null, estado, aria: `${provedor}, conta ${nome}, crédito, ${falado}`, titulo: `${provedor} · ${nome} · crédito ${falado}` };
  }
  const principal = janelaGargalo(c);
  const pct = principal?.used_pct ?? null;
  const vencida = principal !== null && c.vencidas.includes(principal.kind);
  const estado = estadoCota(pct, { ...extra, vencida });
  const partes = c.windows.map((w) => {
    const r = formatarReinicio(w.resets_at, agora);
    return `${nomeJanela(w.kind)}, ${pctFalado(w.used_pct)}${r.relativo !== null ? `, ${r.aria}` : ""}`;
  });
  const falado = partes.length === 0 ? SEM_DADO : partes.join("; ");
  const alta = estado.tom === "alerta" ? ", limite atingido" : estado.tom === "aviso" ? ", consumo alto" : "";
  const curtas = c.windows.map((w) => `${rotuloJanela(w.kind)} ${formatarPct(w.used_pct)}`).join(" · ");
  return {
    texto: pct === null ? "—" : `${estado.estimado ? "≈" : ""}${formatarPct(pct)}${vencida ? "?" : ""}`,
    pct,
    estado,
    aria: `${provedor}, conta ${nome}, ${falado}${nota ? ` (${nota})` : ""}${alta}`,
    titulo: `${provedor} · ${nome} · ${curtas === "" ? SEM_DADO : curtas}${nota ? ` · ${nota}` : ""}`,
  };
}
