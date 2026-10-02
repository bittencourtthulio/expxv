import { describe, expect, it } from "vitest";
import { ALTURA, MAX_PONTOS_SERIE, amostrarIndices, contarNos, decimar, escalaLinear, graficoBarras, graficoBarrasHorizontais, graficoDispersao, graficoLinhas, graficoPrevisao, graficoSaude, indicesDeRotulo, no, paraString, passoBonito, ticksY } from "./index";

describe("escalas", () => {
  it("escala linear mapeia o domínio para a faixa (e domínio degenerado vai ao meio)", () => {
    const e = escalaLinear(0, 10, 100, 0);
    expect(e(0)).toBe(100); expect(e(10)).toBe(0); expect(e(5)).toBe(50);
    expect(escalaLinear(3, 3, 0, 10)(3)).toBe(5);
  });
  it("ticks bonitos cobrem o máximo e começam em zero", () => {
    const t = ticksY(0, 37);
    expect(t.ticks[0]).toBe(0);
    expect(t.max).toBeGreaterThanOrEqual(37);
    expect(passoBonito(100, 5)).toBe(20);
    expect(ticksY(0, 0).ticks.length).toBeGreaterThan(1);
  });
  it("rótulos do eixo X: no máximo alvo e sempre o primeiro e o último", () => {
    const i = indicesDeRotulo(100, 8);
    expect(i.length).toBeLessThanOrEqual(9);
    expect(i[0]).toBe(0); expect(i[i.length - 1]).toBe(99);
    expect(indicesDeRotulo(0)).toEqual([]);
  });
});

describe("decimação", () => {
  it("nunca passa do limite e preserva picos e vales", () => {
    const pontos = Array.from({ length: 5000 }, (_, i) => ({ i, v: i === 1234 ? 999 : i === 3456 ? -50 : Math.sin(i / 50) * 10 }));
    const d = decimar(pontos, 600, (p) => p.v);
    expect(d.length).toBeLessThanOrEqual(600);
    expect(d.some((p) => p.v === 999)).toBe(true);
    expect(d.some((p) => p.v === -50)).toBe(true);
    expect(d[0]?.i).toBe(0); expect(d[d.length - 1]?.i).toBe(4999);
    expect(d.map((p) => p.i)).toEqual([...d.map((p) => p.i)].sort((a, b) => a - b));
  });
  it("série curta passa intacta e valores nulos não quebram", () => {
    expect(decimar([1, 2, 3], 600, (x) => x)).toEqual([1, 2, 3]);
    const com = Array.from({ length: 2000 }, (_, i) => (i % 7 === 0 ? null : i));
    expect(decimar(com, 100, (x) => x).length).toBeLessThanOrEqual(100);
    expect(amostrarIndices(10000, 300).length).toBeLessThanOrEqual(300);
  });
});

describe("serialização e construtores", () => {
  it("paraString escapa texto e atributos e omite undefined", () => {
    expect(paraString(no("text", { x: 1, y: undefined, "data-tip": `a"b<c&'` }, "1 < 2 & 'x'"))).toBe(`<text x="1" data-tip="a&quot;b&lt;c&amp;&#x27;">1 &lt; 2 &amp; &#x27;x&#x27;</text>`);
  });
  it("gráfico de linhas com 5 000 pontos respeita o orçamento de elementos e traz title/desc", () => {
    const n = 5000;
    const g = graficoLinhas({ id: "t", titulo: "Teste", desc: "Descrição", rotulosX: Array.from({ length: n }, (_, i) => `d${i}`), unidade: "x", series: [{ rotulo: "A", valores: Array.from({ length: n }, (_, i) => Math.sin(i / 20) * 10 + 20) }, { rotulo: "B", valores: Array.from({ length: n }, (_, i) => i / 100), modo: "degrau" }] });
    expect(contarNos(g)).toBeLessThanOrEqual(1500);
    const s = paraString(g);
    expect(s).toContain("<title id=\"t-t\">Teste</title>");
    expect(s).toContain("<desc id=\"t-d\">Descrição</desc>");
    expect(s).toContain('role="img"');
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/); // nenhuma cor literal: só classes e url(#padrão)
  });
  it("toda série tem padrão ou tracejado além da cor (barras usam <pattern>, linhas usam dasharray)", () => {
    const b = paraString(graficoBarras({ id: "b", titulo: "B", desc: "d", categorias: ["a", "b"], series: [{ rotulo: "x", valores: [1, 2] }, { rotulo: "y", valores: [2, 1] }], unidade: "u" }));
    expect(b).toContain("<pattern");
    expect(b).toContain('fill="url(#b-p1)"');
    expect(b).toContain('fill="url(#b-p2)"');
    const l = paraString(graficoLinhas({ id: "l", titulo: "L", desc: "d", rotulosX: ["a", "b", "c"], unidade: "u", series: [{ rotulo: "x", valores: [1, 2, 3] }, { rotulo: "y", valores: [3, 2, 1] }] }));
    expect(l).toContain("stroke-dasharray");
  });
  it("tooltips ficam em data-tip e as áreas de interação são limitadas", () => {
    const g = graficoDispersao({ id: "d", titulo: "D", desc: "d", pontos: Array.from({ length: 3000 }, (_, i) => ({ x: i, y: i % 17, tip: `p${i}` })), rotuloX: "x", rotuloY: "y", refsY: [{ valor: 5, rotulo: "P50" }] });
    expect(contarNos(g)).toBeLessThanOrEqual(1500);
    expect(paraString(g)).toContain('data-tip="p0"');
  });
  it("saúde, previsão e barras horizontais montam sem lançar e usam forma além da cor", () => {
    const s = paraString(graficoSaude({ id: "s", titulo: "S", desc: "d", linhas: [{ cor: "verde", frase: "ok", fato: "f" }, { cor: "amarelo", frase: "a", fato: "f" }, { cor: "vermelho", frase: "v", fato: "f" }] }));
    expect(s).toContain("<circle"); expect(s).toContain("<path"); expect(s).toContain("<rect");
    expect(paraString(graficoPrevisao({ id: "p", titulo: "P", desc: "d", p50: 3, p85: 5, p95: 8, r50: "P50", r85: "P85", r95: "P95", unidade: "dias" }))).toContain("P95");
    expect(paraString(graficoBarrasHorizontais({ id: "h", titulo: "H", desc: "d", unidade: "%", normalizar: true, grupos: [{ rotulo: "Risco", partes: [{ rotulo: "baixo", valor: 3 }, { rotulo: "alto", valor: 1 }] }] }))).toContain("25 %");
  });
  it("série vazia ou só com nulos não quebra", () => {
    expect(() => paraString(graficoLinhas({ id: "v", titulo: "V", desc: "d", rotulosX: [], unidade: "u", series: [] }))).not.toThrow();
    expect(() => paraString(graficoLinhas({ id: "v", titulo: "V", desc: "d", rotulosX: ["a"], unidade: "u", series: [{ rotulo: "x", valores: [null] }] }))).not.toThrow();
    expect(ALTURA).toBeGreaterThan(0); expect(MAX_PONTOS_SERIE).toBe(600);
  });
});

describe("modo fluido (medida real do contêiner)", () => {
  it("dimDe: legado sem largura; fluido usa a medida e reserva margem para rótulos diretos", async () => {
    const { dimDe, espalharRotulos, quebrarLegenda } = await import("./index");
    expect(dimDe({}).W).toBe(640);
    const f = dimDe({ largura: 400, altura: 200 }, { direto: 60 });
    expect(f).toMatchObject({ W: 400, H: 200, fluido: true }); expect(f.r).toBe(70);
    expect(espalharRotulos([10, 12, 14], 14, 0, 100)).toEqual([0, 14, 28].map((v) => v + 0).map((_, i) => [10, 24, 38][i]));
    expect(espalharRotulos([95, 99], 14, 0, 100).every((y) => y <= 100)).toBe(true);
    const q = quebrarLegenda(200, ["Aaaaaaaaaa", "Bbbbbbbbbb", "Cccccccccc"]);
    expect(q.linhas).toBeGreaterThan(1);
  });
  it("viewBox acompanha a largura, sem unidade no eixo e com rótulo direto no fim da série", () => {
    const s = paraString(graficoLinhas({ id: "f", titulo: "F", desc: "d", largura: 420, altura: 220, rotuloDireto: true, rotulosX: ["a", "b", "c"], unidade: "pts", series: [{ rotulo: "Restante", valores: [3, 2, 1] }, { rotulo: "Ideal", valores: [3, 2, 0] }] }));
    expect(s).toContain('viewBox="0 0 420 220"');
    expect(s).not.toContain('class="rot unidade"');
    expect(s).toContain("rot-serie"); expect(s).not.toContain('class="legenda"');
    expect(contarNos(graficoBarras({ id: "b", titulo: "B", desc: "d", largura: 300, altura: 160, categorias: ["a", "b"], series: [{ rotulo: "x", valores: [1, 2] }], unidade: "u" }))).toBeGreaterThan(5);
  });
  it("último rótulo do eixo X não encosta no penúltimo", () => {
    const i = indicesDeRotulo(12, 5);
    expect(i[i.length - 1]).toBe(11);
    for (let k = 1; k < i.length; k++) expect((i[k] as number) - (i[k - 1] as number)).toBeGreaterThanOrEqual(2);
  });
});
