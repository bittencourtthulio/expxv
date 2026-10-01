import { describe, expect, it } from "vitest";
import { NOS_MAXIMOS, PROFUNDIDADE_MAXIMA, contarNos, dividir, folhas, montarLayout, podeDividir, profundidade, remover, restaurarLayout, type NoPainel } from "./layout";

const T = (sessao_id: string): NoPainel => ({ tipo: "terminal", sessao_id });
const D = (orientacao: "horizontal" | "vertical", primeiro: NoPainel, segundo: NoPainel): NoPainel => ({ tipo: "divisao", orientacao, primeiro, segundo });
const todas = () => true;

describe("montarLayout", () => {
  it("funcional: uma entrada por aba, na ordem, com a árvore e a sessão ativa", () => {
    const abas = [{ arvore: D("vertical", T("a"), T("b")) }, { arvore: T("c") }];
    expect(montarLayout(abas, "b", [], todas)).toEqual({ versao: 2, ativa: "b", abas, fixadas: [] });
  });
  it("funcional: folha que já não existe sai e a divisão colapsa; aba vazia sai", () => {
    const abas = [{ arvore: D("horizontal", T("a"), T("fantasma")) }, { arvore: T("fantasma") }];
    expect(montarLayout(abas, "fantasma", [], (id) => id !== "fantasma")).toEqual({ versao: 2, ativa: null, abas: [{ arvore: T("a") }], fixadas: [] });
  });
  it("funcional: fixada só vale se ainda é a raiz de uma aba gravada", () => {
    const abas = [{ arvore: T("a") }, { arvore: T("b") }];
    expect(montarLayout(abas, "a", ["b", "fantasma", "b"], todas).fixadas).toEqual(["b"]);
  });
});

describe("restaurarLayout", () => {
  const layout = { ativa: "b", abas: [{ arvore: D("vertical", T("a"), D("horizontal", T("b"), T("c"))) }, { arvore: T("d") }], fixadas: [] };
  it("funcional: refaz os grupos do layout e devolve a sessão ativa", () => {
    const r = restaurarLayout(layout, ["a", "b", "c", "d"]);
    expect(r.grupos).toEqual([layout.abas[0]!.arvore, T("d")]);
    expect(r.ativa).toBe("b");
  });
  it("funcional: sessão que não voltou sai da árvore e a divisão colapsa", () => {
    const r = restaurarLayout(layout, ["a", "c", "d"]);
    expect(r.grupos).toEqual([D("vertical", T("a"), T("c")), T("d")]);
    expect(r.ativa).toBeNull();
  });
  it("funcional: sessão recuperada fora do layout vira aba solta no fim; sem layout todas são abas soltas", () => {
    expect(restaurarLayout(layout, ["a", "b", "c", "d", "e"]).grupos.at(-1)).toEqual(T("e"));
    expect(restaurarLayout(null, ["x", "y"]).grupos).toEqual([T("x"), T("y")]);
  });
  it("seguranca: sessão repetida em dois grupos só entra uma vez (restaurar não duplica)", () => {
    const repetido = { ativa: null, abas: [{ arvore: T("a") }, { arvore: D("vertical", T("a"), T("b")) }], fixadas: [] };
    expect(restaurarLayout(repetido, ["a", "b"]).grupos).toEqual([T("a"), T("b")]);
  });
  it("funcional: devolve só as fixadas que ainda são raiz", () => {
    expect(restaurarLayout({ ativa: null, abas: [{ arvore: T("a") }, { arvore: T("b") }], fixadas: ["b", "x"] }, ["a", "b"]).fixadas).toEqual(["b"]);
  });
});

describe("dividir, remover e limites", () => {
  it("dividir troca a folha por uma divisão com a nova atrás", () => {
    expect(dividir(T("a"), "a", "vertical", "b")).toEqual(D("vertical", T("a"), T("b")));
    expect(dividir(D("vertical", T("a"), T("b")), "b", "horizontal", "c")).toEqual(D("vertical", T("a"), D("horizontal", T("b"), T("c"))));
  });
  it("remover colapsa a divisão e devolve null na última folha", () => {
    expect(remover(D("vertical", T("a"), T("b")), "a")).toEqual(T("b"));
    expect(remover(T("a"), "a")).toBeNull();
  });
  it("profundidade ≤ 16: a 17ª divisão em cadeia é recusada e a árvore não muda", () => {
    let arvore: NoPainel = T("s0");
    for (let i = 1; i <= PROFUNDIDADE_MAXIMA; i += 1) arvore = dividir(arvore, `s${i - 1}`, "vertical", `s${i}`);
    expect(profundidade(arvore)).toBe(PROFUNDIDADE_MAXIMA);
    expect(podeDividir(arvore, `s${PROFUNDIDADE_MAXIMA}`)).toBe(false);
    expect(dividir(arvore, `s${PROFUNDIDADE_MAXIMA}`, "vertical", "x")).toBe(arvore);
  });
  it("≤ 64 nós: grade larga para no limite", () => {
    let arvore: NoPainel = T("s0");
    let n = 0;
    for (let i = 0; i < 40; i += 1) {
      const alvo = folhas(arvore)[i % folhas(arvore).length]!;
      arvore = dividir(arvore, alvo, i % 2 === 0 ? "vertical" : "horizontal", `n${n++}`);
    }
    expect(contarNos(arvore)).toBeLessThanOrEqual(NOS_MAXIMOS);
    expect(contarNos(arvore)).toBeGreaterThanOrEqual(NOS_MAXIMOS - 2);
  });
});
