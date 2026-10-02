import { describe, expect, it } from "vitest";
import {
  ATIVIDADE_RECENTE_MS, criarAvaliadorEsforco, criarContadorVazao, criarJanelaTokens, DESCER_NIVEL_MS, descreverEsforco, nivelBruto, nivelPorBytes, nivelPorTokens, type NivelEsforco,
} from "./esforco";

describe("contador de vazão por sessão (janela deslizante, sem conteúdo)", () => {
  it("taxa de bytes e linhas por segundo na janela de 4 s", () => {
    const c = criarContadorVazao();
    c.registrar(2_000, 20, 10_000);
    c.registrar(2_000, 20, 11_000);
    expect(c.taxa(11_500)).toEqual({ bytesPorS: 1_000, linhasPorS: 10 });
    expect(c.ultimoEm).toBe(11_000);
  });
  it("pico curto não fica para sempre: sai da janela depois de 4 s e o silêncio zera", () => {
    const c = criarContadorVazao();
    c.registrar(40_000, 400, 1_000);
    expect(c.taxa(1_200).bytesPorS).toBe(10_000);
    expect(c.taxa(4_900).bytesPorS).toBeGreaterThan(0);
    expect(c.taxa(5_100)).toEqual({ bytesPorS: 0, linhasPorS: 0 });
  });
  it("reaproveita o balde depois de uma volta do anel (sem acumular lixo)", () => {
    const c = criarContadorVazao();
    c.registrar(100, 1, 0);
    c.registrar(50, 1, 4_000);
    expect(c.taxa(4_000).bytesPorS).toBe(12.5);
  });
  it("não guarda conteúdo: só aceita números", () => {
    const c = criarContadorVazao();
    c.registrar(10, 1, 100);
    expect(Object.keys(c).sort()).toEqual(["registrar", "taxa", "ultimoEm"]);
  });
  it("valores negativos viram 0", () => {
    const c = criarContadorVazao();
    c.registrar(-5, -1, 100);
    expect(c.taxa(100).bytesPorS).toBe(0);
  });
});

describe("janela de tokens/min", () => {
  it("soma o último minuto e esquece o resto", () => {
    const j = criarJanelaTokens();
    j.somar(3_000, 0);
    j.somar(1_200, 30_000);
    expect(j.porMinuto(30_000)).toBe(4_200);
    expect(j.porMinuto(61_000)).toBe(1_200);
    expect(j.porMinuto(95_000)).toBe(0);
    expect(j.ultimoEm).toBe(30_000);
  });
  it("ignora NaN, zero e negativos", () => {
    const j = criarJanelaTokens();
    j.somar(Number.NaN, 1); j.somar(0, 1); j.somar(-4, 1);
    expect(j.porMinuto(2)).toBe(0);
  });
});

describe("curva intensidade × taxa (tabela)", () => {
  const bytes: Array<[number, NivelEsforco]> = [[0, 0], [0.5, 0], [1, 1], [29, 1], [30, 2], [599, 2], [600, 3], [3_999, 3], [4_000, 4], [900_000, 4]];
  for (const [b, n] of bytes) it(`${b} B/s → nível ${n}`, () => expect(nivelPorBytes(b)).toBe(n));
  const tokens: Array<[number, NivelEsforco]> = [[0, 0], [1, 1], [499, 1], [500, 2], [2_499, 2], [4_200, 3], [11_999, 3], [12_000, 4], [1_000_000, 4]];
  for (const [t, n] of tokens) it(`${t} tokens/min → nível ${n}`, () => expect(nivelPorTokens(t)).toBe(n));

  it("combina: vale a maior das taxas; origem medida quando os tokens mandam, estimada quando a saída manda", () => {
    expect(nivelBruto({ tokensPorMin: 4_200, bytesPorS: 5, sessoesFluindo: 1, entradaRecente: false })).toEqual({ nivel: 3, origem: "medido" });
    expect(nivelBruto({ tokensPorMin: null, bytesPorS: 700, sessoesFluindo: 1, entradaRecente: false })).toEqual({ nivel: 3, origem: "estimado" });
    expect(nivelBruto({ tokensPorMin: 10, bytesPorS: 700, sessoesFluindo: 1, entradaRecente: false })).toEqual({ nivel: 3, origem: "estimado" });
  });
  it("3 ou mais sessões fluindo sobem um nível (máximo 4); sem fluxo não há bônus", () => {
    expect(nivelBruto({ tokensPorMin: null, bytesPorS: 100, sessoesFluindo: 3, entradaRecente: false }).nivel).toBe(3);
    expect(nivelBruto({ tokensPorMin: null, bytesPorS: 100000, sessoesFluindo: 5, entradaRecente: false }).nivel).toBe(4);
    expect(nivelBruto({ tokensPorMin: null, bytesPorS: 0, sessoesFluindo: 5, entradaRecente: false }).nivel).toBe(0);
  });
  it("entrada do usuário sozinha = atento", () => {
    expect(nivelBruto({ tokensPorMin: null, bytesPorS: 0, sessoesFluindo: 0, entradaRecente: true })).toMatchObject({ nivel: 1 });
  });
  it("monotônico: mais saída nunca reduz o nível", () => {
    let anterior = 0;
    for (let b = 0; b < 20_000; b += 7) { const n = nivelBruto({ tokensPorMin: null, bytesPorS: b, sessoesFluindo: 1, entradaRecente: false }).nivel; expect(n).toBeGreaterThanOrEqual(anterior); anterior = n; }
  });
});

describe("histerese e piso de atividade", () => {
  it("sobe na hora e desce um nível por 6 s", () => {
    const a = criarAvaliadorEsforco();
    expect(a.avaliar(4, 1_000, 1_000)).toBe(4);
    expect(a.avaliar(0, 1_000, 1_000 + DESCER_NIVEL_MS - 1)).toBe(4);
    expect(a.avaliar(0, 1_000, 1_000 + DESCER_NIVEL_MS)).toBe(3);
    expect(a.avaliar(0, 1_000, 1_000 + DESCER_NIVEL_MS + 1)).toBe(3);
    expect(a.avaliar(0, 1_000, 1_000 + 2 * DESCER_NIVEL_MS)).toBe(2);
  });
  it("não pisca: oscilação entre 4 e 2 mantém 4", () => {
    const a = criarAvaliadorEsforco();
    const vistos: number[] = [];
    for (let i = 0; i < 12; i++) vistos.push(a.avaliar(i % 2 === 0 ? 4 : 2, i * 1_000, i * 1_000));
    expect(new Set(vistos)).toEqual(new Set([4]));
  });
  it("nunca fica abaixo de 'atento' com atividade há menos de 20 s, mesmo com taxa zero", () => {
    const a = criarAvaliadorEsforco();
    a.avaliar(0, 5_000, 5_000);
    for (let t = 5_000; t < 5_000 + ATIVIDADE_RECENTE_MS; t += 500) expect(a.avaliar(0, 5_000, t)).toBeGreaterThanOrEqual(1);
    expect(a.avaliar(0, 5_000, 5_000 + ATIVIDADE_RECENTE_MS + DESCER_NIVEL_MS)).toBe(0);
  });
  it("sem nenhuma atividade registrada o nível é 0", () => expect(criarAvaliadorEsforco().avaliar(0, 0, 50_000)).toBe(0));
});

describe("texto do esforço", () => {
  const f = (n: number): string => `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  it("medido mostra tokens/min; estimado diz saída intensa; sem dado sensível", () => {
    expect(descreverEsforco(3, "medido", 4_200, f)).toBe("acelerado · ~4,2 mil tokens/min");
    expect(descreverEsforco(3, "estimado", null, f)).toBe("acelerado · saída intensa");
    expect(descreverEsforco(4, "estimado", null, f)).toBe("frenético · saída intensa");
    expect(descreverEsforco(2, "estimado", null, f)).toBe("trabalhando · saída contínua");
    expect(descreverEsforco(0, "nenhuma", null, f)).toBe("parado");
  });
});
