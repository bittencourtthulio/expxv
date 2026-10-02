// Histórico, previsão, eficiência e alertas de consumo (Fase 9, T-09.09): lógica pura, sem I/O nem relógio global.
import { describe, expect, it } from "vitest";
import type { AccountUsage, AmostraLimite } from "../../compartilhado/limites";
import { alertasDeLimite, amostrasDoUso, deveGravarAmostra, estouroPrecoce, preverZerar, semanaInicioIso } from "./historico";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const MIN = 60_000;
const H = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const amostra = (ms: number, pct: number, reinicia: string | null = null, janela: AmostraLimite["janela"] = "five_hour"): AmostraLimite => ({ conta_id: "c1", janela, balde: "", ts: iso(ms), usado_pct: pct, reinicia_em: reinicia });
/** série a `ritmo` pontos/hora começando em `inicio`%, uma amostra a cada `passoMin`. */
const serie = (n: number, passoMin: number, inicio: number, ritmo: number, reinicia: string | null = null, janela: AmostraLimite["janela"] = "five_hour"): AmostraLimite[] =>
  Array.from({ length: n }, (_, i) => amostra(T0 - (n - 1 - i) * passoMin * MIN, inicio + ritmo * ((i * passoMin) / 60), reinicia, janela));

describe("deveGravarAmostra: só quando muda ≥ 1 ponto ou passam 10 min; ≤ 1 gravação por 60 s", () => {
  const ult = { ts: iso(T0), usado_pct: 40 };
  it("primeira amostra sempre entra", () => expect(deveGravarAmostra(undefined, 10, T0)).toBe(true));
  it("mudança de 1 ponto depois de 60 s entra; menos de 1 ponto não; dentro de 60 s não", () => {
    expect(deveGravarAmostra(ult, 41, T0 + 61_000)).toBe(true);
    expect(deveGravarAmostra(ult, 40.4, T0 + 5 * MIN)).toBe(false);
    expect(deveGravarAmostra(ult, 45, T0 + 30_000)).toBe(false);
  });
  it("sem mudança, só depois de 10 min (carimbo de que a conta seguiu viva); queda (reset) conta como mudança", () => {
    expect(deveGravarAmostra(ult, 40, T0 + 9 * MIN)).toBe(false);
    expect(deveGravarAmostra(ult, 40, T0 + 10 * MIN)).toBe(true);
    expect(deveGravarAmostra(ult, 2, T0 + 2 * MIN)).toBe(true);
  });
});

describe("amostrasDoUso: nunca grava o desconhecido como 0", () => {
  const uso = (o: Partial<AccountUsage> = {}): AccountUsage => ({
    account_id: "c1", provider: "claude", fetched_at: iso(T0), fonte: "claude_statusline", confianca: "medido", status: "ok",
    windows: [{ kind: "five_hour", used_pct: 30, resets_at: iso(T0 + 2 * H) }, { kind: "weekly", used_pct: null, resets_at: null }],
    model_buckets: { sonnet: { used_pct: 12, resets_at: iso(T0 + H), kind: "weekly" }, opus: { used_pct: null, resets_at: null, kind: "weekly" } },
    bottleneck: "five_hour", slack_pct: 70, idade_s: 0, vencidas: [], ...o,
  });
  it("janelas com valor viram amostras (e os baldes de modelo); sem valor, nada", () => {
    const r = amostrasDoUso(uso(), T0);
    expect(r.map((a) => `${a.janela}/${a.balde}/${a.usado_pct}`)).toEqual(["five_hour//30", "modelo/sonnet/12"]);
    expect(r[0]).toMatchObject({ conta_id: "c1", ts: iso(T0), reinicia_em: iso(T0 + 2 * H), fonte: "claude_statusline" });
  });
  it("fonte `nenhuma` ou dado vencido não gera amostra", () => {
    expect(amostrasDoUso(uso({ fonte: "nenhuma", confianca: "desconhecido" }), T0)).toEqual([]);
    expect(amostrasDoUso(uso({ windows: [{ kind: "five_hour", used_pct: null, resets_at: iso(T0 - H) }], model_buckets: {} }), T0)).toEqual([]);
  });
});

describe("preverZerar", () => {
  it("série sintética a 10 pt/h na janela de 5 h: zera_em ± 1 min", () => {
    const reinicia = iso(T0 + 4 * H);
    const s = serie(7, 10, 70, 10, reinicia); // 7 amostras, 60 min, de 70% a 80%
    const p = preverZerar(s, "five_hour", T0);
    expect(p.atual_pct).toBeCloseTo(80, 5);
    expect(p.ritmo_pct_por_hora).toBeCloseTo(10, 1);
    // faltam 20 pontos a 10 pt/h = 2 h
    expect(Math.abs(Date.parse(p.zera_em as string) - (T0 + 2 * H))).toBeLessThanOrEqual(MIN);
    expect(p.antes_do_reset).toBe(true);
    expect(["media", "alta"]).toContain(p.confianca);
  });
  it("menos de 3 amostras ou menos de 15 min (5 h): insuficiente, sem data inventada", () => {
    expect(preverZerar(serie(2, 20, 10, 10), "five_hour", T0)).toMatchObject({ confianca: "insuficiente", zera_em: null, ritmo_pct_por_hora: null });
    expect(preverZerar(serie(4, 2, 10, 10), "five_hour", T0)).toMatchObject({ confianca: "insuficiente", zera_em: null }); // 4 amostras em 6 min
    expect(preverZerar([], "weekly", T0)).toMatchObject({ confianca: "insuficiente", atual_pct: null });
  });
  it("semanal exige ≥ 6 h de ciclo", () => {
    expect(preverZerar(serie(5, 30, 10, 2, null, "weekly"), "weekly", T0).confianca).toBe("insuficiente"); // 2 h
    expect(preverZerar(serie(8, 60, 10, 2, null, "weekly"), "weekly", T0).confianca).not.toBe("insuficiente"); // 7 h
  });
  it("reset no meio do ciclo (queda) não contamina o ritmo: só vale o ciclo atual", () => {
    const antes = serie(6, 10, 70, 18, iso(T0 - 20 * MIN)); // ciclo anterior subindo rápido até ~100
    const depoisIni = T0 - 40 * MIN;
    const depois = Array.from({ length: 5 }, (_, i) => amostra(depoisIni + i * 10 * MIN, 2 + i * 1, iso(T0 + 4 * H))); // ciclo novo a 6 pt/h
    const p = preverZerar([...antes.map((a, i) => ({ ...a, ts: iso(T0 - 150 * MIN + i * 10 * MIN) })), ...depois], "five_hour", T0);
    expect(p.ritmo_pct_por_hora).toBeGreaterThan(4);
    expect(p.ritmo_pct_por_hora).toBeLessThan(8);
    expect(p.atual_pct).toBeCloseTo(6, 5);
  });
  it("ritmo ≤ 0: não zera (zera_em null)", () => {
    const p = preverZerar(serie(7, 10, 50, 0), "five_hour", T0);
    expect(p).toMatchObject({ zera_em: null, antes_do_reset: false });
    expect(p.confianca).not.toBe("insuficiente");
  });
  it("zera depois do reset: antes_do_reset=false", () => {
    const p = preverZerar(serie(7, 10, 10, 2, iso(T0 + 30 * MIN)), "five_hour", T0); // 2 pt/h: levaria dias; reseta em 30 min
    expect(p.antes_do_reset).toBe(false);
  });
});

describe("alertasDeLimite", () => {
  const usoDe = (o: Partial<AccountUsage> = {}): AccountUsage => ({
    account_id: "c1", provider: "claude", fetched_at: iso(T0), fonte: "claude_statusline", confianca: "medido", status: "ok", windows: [{ kind: "five_hour", used_pct: 30, resets_at: iso(T0 + 3 * H) }],
    model_buckets: {}, bottleneck: "five_hour", slack_pct: 70, idade_s: 0, vencidas: [], ...o,
  });
  const pv = (o = {}) => ({ janela: "five_hour" as const, atual_pct: 30, ritmo_pct_por_hora: 5, zera_em: null, antes_do_reset: false, confianca: "media" as const, ...o });
  const rotulos = { c1: "pessoal" };

  it("consumo_alto a partir de 85% no gargalo; sem alerta abaixo", () => {
    expect(alertasDeLimite([{ conta_id: "c1", uso: usoDe(), previsoes: [pv()] }], rotulos, T0, () => iso(T0))).toEqual([]);
    const a = alertasDeLimite([{ conta_id: "c1", uso: usoDe({ windows: [{ kind: "five_hour", used_pct: 90, resets_at: iso(T0 + H) }] }), previsoes: [] }], rotulos, T0, () => iso(T0));
    expect(a.map((x) => x.tipo)).toEqual(["consumo_alto"]);
    expect(a[0]?.texto).toMatch(/pessoal/);
  });
  it("vai_estourar: zera antes do reset em menos de 2 h (5 h) ou 24 h (semanal)", () => {
    const cinco = alertasDeLimite([{ conta_id: "c1", uso: usoDe(), previsoes: [pv({ zera_em: iso(T0 + 90 * MIN), antes_do_reset: true })] }], rotulos, T0, () => iso(T0));
    expect(cinco.map((x) => x.tipo)).toContain("vai_estourar");
    const longe = alertasDeLimite([{ conta_id: "c1", uso: usoDe(), previsoes: [pv({ zera_em: iso(T0 + 3 * H), antes_do_reset: true })] }], rotulos, T0, () => iso(T0));
    expect(longe.map((x) => x.tipo)).not.toContain("vai_estourar");
    const semanal = alertasDeLimite([{ conta_id: "c1", uso: usoDe({ windows: [{ kind: "weekly", used_pct: 50, resets_at: iso(T0 + 3 * 86_400_000) }] }), previsoes: [pv({ janela: "weekly", zera_em: iso(T0 + 20 * H), antes_do_reset: true })] }], rotulos, T0, () => iso(T0));
    expect(semanal.map((x) => x.tipo)).toContain("vai_estourar");
  });
  it("cota_sobrando: semanal com fração do ciclo decorrida − uso > 30 pontos e faltando < 48 h", () => {
    // faltam 24 h de 168 h (≈ 85,7% decorrido) com 40% usado ⇒ sobra
    const uso = usoDe({ windows: [{ kind: "weekly", used_pct: 40, resets_at: iso(T0 + 24 * H) }] });
    expect(alertasDeLimite([{ conta_id: "c1", uso, previsoes: [] }], rotulos, T0, () => iso(T0)).map((x) => x.tipo)).toEqual(["cota_sobrando"]);
    // faltam 4 dias: ainda cedo para dizer
    const cedo = usoDe({ windows: [{ kind: "weekly", used_pct: 5, resets_at: iso(T0 + 96 * H) }] });
    expect(alertasDeLimite([{ conta_id: "c1", uso: cedo, previsoes: [] }], rotulos, T0, () => iso(T0))).toEqual([]);
  });
  it("sem_dado: conta sem uso, fonte `nenhuma` ou sem janela com valor (nunca vira 0)", () => {
    expect(alertasDeLimite([{ conta_id: "c1", uso: null, previsoes: [] }], rotulos, T0, () => iso(T0)).map((x) => x.tipo)).toEqual(["sem_dado"]);
    expect(alertasDeLimite([{ conta_id: "c1", uso: usoDe({ fonte: "nenhuma", confianca: "desconhecido", windows: [] }), previsoes: [] }], rotulos, T0, () => iso(T0)).map((x) => x.tipo)).toEqual(["sem_dado"]);
  });
  it("`desde` vem do registro de primeira vista (não repete a cada consulta)", () => {
    const vistos = new Map<string, string>();
    const desde = (k: string): string => vistos.get(k) ?? (vistos.set(k, iso(T0)), iso(T0));
    const a1 = alertasDeLimite([{ conta_id: "c1", uso: null, previsoes: [] }], rotulos, T0, desde);
    const a2 = alertasDeLimite([{ conta_id: "c1", uso: null, previsoes: [] }], rotulos, T0 + 30 * MIN, desde);
    expect(a2[0]?.desde).toBe(a1[0]?.desde);
  });
});

describe("semana e estouro precoce", () => {
  it("semana começa na segunda-feira 00:00 UTC", () => {
    expect(semanaInicioIso(Date.parse("2026-10-01T12:00:00Z"))).toBe("2026-09-28"); // quinta -> segunda
    expect(semanaInicioIso(Date.parse("2026-09-28T00:00:00Z"))).toBe("2026-09-28");
    expect(semanaInicioIso(Date.parse("2026-10-04T23:59:59Z"))).toBe("2026-09-28"); // domingo
  });
  it("estouro precoce: bateu 100% com mais de 25% da janela ainda por correr", () => {
    expect(estouroPrecoce("weekly", 100, iso(T0 + 3 * 86_400_000), T0)).toBe(true);
    expect(estouroPrecoce("weekly", 100, iso(T0 + 12 * H), T0)).toBe(false);
    expect(estouroPrecoce("five_hour", 100, iso(T0 + 2 * H), T0)).toBe(true);
    expect(estouroPrecoce("five_hour", 99, iso(T0 + 4 * H), T0)).toBe(false);
    expect(estouroPrecoce("weekly", 100, null, T0)).toBe(false);
  });
});
