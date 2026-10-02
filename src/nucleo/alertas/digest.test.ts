import { describe, expect, it } from "vitest";
import { montarResumoDiario, montarResumoSprint } from "./digest";
import { DADOS_EXEMPLO, escaparHtml, renderizar } from "./templates";

describe("resumos (T-20.13)", () => {
  const dia = { dia: "2026-10-01", concluidas: [{ pontos: 3, tempo_trabalho_ms: 3_600_000, tokens: 1000 }, { pontos: 2, tempo_trabalho_ms: 1_800_000, tokens: null }, { pontos: null, tempo_trabalho_ms: null, tokens: null }], em_andamento: 2, atrasadas: [{ task_id: "T-1", titulo: "Corrigir login", atraso_ms: 37 * 60_000 }], bloqueadas: 1, prs_abertos: 4 };
  it("valores exatos (golden): soma só o que tem fonte; atrasadas com +N min", () => {
    const r = montarResumoDiario(dia);
    expect(r.externo).toBe(true);
    expect(r.alerta.dados).toEqual({ data: "01/10/2026", concluidas_n: 3, pontos_concluidos: 5, tempo_trabalho_ms: 5_400_000, tokens: 1000, em_andamento_n: 2, atrasadas_n: 1, bloqueadas_n: 1, prs_n: 4, lista_atrasadas: "T-1 Corrigir login — +37 min" });
    const t = renderizar("resumo_diario", "telegram", "padrao", r.alerta.dados ?? {}, r.alerta.titulo, { escapar: escaparHtml }).texto;
    expect(t).toBe("<b>Resumo do dia</b> — 01/10/2026\nConcluídas: 3 (5 pts) · Tempo de trabalho: 1 h 30 · Tokens: 1.000\nEm andamento: 2 · Atrasadas: 1 · Bloqueadas: 1 · PRs abertos: 4\nT-1 Corrigir login — +37 min");
  });
  it("sem fonte aparece como tal; sem atrasadas não deixa linha de lixo", () => {
    const r = montarResumoDiario({ ...dia, concluidas: [{ pontos: null, tempo_trabalho_ms: null, tokens: null }], atrasadas: [], prs_abertos: null });
    expect(r.alerta.dados?.tokens).toBeNull();
    const t = renderizar("resumo_diario", "so", "padrao", r.alerta.dados ?? {}, "x").texto;
    expect(t).toContain("Tokens: sem fonte");
    expect(t).not.toMatch(/undefined|null/);
  });
  it("dia sem atividade NÃO envia (somente Centro: 'Nada hoje')", () => {
    const r = montarResumoDiario({ dia: "2026-10-02", concluidas: [], em_andamento: 0, atrasadas: [], bloqueadas: 0, prs_abertos: null });
    expect(r.externo).toBe(false);
    expect(r.alerta.titulo).toContain("Nada hoje");
    expect(r.alerta.dados?.somente_app).toBe(true);
  });
  it("lista de atrasadas: até 5 linhas e 'e mais N'; cabe em 3 500 caracteres", () => {
    const muitas = Array.from({ length: 8 }, (_, i) => ({ task_id: `T-${i}`, titulo: "x".repeat(200), atraso_ms: 60_000 }));
    const r = montarResumoDiario({ ...dia, atrasadas: muitas });
    const lista = String(r.alerta.dados?.lista_atrasadas);
    expect(lista.split("\n")).toHaveLength(6);
    expect(lista).toContain("e mais 3");
    expect(renderizar("resumo_diario", "telegram", "padrao", r.alerta.dados ?? {}, "x", { escapar: escaparHtml }).tamanho_visivel).toBeLessThanOrEqual(3500);
  });
  it("resumo de sprint", () => {
    const r = montarResumoSprint({ sprint_id: "s7", nome: "Sprint 7", entregues_pts: 29, comprometido_pts: 34, velocidade: 31, retrabalho_pct: 8.4, atrasadas: 2, tempo_trabalho_ms: 7_200_000, tokens: null });
    const t = renderizar("resumo_sprint", "so", "padrao", r.alerta.dados ?? {}, "x").texto;
    expect(t).toBe("Resumo da sprint Sprint 7\nEntregues: 29 de 34 pts · Velocidade: 31 · Retrabalho: 8%\nTempo de trabalho: 2 h 00 · Tokens: sem fonte · Atrasadas: 2");
    expect(DADOS_EXEMPLO).toBeDefined();
  });
});
