import { describe, expect, it } from "vitest";
import { gerarId, PREFIXOS_ID } from "./ids";

describe("gerarId (ULID com prefixo)", () => {
  it("usa o prefixo do tipo e 26 caracteres Crockford", () => {
    const id = gerarId("workspace");
    expect(id).toMatch(/^ws_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(gerarId("mission").startsWith("mis_")).toBe(true);
    expect(gerarId("pane").startsWith("pane_")).toBe(true);
    expect(Object.keys(PREFIXOS_ID)).toContain("handoff");
  });

  it("é ordenável: ids gerados em sequência ordenam lexicograficamente, mesmo no mesmo ms", () => {
    const ids = Array.from({ length: 2000 }, () => gerarId("task"));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("respeita o relógio injetado (ordem por tempo)", () => {
    const a = gerarId("pane", 1_000_000);
    const b = gerarId("pane", 2_000_000);
    expect(a < b).toBe(true);
  });
});
