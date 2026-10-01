import { describe, expect, it } from "vitest";
import { variavelDeAmbiente } from "../nucleo/produto";
import { smokeAtivo } from "./smoke";

describe("modo smoke", () => {
  const nome = variavelDeAmbiente("SMOKE");
  it("ativa só com a variável igual a 1", () => {
    expect(smokeAtivo({ [nome]: "1" })).toBe(true);
    expect(smokeAtivo({ [nome]: "0" })).toBe(false);
    expect(smokeAtivo({ [nome]: "true" })).toBe(false);
    expect(smokeAtivo({})).toBe(false);
  });
});
