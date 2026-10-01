import { describe, expect, it } from "vitest";
import { buscarFuzzy, criarIndice, normalizar } from "./busca-fuzzy";

const id = (s: string) => s;

describe("busca fuzzy", () => {
  it("prefixo vence subsequência; acentos e caixa são ignorados", () => {
    expect(buscarFuzzy(["Configurações", "Nova Missão", "Missões"], "miss", id)[0]).toBe("Missões");
    expect(buscarFuzzy(["x-terminal", "Terminais", "tem ri nal"], "ter", id)[0]).toBe("Terminais");
    const r = buscarFuzzy(["Workspaces", "Método"], "mtd", id);
    expect(r).toEqual(["Método"]);
    expect(normalizar("Ação ÉÜ")).toBe("acao eu");
  });
  it("prefixo de palavra > trecho > subsequência", () => {
    const r = buscarFuzzy(["abcnovo", "x novo", "n o v o"], "novo", id);
    expect(r[0]).toBe("x novo");
    expect(r[1]).toBe("abcnovo");
    expect(buscarFuzzy(["nxoxvxo", "abcnovo"], "novo", id)).toEqual(["abcnovo", "nxoxvxo"]);
  });
  it("empate é estável e consulta vazia devolve a ordem original", () => {
    const itens = ["alfa um", "alfa dois", "alfa tres"];
    expect(buscarFuzzy(itens, "alfa", id)).toEqual(itens);
    expect(buscarFuzzy(itens, "  ", id, 2)).toEqual(itens.slice(0, 2));
  });
  it("várias palavras: todas precisam casar, em qualquer ordem", () => {
    const itens = ["Ir para Terminais", "Ir para Método", "Abrir projeto"];
    expect(buscarFuzzy(itens, "terminais ir", id)).toEqual(["Ir para Terminais"]);
    expect(buscarFuzzy(itens, "zzz", id)).toEqual([]);
  });
  it("5 000 itens em menos de 10 ms (mediana)", () => {
    const itens = Array.from({ length: 5000 }, (_, i) => `Trabalho ${i} feature exemplo de título longo número ${i * 7}`);
    const indice = criarIndice(itens, id);
    indice.buscar("trab feat", 20);
    const tempos: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t = performance.now();
      indice.buscar(k % 2 ? "tfe 42" : "exemplo titulo", 20);
      tempos.push(performance.now() - t);
    }
    tempos.sort((a, b) => a - b);
    expect(tempos[3] as number).toBeLessThan(10);
  });
});
