import { describe, expect, it } from "vitest";
import { MODOS_MISSAO } from "../dominio";
import { DEFINICOES, TOOLS_AGIL, TOOLS_HARNESS, TOOLS_MVP, ferramentasPermitidas, matrizPorModo } from "./catalogo";

describe("matriz de tools por modo (05-CONTRATOS §3)", () => {
  it("livre: provider_*, model_list, pane_*, handoff_submit", () => {
    expect([...matrizPorModo("livre")].sort()).toEqual(
      ["handoff_read", "handoff_submit", "model_list", "pane_close", "pane_list", "pane_read", "pane_send", "pane_spawn", "provider_list"].sort(),
    );
  });
  it("livre: nenhuma tool da Fase 9", () => {
    for (const t of TOOLS_HARNESS) expect(matrizPorModo("livre")).not.toContain(t);
  });
  it("squad: livre + mission_complete + só leitura da Fase 9 (harness_list, headline_limits) + mcp_store_list (Fase 7B) + task_list/task_get/cost_report (Fase 10)", () => {
    expect([...matrizPorModo("squad")].sort()).toEqual([...matrizPorModo("livre"), "mission_complete", "harness_list", "headline_limits", "mcp_store_list", "catalog_list", "task_list", "task_get", "cost_report"].sort());
  });
  it("agentico: tudo, exceto harness_set (só com o opt-in do workspace) e agent_* (só com squad na Missão) e maestro_* (opt-in do token, Fase 16)", () => {
    expect([...matrizPorModo("agentico")].sort()).toEqual(TOOLS_MVP.filter((n) => n !== "harness_set" && !n.startsWith("agent_") && !n.startsWith("maestro_") && !TOOLS_AGIL.includes(n as never) && !n.startsWith("rag_") && !n.startsWith("map_") && n !== "alert_raise").sort()); // alert_raise: opt-in do token (Fase 20); rag_*: opt-in do token (Fase 15); maestro_*: opt-in do token (Fase 16); gestão ágil: opt-in do token (Fase 18)
    expect(ferramentasPermitidas("agentico", "piloto")).not.toContain("harness_set");
    expect(ferramentasPermitidas("agentico", "piloto", { pilotoEditaPolitica: true })).toContain("harness_set");
  });
  it("o opt-in só vale para o piloto agêntico: squad, livre e workers nunca veem harness_set", () => {
    expect(ferramentasPermitidas("squad", "piloto", { pilotoEditaPolitica: true })).not.toContain("harness_set");
    expect(ferramentasPermitidas("livre", "nenhum", { pilotoEditaPolitica: true })).not.toContain("harness_set");
    for (const papel of ["executor", "explorador", "revisor"] as const) expect(ferramentasPermitidas("agentico", papel, { pilotoEditaPolitica: true })).toEqual(["handoff_submit"]);
  });
  it.each(MODOS_MISSAO)("workers só recebem handoff_submit (%s)", (modo) => {
    for (const papel of ["executor", "explorador", "revisor"] as const) expect(ferramentasPermitidas(modo, papel)).toEqual(["handoff_submit"]);
  });
  it("squad não tem mission_list; squad e agentico têm catalog_list (Fase 7); livre não", () => {
    expect(ferramentasPermitidas("squad", "piloto")).not.toContain("mission_list");
    expect(ferramentasPermitidas("squad", "piloto")).toContain("catalog_list");
    expect(ferramentasPermitidas("agentico", "piloto")).toContain("catalog_list");
    expect(ferramentasPermitidas("livre", "nenhum")).not.toContain("catalog_list");
    for (const papel of ["executor", "explorador", "revisor"] as const) expect(ferramentasPermitidas("squad", papel)).not.toContain("catalog_list");
  });
  it("toda tool do MVP tem definição com nome coerente", () => {
    for (const n of TOOLS_MVP) expect(DEFINICOES[n].name).toBe(n);
  });
});
