import { describe, expect, it } from "vitest";
import { decidirToolLoja, ehToolDaLoja } from "./gate";

describe("gate pre-mcp da Loja", () => {
  it("tool que não é da Loja não é da conta dela (passa)", () => {
    expect(decidirToolLoja("mcp__expxv__pane_spawn", new Set())).toEqual({ permitido: true, motivo: null });
    expect(decidirToolLoja("Bash", null)).toEqual({ permitido: true, motivo: null });
    expect(decidirToolLoja(undefined, null).permitido).toBe(true);
    expect(ehToolDaLoja("mcp__ev_context7__query")).toBe(true);
    expect(ehToolDaLoja("mcp__evil__x")).toBe(false);
  });

  it("falha fechada: sem snapshot ou snapshot vazio nega toda mcp__ev_*", () => {
    expect(decidirToolLoja("mcp__ev_context7__query", undefined).permitido).toBe(false);
    expect(decidirToolLoja("mcp__ev_context7__query", null).permitido).toBe(false);
    expect(decidirToolLoja("mcp__ev_context7__query", new Set()).permitido).toBe(false);
  });

  it("só passa o servidor do snapshot; prefixo parecido não casa; id com hífen vira underscore", () => {
    const snap = new Set(["context7", "sequential-thinking"]);
    expect(decidirToolLoja("mcp__ev_context7__resolve_library_id", snap).permitido).toBe(true);
    expect(decidirToolLoja("mcp__ev_sequential_thinking__sequentialthinking", snap).permitido).toBe(true);
    expect(decidirToolLoja("mcp__ev_context7_extra__x", snap).permitido).toBe(false);
    expect(decidirToolLoja("mcp__ev_deepwiki__ask", snap)).toMatchObject({ permitido: false });
    expect(decidirToolLoja("mcp__ev_context7", snap).permitido).toBe(false);
  });

  it("id malformado no snapshot nunca casa nem lança", () => {
    expect(decidirToolLoja("mcp__ev_x__y", new Set(["../x", "X Y"])).permitido).toBe(false);
  });
});
