import { describe, expect, it } from "vitest";
import type { LimitSnapshot } from "../../compartilhado/limites";
import { derivarUso } from "./derivar";
import { agregarCotas } from "./agregar";

const AGORA = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (deltaMin: number): string => new Date(AGORA + deltaMin * 60_000).toISOString();

function snap(p: Partial<LimitSnapshot> = {}): LimitSnapshot {
  return { account_id: "conta_a", provider: "claude", fetched_at: iso(-2), fonte: "claude_statusline", confianca: "medido", status: "ok", windows: [], model_buckets: {}, ...p };
}

describe("derivarUso", () => {
  it("gargalo = maior uso; slack = 100 - gargalo; idade_s", () => {
    const u = derivarUso(snap({ windows: [{ kind: "five_hour", used_pct: 62, resets_at: iso(60) }, { kind: "weekly", used_pct: 31, resets_at: iso(5000) }] }), AGORA);
    expect(u.bottleneck).toBe("five_hour");
    expect(u.slack_pct).toBe(38);
    expect(u.idade_s).toBe(120);
    expect(u.vencidas).toEqual([]);
  });

  it("janela vencida vira desconhecida (nunca 0) e sai do gargalo", () => {
    const u = derivarUso(snap({ windows: [{ kind: "five_hour", used_pct: 99, resets_at: iso(-1) }, { kind: "weekly", used_pct: 20, resets_at: iso(900) }] }), AGORA);
    expect(u.windows.find((j) => j.kind === "five_hour")?.used_pct).toBeNull();
    expect(u.vencidas).toEqual(["five_hour"]);
    expect(u.bottleneck).toBe("weekly");
    expect(u.slack_pct).toBe(80);
  });

  it("resets_at == agora conta como vencida", () => {
    const u = derivarUso(snap({ windows: [{ kind: "five_hour", used_pct: 50, resets_at: iso(0) }] }), AGORA);
    expect(u.bottleneck).toBeNull();
    expect(u.slack_pct).toBeNull();
    expect(u.confianca).toBe("desconhecido");
  });

  it("sem janela com dado: bottleneck e slack nulos, nunca 0", () => {
    const u = derivarUso(snap({ windows: [] }), AGORA);
    expect(u.bottleneck).toBeNull();
    expect(u.slack_pct).toBeNull();
  });

  it("99 e 40 (Codex): gargalo five_hour, slack 1", () => {
    const u = derivarUso(snap({ provider: "codex", windows: [{ kind: "five_hour", used_pct: 99, resets_at: iso(10) }, { kind: "weekly", used_pct: 40, resets_at: iso(10) }] }), AGORA);
    expect([u.bottleneck, u.slack_pct]).toEqual(["five_hour", 1]);
  });

  it("crédito: used = usado/limite*100 só com limite; sem limite fica null", () => {
    const com = derivarUso(snap({ provider: "openrouter", fonte: "openrouter_api", windows: [{ kind: "credit", used_pct: null, resets_at: null }], credit: { limit_usd: 10, used_usd: 9, remaining_usd: 1 } }), AGORA);
    expect(com.windows[0]?.used_pct).toBe(90);
    expect(com.bottleneck).toBe("credit");
    const sem = derivarUso(snap({ provider: "openrouter", fonte: "openrouter_api", windows: [{ kind: "credit", used_pct: 77, resets_at: null }], credit: { limit_usd: null, used_usd: 9, remaining_usd: null } }), AGORA);
    expect(sem.windows[0]?.used_pct).toBeNull();
    expect(sem.slack_pct).toBeNull();
  });

  it("credit só em `credit` (sem entrada em windows) também gera a janela", () => {
    const u = derivarUso(snap({ windows: [], credit: { limit_usd: 20, used_usd: 5, remaining_usd: 15 } }), AGORA);
    expect(u.slack_pct).toBe(75);
  });

  it("confiança nunca é medido para fonte estimado/nenhuma", () => {
    expect(derivarUso(snap({ fonte: "estimado", confianca: "medido", windows: [{ kind: "weekly", used_pct: 10, resets_at: iso(5) }] }), AGORA).confianca).toBe("estimado");
    expect(derivarUso(snap({ fonte: "nenhuma", confianca: "medido", windows: [{ kind: "weekly", used_pct: 10, resets_at: iso(5) }] }), AGORA).confianca).toBe("desconhecido");
  });

  it("balde de modelo vencido vira null; fetched_at no futuro dá idade 0; fetched_at inválido é idade enorme", () => {
    const u = derivarUso(snap({ fetched_at: iso(10), model_buckets: { opus: { used_pct: 80, resets_at: iso(-5), kind: "weekly" }, sonnet: { used_pct: 10, resets_at: iso(5), kind: "weekly" } } }), AGORA);
    expect(u.model_buckets["opus"]?.used_pct).toBeNull();
    expect(u.model_buckets["sonnet"]?.used_pct).toBe(10);
    expect(u.idade_s).toBe(0);
    expect(derivarUso(snap({ fetched_at: "lixo" }), AGORA).idade_s).toBeGreaterThan(1e9);
  });

  it("valores fora da faixa não passam: NaN/negativo → null, 120 → 100", () => {
    const u = derivarUso(snap({ windows: [{ kind: "five_hour", used_pct: Number.NaN, resets_at: null }, { kind: "weekly", used_pct: -3, resets_at: null }, { kind: "monthly", used_pct: 120, resets_at: null }] }), AGORA);
    expect(u.windows.map((j) => j.used_pct)).toEqual([null, null, 100]);
  });

  it("não muda o snapshot de entrada", () => {
    const s = snap({ windows: [{ kind: "five_hour", used_pct: 50, resets_at: iso(-1) }] });
    const copia = JSON.stringify(s);
    derivarUso(s, AGORA);
    expect(JSON.stringify(s)).toBe(copia);
  });
});

describe("agregarCotas", () => {
  const u = (id: string, usado: number | null) =>
    derivarUso(snap({ account_id: id, windows: usado === null ? [] : [{ kind: "five_hour", used_pct: usado, resets_at: iso(60) }] }), AGORA);

  it("4 contas, 1 sem dado: cobertura 3/4 e folga média das 3", () => {
    const g = agregarCotas([u("a", 10), u("b", 40), u("c", 70), u("d", null)], { rotulos: { c: "cl·3" } });
    expect(g.cobertura).toEqual({ com_dado: 3, total: 4 });
    expect(g.folga_media_pct).toBe(60); // (90+60+30)/3
    expect(g.pior).toEqual({ conta_id: "c", rotulo: "cl·3", kind: "five_hour", used_pct: 70 });
    expect(g.em_alerta).toBe(0);
  });

  it("todas sem dado: pior e folga nulos, cobertura 0/N (nunca 0%)", () => {
    const g = agregarCotas([u("a", null), u("b", null)]);
    expect(g.pior).toBeNull();
    expect(g.folga_media_pct).toBeNull();
    expect(g.cobertura).toEqual({ com_dado: 0, total: 2 });
  });

  it("lista vazia", () => {
    expect(agregarCotas([])).toEqual({ pior: null, folga_media_pct: null, cobertura: { com_dado: 0, total: 0 }, em_alerta: 0, esgotadas: 0 });
  });

  it("alerta ≥ 85 e esgotadas ≥ 100; empate no pior decide por id (determinístico)", () => {
    const g = agregarCotas([u("b", 90), u("a", 90), u("c", 100), u("d", 20)]);
    expect(g.em_alerta).toBe(2);
    expect(g.esgotadas).toBe(1);
    expect(g.pior?.conta_id).toBe("c");
    expect(agregarCotas([u("b", 90), u("a", 90)]).pior?.conta_id).toBe("a");
  });

  it("permutar as contas não muda o resultado", () => {
    const xs = [u("a", 10), u("b", 95), u("c", null), u("d", 50)];
    expect(agregarCotas([...xs].reverse())).toEqual(agregarCotas(xs));
  });
});
