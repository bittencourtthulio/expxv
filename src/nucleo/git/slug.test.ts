import { describe, expect, it } from "vitest";
import { slugificar, slugLivre } from "./slug";

describe("slugificar", () => {
  it("minúsculas, sem acento, hifens", () => {
    expect(slugificar("Correção de Ação  —  Usuário!")).toBe("correcao-de-acao-usuario");
    expect(slugificar("  --Olá__Mundo--  ")).toBe("ola-mundo");
  });
  it("limita a 60 sem hífen sobrando no fim", () => {
    const s = slugificar("a".repeat(58) + " bbbbb");
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
    expect(slugificar("x".repeat(200))).toHaveLength(60);
  });
  it("vazio vira nome padrão", () => {
    expect(slugificar("!!!")).toBe("trabalho");
  });
});

describe("slugLivre", () => {
  it("colisão acrescenta sufixo numérico", async () => {
    const ocupados = new Set(["x", "x-2"]);
    expect(await slugLivre("X", (s) => ocupados.has(s))).toBe("x-3");
    expect(await slugLivre("y", (s) => ocupados.has(s))).toBe("y");
  });
  it("o sufixo cabe em 60 caracteres", async () => {
    const base = "a".repeat(60);
    const r = await slugLivre(base, (s) => s === base);
    expect(r).toHaveLength(60);
    expect(r.endsWith("-2")).toBe(true);
  });
});
