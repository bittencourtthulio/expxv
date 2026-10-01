import { describe, expect, it } from "vitest";
import { agora } from "./tempo";

describe("agora", () => {
  it("devolve UTC ISO com milissegundos", () => {
    expect(agora()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
  it("converte uma data injetada", () => {
    expect(agora(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)))).toBe("2026-01-02T03:04:05.006Z");
  });
});
