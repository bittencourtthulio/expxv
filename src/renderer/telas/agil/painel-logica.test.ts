import { describe, expect, it } from "vitest";
import { painelFalso, painelVazio } from "./fabrica-teste";
import { calcularAtencao, calcularKpis, caminhoSpark, colunasParaLargura, deltaPontos, deltaRelativo, diaMes, duracaoCurta, empacotar, numeroBr, planejarBento, reduzirSerie } from "./painel-logica";

describe("formatação", () => {
  it("números em PT-BR e durações curtas", () => {
    expect(numeroBr(11.5)).toBe("11,5"); expect(numeroBr(12, 1)).toBe("12");
    expect(duracaoCurta(30 * 60_000)).toBe("30 min"); expect(duracaoCurta(3_600_000 * 4.2)).toBe("4,2 h"); expect(duracaoCurta(3_600_000 * 72)).toBe("3 d");
    expect(diaMes("2026-10-02")).toBe("02/10"); expect(diaMes(null)).toBe("—");
  });
});

describe("delta", () => {
  it("relativo: direção, tom conforme maisEBom e estável abaixo do limiar", () => {
    expect(deltaRelativo(120, 100, true)).toEqual({ texto: "+20 %", tom: "bom", direcao: "sobe" });
    expect(deltaRelativo(120, 100, false)?.tom).toBe("ruim");
    expect(deltaRelativo(80, 100, true)).toEqual({ texto: "−20 %", tom: "ruim", direcao: "desce" });
    expect(deltaRelativo(101, 100, true)?.direcao).toBe("igual");
    expect(deltaRelativo(5, null, true)).toBeNull();
    expect(deltaRelativo(0, 0, true)?.texto).toBe("estável");
  });
  it("em pontos percentuais", () => {
    expect(deltaPontos(0.25, 0.18, false)).toEqual({ texto: "+7 pp", tom: "ruim", direcao: "sobe" });
    expect(deltaPontos(0.18, 0.18, false)?.direcao).toBe("igual");
  });
});

describe("micrográfico", () => {
  it("caminho dentro da caixa, nulos ignorados, série constante no meio", () => {
    const { d, ultimo } = caminhoSpark([0, 5, null, 10], 100, 20, 2);
    expect(d.startsWith("M2 18")).toBe(true);
    expect(ultimo).toEqual({ x: 98, y: 2 });
    expect(caminhoSpark([3, 3, 3], 100, 20).ultimo?.y).toBe(10);
    expect(caminhoSpark([], 10, 10)).toEqual({ d: "", ultimo: null });
  });
  it("reduz por médias de baldes", () => {
    expect(reduzirSerie([1, 2, 3, 4], 2)).toEqual([1.5, 3.5]);
    expect(reduzirSerie([1, 2], 5)).toEqual([1, 2]);
    expect(reduzirSerie(Array.from({ length: 1000 }, (_, i) => i), 24)).toHaveLength(24);
  });
});

describe("indicadores-chave", () => {
  it("seis indicadores com dados do painel", () => {
    const k = calcularKpis(painelFalso());
    expect(k.map((x) => x.id)).toEqual(["progresso", "velocidade", "cycle", "wip", "retrabalho", "previsao"]);
    expect(k.every((x) => !x.vazio)).toBe(true);
    const wip = k.find((x) => x.id === "wip")!;
    expect(wip.sufixo).toBe("/ 4"); expect(wip.medidor).toBeGreaterThan(0);
    expect(k.find((x) => x.id === "previsao")!.valor).toBe("25/03");
    expect(k.find((x) => x.id === "retrabalho")!.valor).toBe("20 %");
  });
  it("sem dados: todos vazios, com orientação em vez de zero", () => {
    const k = calcularKpis(painelVazio());
    expect(k.every((x) => x.vazio && x.valor === "—")).toBe(true);
    expect(k.find((x) => x.id === "progresso")!.nota).toBe("Sem sprint ativa");
  });
  it("WIP acima do limite vira alerta; no limite, aviso", () => {
    const base = painelFalso();
    const com = (v: number) => calcularKpis({ ...base, wip: { ...base.wip, dias: [{ dia: "2026-03-02", valor: v }], limite: 4 } }).find((x) => x.id === "wip")!;
    expect(com(5).tom).toBe("alerta"); expect(com(4).tom).toBe("aviso"); expect(com(2).tom).toBe("normal");
  });
});

describe("pede atenção", () => {
  it("ordena por idade e por retrabalho e lista o que falta de dado", () => {
    const g = calcularAtencao(painelFalso());
    expect(g[0]!.itens.map((i) => i.id)).toEqual(["tr/T-01", "tr/T-02"]);
    expect(g[1]!.itens[0]!.id).toBe("bug");
    expect(g[2]!.itens.map((i) => i.id)).toEqual(["sem_estimativa", "sem_rastro"]);
    expect(calcularAtencao(painelVazio())[2]!.itens).toEqual([]);
  });
});

describe("malha bento", () => {
  it("empacotar fecha cada linha em 12 colunas, sem buracos", () => {
    const linhas = empacotar([{ id: "a", span: 5 }, { id: "b", span: 4 }, { id: "c", span: 3 }, { id: "d", span: 7 }, { id: "e", span: 4 }], 12);
    for (const l of linhas) expect(l.reduce((a, b) => a + b.span, 0)).toBe(12);
    expect(linhas.map((l) => l.map((b) => b.id))).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(empacotar([{ id: "x", span: 4 }], 12)[0]![0]!.span).toBe(12);
  });
  const todos = ["burndown", "burnup", "velocidade", "cfd", "cycle", "lead", "throughput", "wip", "retrabalho", "planejado", "defeitos", "distribuicao", "previsao", "saude", "erro-estimativa", "valor-esforco"].map((id) => ({ id, vazio: false }));
  it("herói + lateral primeiro; todo bloco aparece uma vez; linhas fechadas", () => {
    const p = planejarBento([...todos, { id: "atencao", vazio: false }], 12);
    expect(p.slice(0, 3).map((b) => [b.id, b.papel, b.span])).toEqual([["burndown", "heroi", 8], ["saude", "lateral", 4], ["atencao", "lateral", 4]]);
    expect(new Set(p.map((b) => b.id)).size).toBe(17);
    const resto = p.filter((b) => b.papel === "bloco");
    let soma = 0; for (const b of resto) { soma += b.span; if (soma === 12) soma = 0; else expect(soma).toBeLessThan(12); }
    expect(soma).toBe(0);
  });
  it("sem sprint: o herói passa para um gráfico com dados e os vazios vão para o fim", () => {
    const e = todos.map((g) => ({ ...g, vazio: ["burndown", "burnup", "saude", "planejado"].includes(g.id) }));
    const p = planejarBento([...e, { id: "atencao", vazio: false }], 12);
    expect(p[0]).toMatchObject({ id: "cfd", papel: "heroi" });
    expect(p.filter((b) => b.papel === "lateral").map((b) => [b.id, b.span, b.linhas])).toEqual([["atencao", 4, 2]]);
    expect(p.slice(-4).every((b) => b.papel === "vazio")).toBe(true);
  });
  it("tudo vazio: o burndown vira o herói com a orientação; método sem herói usa a atenção como bloco", () => {
    expect(planejarBento([{ id: "burndown", vazio: true }, { id: "atencao", vazio: false }], 12)[0]).toMatchObject({ id: "burndown", papel: "heroi" });
    const xp = planejarBento([{ id: "retrabalho", vazio: false }, { id: "defeitos", vazio: false }, { id: "atencao", vazio: false }], 12);
    expect(xp.every((b) => b.papel === "bloco")).toBe(true);
    expect(xp.map((b) => b.id)[0]).toBe("atencao");
  });
  it("6 colunas e 1 coluna", () => {
    const p6 = planejarBento([...todos, { id: "atencao", vazio: false }], 6);
    expect(p6[0]).toMatchObject({ papel: "heroi", span: 6, linhas: 1 });
    expect(p6.every((b) => b.span <= 6)).toBe(true);
    expect(planejarBento([...todos, { id: "atencao", vazio: false }], 1).every((b) => b.span === 1)).toBe(true);
  });
  it("colunas conforme a largura", () => {
    expect([colunasParaLargura(0), colunasParaLargura(1000), colunasParaLargura(700), colunasParaLargura(400)]).toEqual([12, 12, 6, 1]);
  });
});
