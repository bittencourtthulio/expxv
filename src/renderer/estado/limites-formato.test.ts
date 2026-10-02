import { describe, expect, it } from "vitest";
import type { AccountUsage, CotaGeral } from "../../compartilhado/limites";
import { ariaBarra, formatarReinicio, janelaGargalo, nomeConta, resumoRodape, seloConfianca, tituloJanela, contasParecemIguais, decimar, estadoCota, formatarDuracao, formatarPct, formatarUsd, partesMedidor, rotulosCurtos, textoChipGeral, textoPrevisao } from "./limites-formato";

const uso = (extra: Partial<AccountUsage> = {}): AccountUsage => ({
  account_id: "a1", provider: "claude", fetched_at: "2026-10-01T10:00:00Z", fonte: "claude_statusline", confianca: "medido", status: "ok",
  windows: [{ kind: "five_hour", used_pct: 62, resets_at: "2026-10-01T15:00:00Z" }, { kind: "weekly", used_pct: 31, resets_at: "2026-10-05T00:00:00Z" }],
  model_buckets: {}, bottleneck: "five_hour", slack_pct: 38, idade_s: 30, vencidas: [], ...extra,
});

describe("formatação de limites", () => {
  it("desconhecido nunca vira zero", () => {
    expect(formatarPct(null)).toBe("—");
    expect(formatarPct(62.4)).toBe("62%");
    expect(formatarUsd(null)).toBe("custo desconhecido");
    expect(formatarUsd(7.1)).toContain("7,10");
  });
  it("estados: ok, aviso (>=85), alerta (>=100), sem dado", () => {
    expect(estadoCota(40)).toMatchObject({ tom: "ok", sinal: "" });
    expect(estadoCota(85)).toMatchObject({ tom: "aviso", sinal: "▲" });
    expect(estadoCota(100)).toMatchObject({ tom: "alerta", sinal: "!" });
    expect(estadoCota(null)).toMatchObject({ tom: "semdado", sinal: "—" });
    expect(estadoCota(10, { confianca: "estimado", idade_s: 4000 })).toMatchObject({ estimado: true, velho: true });
  });
  it("rótulos curtos por provedor e ordem", () => {
    expect(rotulosCurtos([{ account_id: "a", provider: "claude" }, { account_id: "b", provider: "codex" }, { account_id: "c", provider: "claude" }])).toEqual({ a: "cl·1", b: "co·1", c: "cl·2" });
  });
  it("medidor da conta: janelas 5h e sem, vencida marcada com ?", () => {
    const m = partesMedidor(uso({ vencidas: ["weekly"] }), "cl·2");
    expect(m.itens.map((i) => i.texto)).toEqual(["5h 62%", "sem 31%?"]);
    expect(m.aria).toContain("cl·2");
  });
  it("conta sem janelas mostra sem dado, nunca 0%", () => {
    const m = partesMedidor(uso({ windows: [], status: "unavailable" }), "cl·1");
    expect(m.itens[0]?.texto).toBe("sem dado");
    expect(m.estado.tom).toBe("semdado");
  });
  it("conta de crédito mostra saldo, e sem limite quando não há", () => {
    const m = partesMedidor(uso({ provider: "openrouter", windows: [], credit: { limit_usd: 20, used_usd: 12.9, remaining_usd: 7.1 } }), "op·1");
    expect(m.itens[0]?.texto).toContain("restantes");
    expect(partesMedidor(uso({ provider: "openrouter", windows: [], credit: { limit_usd: null, used_usd: null, remaining_usd: null } }), "op·1").itens[0]?.texto).toBe("sem limite");
  });
  it("chip geral: pior + folga + cobertura", () => {
    const g: CotaGeral = { pior: { conta_id: "a1", rotulo: "pessoal", kind: "five_hour", used_pct: 87 }, folga_media_pct: 64, cobertura: { com_dado: 3, total: 4 }, em_alerta: 1, esgotadas: 0 };
    const c = textoChipGeral(g, { a1: "cl·1" });
    expect(c.texto).toBe("pior pessoal 87% · folga 64% (3/4)");
    expect(textoChipGeral({ ...g, pior: { ...g.pior!, rotulo: "" } }, { a1: "cl·1" }).texto).toBe("pior cl·1 87% · folga 64% (3/4)");
    expect(c.estado.tom).toBe("aviso");
    expect(textoChipGeral({ ...g, pior: null, folga_media_pct: null }, {}).texto).toBe("sem dado (3/4)");
    expect(textoChipGeral(null, {}).texto).toBe("cota —");
  });
  it("previsão: insuficiente nunca é chute", () => {
    expect(textoPrevisao({ janela: "five_hour", atual_pct: 5, ritmo_pct_por_hora: null, zera_em: null, antes_do_reset: false, confianca: "insuficiente" })).toBe("dados insuficientes");
    expect(textoPrevisao({ janela: "five_hour", atual_pct: 50, ritmo_pct_por_hora: 1, zera_em: null, antes_do_reset: false, confianca: "alta" })).toBe("não zera neste ritmo");
  });
  it("duração e decimação", () => {
    expect(formatarDuracao(30)).toBe("agora");
    expect(formatarDuracao(125 * 60)).toBe("2 h 5 min");
    const d = decimar(Array.from({ length: 1000 }, (_, i) => i), 300);
    expect(d).toHaveLength(300);
    expect(d[0]).toBe(0);
    expect(d[299]).toBe(999);
    expect(decimar([1, 2, 3], 300)).toEqual([1, 2, 3]);
  });
  it("detecta contas que parecem iguais", () => {
    expect(contasParecemIguais([uso(), uso({ account_id: "a2" }), uso({ account_id: "a3", windows: [{ kind: "five_hour", used_pct: 1, resets_at: "x" }, { kind: "weekly", used_pct: 2, resets_at: "y" }] })])).toEqual([["a1", "a2"]]);
  });
});

describe("consumo por provedor/modelo: formatação", () => {
  const agora = Date.parse("2026-10-01T12:00:00Z");
  it("formatarReinicio: relativo + horário; ausente, inválido e vencido nunca viram zero", () => {
    const r = formatarReinicio("2026-10-01T13:20:00Z", agora);
    expect(r.relativo).toBe("1 h 20 min");
    expect(r.texto).toMatch(/^reinicia em 1 h 20 min · \d{2}:\d{2}$/);
    expect(r.aria).toBe("reinicia em 1 h 20 min");
    expect(formatarReinicio("2026-10-05T13:20:00Z", agora).horario).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(formatarReinicio(null, agora)).toMatchObject({ relativo: null, texto: "reinício não informado" });
    expect(formatarReinicio("lixo", agora).relativo).toBeNull();
    expect(formatarReinicio("2026-10-01T11:00:00Z", agora).texto).toMatch(/vencido/);
  });
  it("ariaBarra segue o padrão 'Claude, conta Pessoal, janela de 5 horas, 62 por cento, reinicia em 1 h 20 min'", () => {
    const aria = ariaBarra({ provedor: "Claude", conta: "Pessoal", escopo: "janela de 5 horas", pct: 62, reinicio: formatarReinicio("2026-10-01T13:20:00Z", agora) });
    expect(aria).toBe("Claude, conta Pessoal, janela de 5 horas, 62 por cento, reinicia em 1 h 20 min");
    expect(ariaBarra({ provedor: "Codex", conta: "X", escopo: "janela semanal", pct: null })).toBe("Codex, conta X, janela semanal, sem dado");
  });
  it("seloConfianca, nomeConta, tituloJanela e janelaGargalo", () => {
    expect(seloConfianca({ confianca: "medido" })).toBe("medido");
    expect(seloConfianca({ confianca: "manual" })).toBe("manual");
    expect(seloConfianca({ confianca: "estimado" })).toBe("estimado");
    expect(seloConfianca({ confianca: "desconhecido" })).toBe("sem dado");
    expect(nomeConta({ account_id: "c1", account_label: "Pessoal" }, "cl·1")).toBe("Pessoal");
    expect(nomeConta({ account_id: "c1" }, "cl·1")).toBe("cl·1");
    expect(nomeConta({ account_id: "c1", account_label: "  " })).toBe("c1");
    expect(tituloJanela("five_hour")).toBe("5 horas");
    expect(tituloJanela("weekly")).toBe("Semanal");
    const c = { bottleneck: "weekly", windows: [{ kind: "five_hour", used_pct: 10, resets_at: null }, { kind: "weekly", used_pct: 80, resets_at: null }] } as never;
    expect(janelaGargalo(c)?.kind).toBe("weekly");
    expect(janelaGargalo({ bottleneck: null, windows: [] } as never)).toBeNull();
  });
  it("resumoRodape: % do gargalo com sinal de estado; sem dado é '—'; crédito é saldo", () => {
    const base = { account_id: "c", provider: "claude", fetched_at: "x", fonte: "claude_statusline", confianca: "medido", status: "ok", model_buckets: {}, slack_pct: 10, idade_s: 5, vencidas: [] } as const;
    const alto = resumoRodape({ ...base, bottleneck: "five_hour", windows: [{ kind: "five_hour", used_pct: 91, resets_at: "2026-10-01T13:20:00Z" }] } as never, "Claude", "Pessoal", agora);
    expect(alto).toMatchObject({ texto: "91%", pct: 91 });
    expect(alto.estado.tom).toBe("aviso");
    expect(alto.aria).toMatch(/^Claude, conta Pessoal, janela de 5 horas, 91 por cento, reinicia em 1 h 20 min, consumo alto$/);
    const esgotado = resumoRodape({ ...base, bottleneck: "five_hour", windows: [{ kind: "five_hour", used_pct: 100, resets_at: null }] } as never, "Claude", "P", agora);
    expect(esgotado.estado.tom).toBe("alerta");
    expect(esgotado.aria).toMatch(/limite atingido/);
    const sem = resumoRodape({ ...base, confianca: "desconhecido", bottleneck: null, windows: [] } as never, "Claude", "P", agora);
    expect(sem).toMatchObject({ texto: "—", pct: null });
    expect(sem.aria).toMatch(/sem dado/);
    const cred = resumoRodape({ ...base, provider: "openrouter", bottleneck: null, windows: [], credit: { limit_usd: 20, used_usd: 12.9, remaining_usd: 7.1 } } as never, "OpenRouter", "P", agora);
    expect(cred.texto).toMatch(/7,10/);
    expect(cred.pct).toBeNull();
    const est = resumoRodape({ ...base, confianca: "estimado", bottleneck: "five_hour", windows: [{ kind: "five_hour", used_pct: 40, resets_at: null }] } as never, "Claude", "P", agora);
    expect(est.texto).toBe("≈40%");
  });
});
