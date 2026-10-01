import { describe, expect, it } from "vitest";
import { montarGrafo, type NoGrafo } from "./grafo";

const no = (id: string, depende_de: string[] = [], extra: Partial<NoGrafo> = {}): NoGrafo => ({ id, depende_de, fase: null, status: "pendente", ...extra });

describe("montarGrafo", () => {
  it("arestas seguem depende_de (dependência -> dependente)", () => {
    const g = montarGrafo([no("A"), no("B", ["A"]), no("C", ["A", "B"])]);
    expect(g.arestas).toEqual([
      { de: "A", para: "B" },
      { de: "A", para: "C" },
      { de: "B", para: "C" },
    ]);
    expect(g.ciclos).toEqual([]);
    expect(g.dependencias_inexistentes).toEqual([]);
  });

  it("caminho crítico é a cadeia mais longa, calculada (ignora o declarado)", () => {
    const g = montarGrafo([no("A"), no("B", ["A"]), no("C", ["B"]), no("X"), no("Y", ["X"]), no("Z", ["C", "Y"])]);
    expect(g.caminho_critico).toEqual(["A", "B", "C", "Z"]);
  });

  it("empate é decidido de forma determinística por id", () => {
    const g = montarGrafo([no("B"), no("A"), no("C", ["A", "B"])]);
    expect(g.caminho_critico).toEqual(["A", "C"]);
  });

  it("detecta ciclo e nomeia os participantes; o caminho crítico ignora o ciclo", () => {
    const g = montarGrafo([no("A"), no("B", ["A", "D"]), no("C", ["B"]), no("D", ["C"]), no("E", ["A"])]);
    expect(g.ciclos).toHaveLength(1);
    expect([...(g.ciclos[0] ?? [])].sort()).toEqual(["B", "C", "D"]);
    expect(g.caminho_critico).toEqual(["A", "E"]);
  });

  it("auto-dependência conta como ciclo", () => {
    const g = montarGrafo([no("A", ["A"])]);
    expect(g.ciclos).toEqual([["A"]]);
  });

  it("dependência inexistente é reportada e não vira aresta", () => {
    const g = montarGrafo([no("A", ["T-99.99"]), no("B", ["A"])]);
    expect(g.dependencias_inexistentes).toEqual([{ de: "A", ate: "T-99.99" }]);
    expect(g.arestas).toEqual([{ de: "A", para: "B" }]);
    expect(g.caminho_critico).toEqual(["A", "B"]);
  });

  it("prontas: pendentes com todas as dependências concluídas", () => {
    const g = montarGrafo([
      no("A", [], { status: "concluida" }),
      no("B", ["A"]),
      no("C", ["B"]),
      no("D", [], { status: "em_andamento" }),
      no("E", ["A", "D"]),
    ]);
    expect(g.prontas).toEqual(["B"]);
  });

  it("plano com 30 tasks: caminho crítico calculado", () => {
    // 3 trilhas de 10 tasks; a trilha B tem um ramo extra que a torna a mais longa (12 tasks)
    const nos: NoGrafo[] = [];
    const id = (t: string, n: number): string => `T-${t}.${String(n).padStart(2, "0")}`;
    for (const t of ["01", "02", "03"]) {
      for (let n = 1; n <= 10; n++) nos.push(no(id(t, n), n === 1 ? [] : [id(t, n - 1)]));
    }
    // T-02.11 e T-02.12 pendurados no fim da trilha 02; T-03.01 depende de T-01.10 (junta trilhas)
    nos.push(no("T-02.11", [id("02", 10)]));
    nos.push(no("T-02.12", ["T-02.11"]));
    expect(nos).toHaveLength(32);
    const g = montarGrafo(nos.filter((n) => n.id !== "T-03.10" && n.id !== "T-03.09")); // 30 tasks
    expect(g.nos).toHaveLength(30);
    const esperado = Array.from({ length: 10 }, (_, i) => id("02", i + 1)).concat(["T-02.11", "T-02.12"]);
    expect(g.caminho_critico).toEqual(esperado);

    // agora a trilha 03 passa a depender do fim da 01: 01 (10) + 03 (8) = 18 > 12
    const nos2 = nos.filter((n) => n.id !== "T-03.10" && n.id !== "T-03.09").map((n) => (n.id === "T-03.01" ? { ...n, depende_de: [id("01", 10)] } : n));
    const g2 = montarGrafo(nos2);
    expect(g2.caminho_critico).toHaveLength(18);
    expect(g2.caminho_critico[0]).toBe("T-01.01");
    expect(g2.caminho_critico[17]).toBe("T-03.08");
  });

  it("entrada vazia e nós duplicados não quebram", () => {
    expect(montarGrafo([]).caminho_critico).toEqual([]);
    expect(() => montarGrafo([no("A"), no("A", ["B"])])).not.toThrow();
  });

  it("nunca lança para depende_de malformado", () => {
    expect(() => montarGrafo([{ id: "A", depende_de: null as unknown as string[], fase: null, status: null }])).not.toThrow();
  });
});
