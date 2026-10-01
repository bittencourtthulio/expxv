import { describe, expect, it } from "vitest";
import { extrairVeredito } from "./veredito";

describe("extrairVeredito", () => {
  it.each([
    ["VEREDITO: SIM", "sim"],
    ["VEREDITO: NÃO", "nao"],
    ["VEREDITO: NAO", "nao"],
    ["VEREDITO: APROVADO — a ocorrência está pronta.", "aprovado"],
    ["VEREDITO: REPROVADO — não está pronta.", "reprovado"],
    ["**VEREDITO: SIM**", "sim"],
    ["> VEREDITO: aprovado", "aprovado"],
    ["  veredito:   Sim  ", "sim"],
  ])("%s -> %s", (linha, esperado) => {
    expect(extrairVeredito(`# Titulo\n\ntexto\n\n${linha}\n`)).toBe(esperado);
  });

  it("sem linha de veredito devolve null", () => {
    expect(extrairVeredito("# Auditoria\n\nsem veredito ainda")).toBeNull();
    expect(extrairVeredito("")).toBeNull();
  });

  it("ignora menção no meio de frase", () => {
    expect(extrairVeredito("o VEREDITO: SIM sera dado depois\n")).toBeNull();
  });

  it("com várias linhas vale a última (template com as duas opções não conta como decisão do topo)", () => {
    expect(extrairVeredito("VEREDITO: NÃO\n\n(corrigido)\n\nVEREDITO: SIM\n")).toBe("sim");
  });

  it("nunca lança", () => {
    expect(() => extrairVeredito(undefined as unknown as string)).not.toThrow();
  });
});
