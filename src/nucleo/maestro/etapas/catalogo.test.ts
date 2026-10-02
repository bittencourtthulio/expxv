import { describe, expect, it } from "vitest";
import { ETAPA_IDS, PIPELINES_IDS } from "../../../compartilhado/maestro";
import { comandoDaEtapa, ETAPAS, etapaDef, etapaObrigatoria, PIPELINE_DA_INTENCAO, PIPELINES } from "./catalogo";

describe("catálogo de etapas", () => {
  it("ids únicos e todo EtapaId tem definição (e vice-versa)", () => {
    expect(new Set(ETAPAS.map((e) => e.id)).size).toBe(ETAPAS.length);
    expect(ETAPAS.map((e) => e.id).sort()).toEqual([...ETAPA_IDS].sort());
  });
  it("todo pipeline só cita etapas do catálogo e tem definição para cada PipelineId", () => {
    expect(Object.keys(PIPELINES).sort()).toEqual([...PIPELINES_IDS].sort());
    for (const p of Object.values(PIPELINES)) for (const s of p.passos) expect(etapaDef(s.etapa), `${p.id}:${s.etapa}`).not.toBeNull();
  });
  it("todo pipeline com passos termina em etapa válida; laços apontam para etapa anterior do próprio pipeline", () => {
    for (const p of Object.values(PIPELINES)) {
      if (p.passos.length === 0) continue;
      expect(etapaDef(p.passos[p.passos.length - 1]?.etapa as string)).not.toBeNull();
      p.passos.forEach((s, i) => {
        if (s.laco !== undefined) expect(p.passos.findIndex((x) => x.etapa === s.laco)).toBeLessThan(i);
      });
    }
  });
  it("intenção → pipeline cobre as 13 intenções", () => {
    expect(PIPELINE_DA_INTENCAO).toMatchObject({ bug: "runx", feature: "sprintx", refatoracao: "sprintx_legadox", pedido: "prodx", projeto: "buildx", entrega: "mergex", duvida: "consulta", historico: "consulta", convencoes: "stackx", design: "designx", onboarding: "onboarding", controle: "controle", desconhecida: null });
  });
  it("cada etapa gera o comando exato (Claude Code e OpenCode)", () => {
    expect(comandoDaEtapa("runx.e1", "o botão quebrou", "claude").comando).toBe("/expx:runx-causa o botão quebrou");
    expect(comandoDaEtapa("runx.e1", "o botão quebrou", "opencode").comando).toBe("/runx-causa o botão quebrou");
    expect(comandoDaEtapa("runx.e3", "OC-2026-0142", "claude").comando).toBe("/expx:runx-fix OC-2026-0142");
    expect(comandoDaEtapa("sprintx.f5", "export-csv", "claude")).toMatchObject({ comando: "/expx:sprintx-auditoria export-csv", pane_separado: true });
    expect(comandoDaEtapa("runx.e4", "OC-2026-0142", "claude").pane_separado).toBe(true);
    expect(comandoDaEtapa("mergex.pr", "export-csv", "claude").comando).toBe("/expx:mergex-pr export-csv");
    expect(comandoDaEtapa("buildx.condutor", "um sistema de ponto", "claude").comando).toBe("/expx:buildx um sistema de ponto");
    expect(comandoDaEtapa("buildx.condutor", "proj-1", "claude", { retomar: true }).comando).toBe("/expx:buildx-retomar proj-1");
  });
  it("nenhum comando sem argumento; argumento vira uma linha ≤ 1 500", () => {
    for (const e of ETAPAS.filter((x) => x.comando !== null && !x.humano)) {
      const r = comandoDaEtapa(e.id, "", "claude");
      expect(r.comando, e.id).toBe("");
      expect(r.motivo_bloqueio, e.id).toMatch(/argumento/i);
    }
    const longo = comandoDaEtapa("runx.e1", `linha1\nlinha2\t${"x".repeat(5000)}`, "claude").comando;
    expect(longo).not.toMatch(/[\n\t]/);
    expect(longo.length).toBeLessThanOrEqual("/expx:runx-causa ".length + 1500);
  });
  it("etapas humanas e CLIs sem método nunca geram comando", () => {
    expect(comandoDaEtapa("mergex.revisar", "x", "claude")).toMatchObject({ comando: "", somente_humano: true });
    expect(comandoDaEtapa("prodx.assinatura", "x", "claude")).toMatchObject({ comando: "", somente_humano: true });
    expect(comandoDaEtapa("runx.e1", "x", "codex").comando).toBe("");
    expect(comandoDaEtapa("rapido.executar", "x", "claude").comando).toBe("");
    expect(comandoDaEtapa("memox.consultar", "x", "claude").comando).toBe("");
  });
  it("injeção no texto continua sendo UM argumento (sem quebra de linha nem controle)", () => {
    const c = comandoDaEtapa("runx.e1", "; rm -rf ~\n/expx:mergex-pr x\u0007", "claude").comando;
    expect(c.split("\n")).toHaveLength(1);
    expect(c).not.toMatch(/\u0007/);
    expect(c.startsWith("/expx:runx-causa ")).toBe(true);
  });
  it("obrigatórias: piso e humanas", () => {
    expect(etapaObrigatoria("legadox.raio")).toBe(true);
    expect(etapaObrigatoria("prodx.assinatura")).toBe(true);
    expect(etapaObrigatoria("runx.e3")).toBe(false);
  });
});
