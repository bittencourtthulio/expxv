// Fase 14 (T-14.05/06): montarComandoDoMembro ≤ 1 ms (puro, sem I/O) e esforcoParaCli ≤ 0,05 ms. Mediana de 2000 execuções
// após aquecimento; pior caso individual no log. Registra em docs/ade/perf/ultimo.json (id P-202.montar / P-202.esforco).
import { performance } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";
import type { Membro } from "../../src/compartilhado/squads";
import { esforcoParaCli } from "../../src/nucleo/squads/esforco";
import { montarComandoDoMembro } from "../../src/nucleo/squads/perfil";
import { gravarMedicoes, registrar } from "./registro";

afterAll(() => gravarMedicoes());
const mediana = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

const membro: Membro = {
  slug: "dev", papel: "executor", rotulo: "Dev", descricao: "d", prompt: "membros/dev.md",
  perfil: { cli: "claude", modelo: "sonnet", esforco: "alto", faixa: "alto" },
  skills_permitidas: [], mcps_permitidos: [], hooks: [], max_instancias: 1,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: "automatico",
};
const texto16k = "x".repeat(16 * 1024);

describe("orçamentos de perfil/esforço (P-202: overhead de resolver perfil + montar instruções ≤ 15 ms)", () => {
  it("montarComandoDoMembro ≤ 1 ms (mediana; prompt de 16 KB no renderizador dublê)", () => {
    const renderizador = { renderizar: (e: { rigor: string }) => texto16k + e.rigor };
    const ctx = { squad_slug: "s", executavel: "/x/claude", permissao_workspace: "automatico" as const, rigidez: 3 as const, renderizador };
    for (let i = 0; i < 200; i++) montarComandoDoMembro(membro, ctx);
    const t: number[] = [];
    for (let i = 0; i < 2000; i++) { const a = performance.now(); montarComandoDoMembro(membro, ctx); t.push(performance.now() - a); }
    const m = registrar({ id: "P-202.montar", descricao: "montarComandoDoMembro (mediana de 2000)", valor: mediana(t), limite: 1, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok).toBe(true);
  });

  it("esforcoParaCli ≤ 0,05 ms (mediana)", () => {
    for (let i = 0; i < 200; i++) esforcoParaCli("codex", "alto");
    const t: number[] = [];
    for (let i = 0; i < 2000; i++) { const a = performance.now(); esforcoParaCli(i % 2 === 0 ? "claude" : "opencode", "alto"); t.push(performance.now() - a); }
    const m = registrar({ id: "P-202.esforco", descricao: "esforcoParaCli (mediana de 2000)", valor: mediana(t), limite: 0.05, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok).toBe(true);
  });
});
