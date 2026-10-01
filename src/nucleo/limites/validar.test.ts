import { describe, expect, it } from "vitest";
import { lerInstante, lerPercentual, normalizarSnapshot } from "./validar";

const CONTA = { id: "conta_a", provedor: "claude" };
const AGORA = Date.parse("2026-10-01T12:00:00.000Z");
const N = (bruto: unknown, fonte?: "claude_statusline" | "codex_rollout" | "manual" | "estimado") => normalizarSnapshot(bruto, CONTA, { agora: AGORA, ...(fonte ? { fonte } : {}) });
const EPOCH_S = Math.floor(AGORA / 1000) + 3600;

describe("normalizarSnapshot: tabela de formatos", () => {
  const casos: Array<{ nome: string; bruto: unknown; esperado: { five?: number | null; weekly?: number | null; status: string } }> = [
    { nome: "statusline Claude (used_percentage, epoch s)", bruto: { rate_limits: { five_hour: { used_percentage: 62, resets_at: EPOCH_S }, seven_day: { used_percentage: 31, resets_at: EPOCH_S + 7200 } } }, esperado: { five: 62, weekly: 31, status: "ok" } },
    { nome: "used_percent", bruto: { five_hour: { used_percent: 12.5 }, seven_day: { used_percent: 3 } }, esperado: { five: 12.5, weekly: 3, status: "ok" } },
    { nome: "utilization", bruto: { five_hour: { utilization: 44 } }, esperado: { five: 44, status: "ok" } },
    { nome: "string com %", bruto: { five_hour: { used_percentage: "73%" } }, esperado: { five: 73, status: "ok" } },
    { nome: "fração explícita (used_fraction)", bruto: { five_hour: { used_fraction: 0.25 } }, esperado: { five: 25, status: "ok" } },
    { nome: "0 é 0 (não é ambíguo)", bruto: { five_hour: { used_percentage: 0 } }, esperado: { five: 0, status: "ok" } },
    { nome: "0.5 ambíguo (0–1 × 0–100) vira desconhecido", bruto: { five_hour: { used_percentage: 0.5 } }, esperado: { five: null, status: "ok" } },
    { nome: "1 ambíguo vira desconhecido", bruto: { five_hour: { used_percentage: 1 } }, esperado: { five: null, status: "ok" } },
    { nome: "NaN", bruto: { five_hour: { used_percentage: Number.NaN } }, esperado: { five: null, status: "ok" } },
    { nome: "Infinity", bruto: { five_hour: { used_percentage: Infinity } }, esperado: { five: null, status: "ok" } },
    { nome: "negativo", bruto: { five_hour: { used_percentage: -5 } }, esperado: { five: null, status: "ok" } },
    { nome: "levemente acima de 100 satura", bruto: { five_hour: { used_percentage: 103 } }, esperado: { five: 100, status: "ok" } },
    { nome: "absurdo (5000) desconhecido", bruto: { five_hour: { used_percentage: 5000 } }, esperado: { five: null, status: "ok" } },
    { nome: "texto no lugar do número", bruto: { five_hour: { used_percentage: "muito" } }, esperado: { five: null, status: "ok" } },
    { nome: "janela sem percentual", bruto: { five_hour: { resets_at: EPOCH_S } }, esperado: { five: null, status: "ok" } },
    { nome: "Codex primary 300 min + secondary 10080", bruto: { rate_limits: { primary: { used_percent: 30, window_minutes: 300, resets_at: EPOCH_S }, secondary: { used_percent: 45, window_minutes: 10080, resets_at: EPOCH_S } } }, esperado: { five: 30, weekly: 45, status: "ok" } },
    { nome: "Codex só semanal em primary", bruto: { rate_limits: { primary: { used_percent: 45, window_minutes: 10080 }, secondary: null } }, esperado: { weekly: 45, status: "ok" } },
    { nome: "Codex janela de duração estranha é ignorada", bruto: { rate_limits: { primary: { used_percent: 45, window_minutes: 77 }, secondary: null } }, esperado: { status: "unavailable" } },
    { nome: "schema canônico", bruto: { windows: [{ kind: "five_hour", used_pct: 10, resets_at: new Date(AGORA + 1000).toISOString() }, { kind: "weekly", used_pct: 20, resets_at: null }] }, esperado: { five: 10, weekly: 20, status: "ok" } },
    { nome: "chaves alternativas 5h / 7d", bruto: { "5h": { used_percent: 9 }, "7d": { used_percent: 8 } }, esperado: { five: 9, weekly: 8, status: "ok" } },
    { nome: "objeto vazio", bruto: {}, esperado: { status: "unavailable" } },
    { nome: "null", bruto: null, esperado: { status: "unavailable" } },
    { nome: "string", bruto: "lixo", esperado: { status: "unavailable" } },
    { nome: "array", bruto: [1, 2, 3], esperado: { status: "unavailable" } },
    { nome: "status auth_error é preservado", bruto: { status: "auth_error", five_hour: {} }, esperado: { five: null, status: "auth_error" } },
  ];
  it("tem ao menos 25 formatos", () => expect(casos.length).toBeGreaterThanOrEqual(25));
  for (const c of casos) {
    it(c.nome, () => {
      const s = N(c.bruto, "claude_statusline");
      expect(s.status).toBe(c.esperado.status);
      const w = (k: string) => s.windows.find((j) => j.kind === k)?.used_pct;
      if ("five" in c.esperado) expect(w("five_hour")).toBe(c.esperado.five);
      if ("weekly" in c.esperado) expect(w("weekly")).toBe(c.esperado.weekly);
      expect(s.windows.every((j) => j.used_pct === null || (j.used_pct >= 0 && j.used_pct <= 100))).toBe(true);
    });
  }
});

describe("normalizarSnapshot: instantes, baldes e crédito", () => {
  it("resets_at em epoch s, epoch ms, ISO e resets_in_seconds dão o mesmo instante", () => {
    const alvo = new Date(AGORA + 3_600_000).toISOString();
    const fmt = (o: Record<string, unknown>) => N({ five_hour: { used_percentage: 10, ...o } }).windows[0]?.resets_at;
    expect(fmt({ resets_at: (AGORA + 3_600_000) / 1000 })).toBe(alvo);
    expect(fmt({ resets_at: AGORA + 3_600_000 })).toBe(alvo);
    expect(fmt({ resets_at: alvo })).toBe(alvo);
    expect(fmt({ resets_in_seconds: 3600 })).toBe(alvo);
    expect(fmt({ resets_at: "nunca" })).toBeNull();
  });

  it("seven_day_<familia> vira balde de modelo", () => {
    const s = N({ rate_limits: { seven_day: { used_percentage: 20 }, seven_day_opus: { used_percentage: 70, resets_at: EPOCH_S } } });
    expect(s.model_buckets["opus"]).toEqual({ used_pct: 70, resets_at: new Date(EPOCH_S * 1000).toISOString(), kind: "weekly" });
    expect(s.windows.find((j) => j.kind === "weekly")?.used_pct).toBe(20);
  });

  it("fetched_at nunca no futuro; sem fetched_at usa agora", () => {
    expect(N({ fetched_at: new Date(AGORA + 99_999).toISOString(), five_hour: { used_percentage: 5 } }).fetched_at).toBe(new Date(AGORA).toISOString());
    expect(N({ recebido_em: new Date(AGORA - 5000).toISOString(), five_hour: { used_percentage: 5 } }).fetched_at).toBe(new Date(AGORA - 5000).toISOString());
    expect(N({ five_hour: { used_percentage: 5 } }).fetched_at).toBe(new Date(AGORA).toISOString());
  });

  it("confiança deriva da fonte e é desconhecida sem dado", () => {
    expect(N({ five_hour: { used_percentage: 5 } }, "claude_statusline").confianca).toBe("medido");
    expect(N({ five_hour: { used_percentage: 5 } }, "manual").confianca).toBe("manual");
    expect(N({ five_hour: { used_percentage: 5 } }, "estimado").confianca).toBe("estimado");
    expect(N({ five_hour: {} }, "claude_statusline").confianca).toBe("desconhecido");
    expect(N({ five_hour: { used_percentage: 5 } }).confianca).toBe("desconhecido"); // fonte nenhuma
  });

  it("crédito: sem limite → used_pct null; com limite calcula; sem reset", () => {
    const sem = N({ credit: { used_usd: 3, limit_usd: null } }, "estimado");
    expect(sem.windows[0]).toEqual({ kind: "credit", used_pct: null, resets_at: null });
    const com = N({ credit: { used_usd: 9, limit_usd: 10, remaining_usd: 1 } });
    expect(com.windows[0]?.used_pct).toBe(90);
    expect(com.credit).toEqual({ limit_usd: 10, used_usd: 9, remaining_usd: 1 });
  });

  it("nunca lança (getters hostis, ciclos, objetos gigantes)", () => {
    const hostil = { get five_hour(): unknown { throw new Error("boom"); } };
    expect(() => N(hostil)).not.toThrow();
    expect(N(hostil).status).toBe("unavailable");
    const ciclo: Record<string, unknown> = {};
    ciclo["five_hour"] = ciclo;
    expect(() => N(ciclo)).not.toThrow();
    expect(() => N(Symbol("x"))).not.toThrow();
    expect(() => N(BigInt(5))).not.toThrow();
  });

  it("nenhum caminho devolve 0 por omissão", () => {
    for (const bruto of [{}, { five_hour: {} }, { five_hour: { used_percentage: null } }, { windows: [{ kind: "five_hour" }] }, { credit: {} }]) {
      const s = N(bruto, "claude_statusline");
      expect(s.windows.every((j) => j.used_pct !== 0)).toBe(true);
    }
  });

  it("helpers: lerPercentual e lerInstante", () => {
    expect(lerPercentual("50")).toBe(50);
    expect(lerPercentual(null)).toBeNull();
    expect(lerInstante(0)).toBeNull();
    expect(lerInstante("2026-10-01T00:00:00Z")).toBe("2026-10-01T00:00:00.000Z");
  });
});
