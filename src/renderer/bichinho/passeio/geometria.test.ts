import { describe, expect, it } from "vitest";
import { chaoDe, criarSorteio, escolherLugar, hash32, lugaresDeSono, limitarX, pontoNoChao, posicaoDaParada, prenderRetangulo, caixaNoLugar, duracaoDoTrecho, type Ambiente } from "./geometria";

const amb = (o: Partial<Ambiente> = {}): Ambiente => ({ area: { largura: 1280, altura: 800, chao: chaoDe(800, 26) }, painel: null, cartoes: [], topo: null, ...o });

describe("geometria do passeio", () => {
  it("chão = borda de cima do rodapé; x nunca sai da janela", () => {
    expect(chaoDe(800, 26)).toBe(774);
    expect(limitarX(-50, { largura: 1280 }, 44)).toBe(32);
    expect(limitarX(5000, { largura: 1280 }, 44)).toBe(1280 - 32);
    for (let u = 0; u <= 1; u += 0.1) { const l = pontoNoChao(amb().area, 44, u); expect(l.x).toBeGreaterThanOrEqual(32); expect(l.x).toBeLessThanOrEqual(1248); expect(l.y).toBe(774); }
  });
  it("lugares de sono: cantos, rodapé, lado do painel, topo de cartões e sob o topo, todos dentro da janela", () => {
    const l = lugaresDeSono(amb({ painel: { left: 56, top: 40, right: 300, bottom: 774 }, cartoes: [{ left: 60, top: 100, right: 290, bottom: 180 }, { left: 60, top: 190, right: 290, bottom: 270 }], topo: { left: 0, top: 0, right: 1280, bottom: 40 } }), 44);
    const ids = l.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["canto_esquerdo", "canto_direito", "sobre_rodape", "lado_do_painel", "cartao_0", "cartao_1", "sob_o_topo"]));
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of l) { expect(x.x).toBeGreaterThan(0); expect(x.x).toBeLessThan(1280); expect(x.y).toBeGreaterThan(0); expect(x.y).toBeLessThanOrEqual(774); }
    expect(lugaresDeSono(amb(), 44).map((x) => x.id)).not.toContain("lado_do_painel");
  });
  it("escolha determinística por semente do workspace e nunca dois no mesmo lugar", () => {
    const lugares = lugaresDeSono(amb(), 44);
    const a = escolherLugar(lugares, hash32("ws_a"), new Set());
    expect(escolherLugar(lugares, hash32("ws_a"), new Set())).toEqual(a);
    const usados = new Set<string>();
    for (const ws of ["ws_a", "ws_b", "ws_c", "ws_d", "ws_a2"]) { const l = escolherLugar(lugares, hash32(ws), usados)!; expect(usados.has(l.id)).toBe(false); usados.add(l.id); }
    expect(escolherLugar([], 1, new Set())).toBeNull();
    expect(hash32("x")).toBe(hash32("x"));
    expect(hash32("x")).not.toBe(hash32("y"));
  });
  it("sorteio semeado é reproduzível e fica em [0,1)", () => {
    const a = criarSorteio(42), b = criarSorteio(42);
    for (let i = 0; i < 50; i++) { const v = a(); expect(v).toBe(b()); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it("caixa no lugar: pés um pouco abaixo da base; parada: fila centralizada; trecho: duração limitada", () => {
    expect(caixaNoLugar({ x: 100, y: 500 }, 44)).toEqual({ x: 78, y: 460 });
    const p = [0, 1, 2].map((i) => posicaoDaParada(amb().area, 44, i, 3));
    expect((p[0]!.x + p[2]!.x) / 2).toBeCloseTo(640, 0);
    expect(duracaoDoTrecho(10, 100, 600, 9000)).toBe(600);
    expect(duracaoDoTrecho(100000, 100, 600, 9000)).toBe(9000);
  });
  it("prende o retângulo dentro do recorte", () => {
    const r = { left: 100, top: 100, right: 140, bottom: 130 };
    const lim = { left: 90, top: 90, right: 200, bottom: 200 };
    const d = prenderRetangulo(r, 500, -500, lim);
    expect(r.right + d.dx).toBeLessThanOrEqual(200);
    expect(r.top + d.dy).toBeGreaterThanOrEqual(90);
    expect(prenderRetangulo(r, 5, 5, { left: 120, top: 120, right: 130, bottom: 125 })).toEqual({ dx: 0, dy: 0 });
  });
});
