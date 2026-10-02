import { describe, expect, it } from "vitest";
import { criarScrubber, mascarar } from "./scrubber";
import { nomesCitados, resolverPlaceholders } from "./placeholders";

describe("scrubber", () => {
  it("remove literal e variantes, cita só o nome, ignora valores curtos e respeita remover/limpar", () => {
    const s = criarScrubber();
    s.adicionar("CHAVE_A", "valor-longo-da-chave-a");
    s.adicionar("CURTO", "abc");
    expect(s.scrub("x valor-longo-da-chave-a y abc")).toBe("x «cofre:CHAVE_A» y abc");
    const b64 = Buffer.from("valor-longo-da-chave-a").toString("base64");
    expect(s.scrub(`h: ${b64}`)).toBe("h: «cofre:CHAVE_A»");
    expect(s.scrub(`q=${encodeURIComponent("valor-longo-da-chave-a")}`)).toBe("q=«cofre:CHAVE_A»");
    expect(s.nomes()).toEqual(["CHAVE_A"]);
    s.remover("CHAVE_A");
    expect(s.scrub("valor-longo-da-chave-a")).toBe("valor-longo-da-chave-a");
    s.adicionar("B", "outro-valor-grande");
    s.limpar();
    expect(s.tamanho()).toBe(0);
  });

  it("o valor mais longo vence quando um contém o outro", () => {
    const s = criarScrubber();
    s.adicionar("CURTA", "segredo-base");
    s.adicionar("LONGA", "segredo-base-estendido");
    expect(s.scrub("a segredo-base-estendido b")).toBe("a «cofre:LONGA» b");
  });

  it("máscara nunca revela o valor curto; mostra no máximo 4 finais de valor longo", () => {
    expect(mascarar("curto")).toBe("••••");
    expect(mascarar("abcdefghijklmnopqrstuvwxyz")).toBe("••••wxyz");
  });
});

describe("placeholders", () => {
  it("resolve {{vault:NOME}} e lista nomes sem repetição", async () => {
    expect(nomesCitados("{{vault:A}} {{vault:B_1}} {{vault:A}} {{vault:minusculo}}")).toEqual(["A", "B_1"]);
    expect(await resolverPlaceholders("x={{vault:A}}", async (n) => `<${n}>`)).toBe("x=<A>");
    await expect(resolverPlaceholders("{{vault:A}}", async () => Promise.reject(new Error("falhou")))).rejects.toThrow("falhou");
  });
});
