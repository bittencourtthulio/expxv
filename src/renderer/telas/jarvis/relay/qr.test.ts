import { describe, expect, it } from "vitest";
import { capacidadeBytes, logGf, codewords, formatoBits, gerarQr, penalidade, polinomioGerador, qrParaCaminho, restoRS, versaoBits } from "./qr";

describe("QR: primitivas com respostas conhecidas", () => {
  it("polinômio gerador do grau 7 (norma ISO 18004) e o resto RS de um bloco conhecido", () => {
    expect(polinomioGerador(7).map(logGf)).toEqual([87, 229, 146, 149, 238, 102, 21]);
    // exemplo clássico: «HELLO WORLD» 1-M tem 10 bytes de correção
    const dados = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(restoRS(dados, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it("BCH do formato (nível M) e da versão", () => {
    expect(formatoBits(0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatoBits(1).toString(2).padStart(15, "0")).toBe("101000100100101");
    expect(versaoBits(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
  });
  it("capacidades do modo byte, nível M", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(capacidadeBytes)).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  });
  it("codewords: tamanho total (dados + correção) por versão", () => {
    const total = (v: number): number => codewords(new TextEncoder().encode("x"), v).length;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(total)).toEqual([26, 44, 70, 100, 134, 172, 196, 242, 292, 346]);
  });
});

describe("QR: matriz", () => {
  it("tamanho 17+4v, finders nos três cantos, timing, módulo escuro, determinístico", () => {
    const q = gerarQr("https://pwa.exemplo.dev/app#r=x");
    expect(q.tamanho).toBe(17 + 4 * q.versao);
    const m = q.modulos;
    for (const [x, y] of [[0, 0], [q.tamanho - 7, 0], [0, q.tamanho - 7]] as const) {
      expect(m[y]![x]).toBe(true);
      expect(m[y + 3]![x + 3]).toBe(true);
      expect(m[y + 1]![x + 1]).toBe(false);
    }
    for (let i = 8; i < q.tamanho - 8; i++) expect(m[6]![i]).toBe(i % 2 === 0);
    expect(m[q.tamanho - 8]![8]).toBe(true);
    expect(gerarQr("https://pwa.exemplo.dev/app#r=x").modulos).toEqual(m);
    expect(penalidade(m)).toBeGreaterThan(0);
  });
  it("versão cresce com o texto; acima de 213 bytes recusa; caminho SVG tem a zona de silêncio", () => {
    expect(gerarQr("x".repeat(14)).versao).toBe(1);
    expect(gerarQr("x".repeat(15)).versao).toBe(2);
    expect(gerarQr("x".repeat(213)).versao).toBe(10);
    expect(() => gerarQr("x".repeat(214))).toThrow("texto_grande_demais");
    const q = gerarQr("oi");
    const c = qrParaCaminho(q);
    expect(c.lado).toBe(q.tamanho + 8);
    expect(c.caminho.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
