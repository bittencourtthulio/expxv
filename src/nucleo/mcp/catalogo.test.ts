import { describe, expect, it } from "vitest";
import { MODOS_MISSAO } from "../dominio";
import { DEFINICOES, TOOLS_MVP, ferramentasPermitidas, matrizPorModo } from "./catalogo";

describe("matriz de tools por modo (05-CONTRATOS §3)", () => {
  it("livre: provider_*, model_list, pane_*, handoff_submit", () => {
    expect([...matrizPorModo("livre")].sort()).toEqual(
      ["handoff_submit", "model_list", "pane_close", "pane_list", "pane_read", "pane_send", "pane_spawn", "provider_list"].sort(),
    );
  });
  it("squad: livre + mission_complete", () => {
    expect([...matrizPorModo("squad")].sort()).toEqual([...matrizPorModo("livre"), "mission_complete"].sort());
  });
  it("agentico: tudo do MVP", () => {
    expect([...matrizPorModo("agentico")].sort()).toEqual([...TOOLS_MVP].sort());
  });
  it.each(MODOS_MISSAO)("workers só recebem handoff_submit (%s)", (modo) => {
    for (const papel of ["executor", "explorador", "revisor"] as const) expect(ferramentasPermitidas(modo, papel)).toEqual(["handoff_submit"]);
  });
  it("squad e livre não têm mission_list nem catalog_list", () => {
    expect(ferramentasPermitidas("squad", "piloto")).not.toContain("mission_list");
    expect(ferramentasPermitidas("livre", "nenhum")).not.toContain("catalog_list");
  });
  it("toda tool do MVP tem definição com nome coerente", () => {
    for (const n of TOOLS_MVP) expect(DEFINICOES[n].name).toBe(n);
  });
});
