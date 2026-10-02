import { describe, expect, it } from "vitest";
import { ajustarContain, mensagemDeCaptura, paraDataUrl, paraLogico, rotuloDaCaptura, selecaoLogica, selecaoPequena, textoMira, textoQuadros } from "./logica";
import { adicionar, desenhar, desfazer, historicoVazio, pontasDaSeta, refazer, temMudanca, type Ctx2D } from "./anotacoes";

describe("mapeamento da seleção", () => {
  it("contain: imagem 1440x900 numa área 1440x900 é identidade; numa área maior centraliza", () => {
    expect(ajustarContain(1440, 900, 1440, 900)).toEqual({ x: 0, y: 0, escala: 1 });
    const a = ajustarContain(2000, 900, 1000, 900);
    expect(a).toEqual({ x: 500, y: 0, escala: 1 });
    expect(ajustarContain(0, 0, 10, 10)).toEqual({ x: 0, y: 0, escala: 1 });
  });
  it("ponto da tela vira ponto lógico, preso à imagem", () => {
    const a = ajustarContain(2000, 900, 1000, 900);
    expect(paraLogico({ x: 500, y: 0 }, a, 1000, 900)).toEqual({ x: 0, y: 0 });
    expect(paraLogico({ x: 100, y: -50 }, a, 1000, 900)).toEqual({ x: 0, y: 0 });
    expect(paraLogico({ x: 9999, y: 9999 }, a, 1000, 900)).toEqual({ x: 1000, y: 900 });
  });
  it("seleção em qualquer direção e com escala (imagem reduzida na tela)", () => {
    const a = ajustarContain(720, 450, 1440, 900); // escala 0.5
    expect(selecaoLogica({ x: 150, y: 100 }, { x: 50, y: 50 }, a, 1440, 900)).toEqual({ x: 100, y: 100, largura: 200, altura: 100 });
  });
  it("menor que 5x5 é pequena", () => {
    expect(selecaoPequena({ x: 0, y: 0, largura: 4, altura: 50 })).toBe(true);
    expect(selecaoPequena({ x: 0, y: 0, largura: 5, altura: 5 })).toBe(false);
  });
});

describe("textos", () => {
  it("leitor da mira e indicador de quadros", () => {
    expect(textoMira({ x: 10.4, y: 20.6 }, null)).toBe("10,21");
    expect(textoMira({ x: 1, y: 2 }, { x: 0, y: 0, largura: 30, altura: 40 })).toBe("1,2 · 30x40");
    expect(textoQuadros(12, 60, 2)).toBe("● 12/60 · 2 fps");
  });
  it("mensagens: instrução do main vence; sem ela vale o texto padrão", () => {
    expect(mensagemDeCaptura("permissao_tela_negada", "Reabra o app.")).toBe("Reabra o app.");
    expect(mensagemDeCaptura("sem_janela")).toMatch(/janela/);
    expect(rotuloDaCaptura("2026-10-01_10-00-09")).toBe("01/10 10:00:09");
    expect(rotuloDaCaptura("q_2026-10-01_10-00-09-2")).toBe("01/10 10:00:09 · quadros");
  });
  it("dataURL base64 de bytes grandes sem estourar a pilha", () => {
    const u = paraDataUrl(new Uint8Array(100_000).fill(65), "png");
    expect(u.startsWith("data:image/png;base64,")).toBe(true);
    expect(atob(u.split(",")[1]!).length).toBe(100_000);
  });
});

describe("anotações", () => {
  const seta = { tipo: "seta" as const, de: { x: 0, y: 0 }, para: { x: 10, y: 0 } };
  it("adicionar, desfazer e refazer; nova forma limpa o refazer; sem mudança = nada a gravar", () => {
    let h = historicoVazio();
    expect(temMudanca(h)).toBe(false);
    h = adicionar(h, seta);
    h = adicionar(h, { tipo: "retangulo", de: { x: 1, y: 1 }, para: { x: 5, y: 5 } });
    expect(h.formas).toHaveLength(2);
    h = desfazer(h);
    expect(h.formas).toHaveLength(1);
    expect(h.refazer).toHaveLength(1);
    expect(refazer(h).formas).toHaveLength(2);
    h = adicionar(h, { tipo: "caneta", pontos: [{ x: 0, y: 0 }, { x: 3, y: 3 }] });
    expect(h.refazer).toHaveLength(0);
    expect(desfazer(historicoVazio())).toEqual(historicoVazio());
    expect(temMudanca(desfazer(desfazer(desfazer(h))))).toBe(false);
  });
  it("recusa texto vazio/gigante e caneta de um ponto", () => {
    const h = historicoVazio();
    expect(adicionar(h, { tipo: "texto", em: { x: 0, y: 0 }, texto: "  " })).toBe(h);
    expect(adicionar(h, { tipo: "texto", em: { x: 0, y: 0 }, texto: "x".repeat(201) })).toBe(h);
    expect(adicionar(h, { tipo: "caneta", pontos: [{ x: 0, y: 0 }] })).toBe(h);
  });
  it("desenha em vermelho com a escala pedida; seta tem corpo e duas hastes", () => {
    const chamadas: string[] = [];
    const ctx = new Proxy({ strokeStyle: "", fillStyle: "", lineWidth: 0, lineCap: "", lineJoin: "", font: "", textBaseline: "" } as unknown as Ctx2D, {
      get: (alvo, p: string) => (p in alvo ? (alvo as unknown as Record<string, unknown>)[p] : (...a: unknown[]) => void chamadas.push(`${p}(${a.map((x) => (typeof x === "number" ? Math.round(x) : x)).join(",")})`)),
      set: (alvo, p: string, v) => { (alvo as unknown as Record<string, unknown>)[p] = v; return true; },
    });
    desenhar(ctx, [seta, { tipo: "retangulo", de: { x: 10, y: 10 }, para: { x: 0, y: 4 } }, { tipo: "texto", em: { x: 2, y: 3 }, texto: "bug" }], 2);
    expect((ctx as unknown as { strokeStyle: string }).strokeStyle).toBe("crimson");
    expect(chamadas.filter((c) => c.startsWith("lineTo")).length).toBe(3); // corpo + 2 hastes
    expect(chamadas).toContain("strokeRect(0,8,20,12)");
    expect(chamadas).toContain("fillText(bug,4,6)");
    const [a, b] = pontasDaSeta({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(a.x).toBeLessThan(100);
    expect(a.y).toBeCloseTo(-b.y);
  });
});
