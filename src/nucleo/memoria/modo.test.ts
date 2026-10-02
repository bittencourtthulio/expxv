import { describe, expect, it } from "vitest";
import { resolverModo, type EntradaModo } from "./modo";

const base: EntradaModo = {
  config: { ativa: true, solo: true, squad: true },
  global_ativa: true,
  missao_ativa: null,
  pane: { tipo: "cli" },
  missao: { modo: "agentico" },
  cli_tem_mcp: true,
};
const com = (p: Partial<EntradaModo>): EntradaModo => ({ ...base, ...p });

describe("resolverModo (T-08.06 + P-21/P-24)", () => {
  const casos: Array<[string, EntradaModo, string]> = [
    ["agêntico padrão", base, "missao"],
    ["squad padrão (P-24: memória própria)", com({ missao: { modo: "squad" } }), "squad"],
    ["livre/solo ligado por padrão (P-21)", com({ missao: null }), "solo"],
    ["Missão livre = solo", com({ missao: { modo: "livre" } }), "solo"],
    ["solo desligado", com({ missao: null, config: { ativa: true, solo: false, squad: true } }), "off"],
    ["solo sem MCP", com({ missao: null, cli_tem_mcp: false }), "off"],
    ["Missão livre sem MCP", com({ missao: { modo: "livre" }, cli_tem_mcp: false }), "off"],
    ["agêntico sem MCP ainda é missao (MCP vem do token)", com({ cli_tem_mcp: false }), "missao"],
    ["shell nunca", com({ pane: { tipo: "shell" } }), "off"],
    ["shell em squad", com({ pane: { tipo: "shell" }, missao: { modo: "squad" } }), "off"],
    ["workspace desligado", com({ config: { ativa: false, solo: true, squad: true } }), "off"],
    ["global desligado", com({ global_ativa: false }), "off"],
    ["global desligado vence tudo (squad)", com({ global_ativa: false, missao: { modo: "squad" } }), "off"],
    ["Missão desligada", com({ missao_ativa: false }), "off"],
    ["Missão ligada explicitamente herda", com({ missao_ativa: true }), "missao"],
    ["squad desligada no workspace", com({ missao: { modo: "squad" }, config: { ativa: true, solo: true, squad: false } }), "off"],
    ["Missão desligada em squad", com({ missao: { modo: "squad" }, missao_ativa: false }), "off"],
    ["workspace off e solo", com({ missao: null, config: { ativa: false, solo: true, squad: true } }), "off"],
    ["solo com squad desligado não afeta solo", com({ missao: null, config: { ativa: true, solo: true, squad: false } }), "solo"],
    ["Missão desligada em livre", com({ missao: { modo: "livre" }, missao_ativa: false }), "off"],
  ];
  it.each(casos)("%s → %s", (_n, entrada, esperado) => expect(resolverModo(entrada)).toBe(esperado));
  it("são 20 casos", () => expect(casos.length).toBe(20));
});
