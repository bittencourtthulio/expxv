// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LISTA_ATALHOS, interpretarAtalho, vizinhoCircular } from "./atalhos";

const mac = (init: Partial<KeyboardEventInit> & { key: string; code?: string }) => interpretarAtalho(new KeyboardEvent("keydown", init), true);
const win = (init: Partial<KeyboardEventInit> & { key: string; code?: string }) => interpretarAtalho(new KeyboardEvent("keydown", init), false);

describe("atalhos no macOS (Cmd)", () => {
  it("divide (Shift na outra orientação), nova aba, fechar, focar, paleta", () => {
    expect(mac({ key: "d", metaKey: true })).toEqual({ tipo: "dividir", orientacao: "horizontal" });
    expect(mac({ key: "D", metaKey: true, shiftKey: true })).toEqual({ tipo: "dividir", orientacao: "vertical" });
    expect(mac({ key: "n", metaKey: true })).toEqual({ tipo: "nova-aba" });
    expect(mac({ key: "w", metaKey: true })).toEqual({ tipo: "fechar" });
    expect(mac({ key: "j", metaKey: true })).toEqual({ tipo: "focar" });
    expect(mac({ key: "k", metaKey: true })).toEqual({ tipo: "paleta" });
  });
  it("aba N, navegar painéis, expandir, tema e abas por colchetes", () => {
    expect(mac({ key: "3", metaKey: true })).toEqual({ tipo: "aba-numero", numero: 3 });
    expect(mac({ key: "ArrowRight", metaKey: true, altKey: true })).toEqual({ tipo: "painel", passo: 1 });
    expect(mac({ key: "ArrowUp", metaKey: true, altKey: true })).toEqual({ tipo: "painel", passo: -1 });
    expect(mac({ key: "Enter", metaKey: true, shiftKey: true })).toEqual({ tipo: "expandir" });
    expect(mac({ key: "L", metaKey: true, shiftKey: true })).toEqual({ tipo: "tema" });
    expect(mac({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true })).toEqual({ tipo: "aba", passo: 1 });
  });
  it("Ctrl puro no mac é do processo", () => {
    expect(mac({ key: "d", ctrlKey: true })).toBeNull();
    expect(mac({ key: "w", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(mac({ key: "Enter", metaKey: true })).toBeNull();
  });
});

describe("atalhos no Windows/Linux (Ctrl+Shift)", () => {
  it("Ctrl+Shift+tecla; Alt troca a orientação da divisão", () => {
    expect(win({ key: "D", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "dividir", orientacao: "horizontal" });
    expect(win({ key: "D", ctrlKey: true, shiftKey: true, altKey: true })).toEqual({ tipo: "dividir", orientacao: "vertical" });
    expect(win({ key: "N", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "nova-aba" });
    expect(win({ key: "W", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "fechar" });
    expect(win({ key: "J", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "focar" });
    expect(win({ key: "P", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "paleta" });
    expect(win({ key: "L", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "tema" });
    expect(win({ key: "Enter", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "expandir" });
  });
  it("Ctrl+1…9 vai à aba; Ctrl+Alt setas navega painéis; Ctrl+Tab troca de aba", () => {
    expect(win({ key: "1", ctrlKey: true })).toEqual({ tipo: "aba-numero", numero: 1 });
    expect(win({ key: "#", code: "Digit3", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "aba-numero", numero: 3 });
    expect(win({ key: "ArrowLeft", ctrlKey: true, altKey: true })).toEqual({ tipo: "painel", passo: -1 });
    expect(win({ key: "ArrowLeft", ctrlKey: true, shiftKey: true, altKey: true })).toEqual({ tipo: "painel", passo: -1 });
    expect(win({ key: "Tab", ctrlKey: true })).toEqual({ tipo: "aba", passo: 1 });
    expect(win({ key: "Tab", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "aba", passo: -1 });
  });
  it("Ctrl+letra puro, tecla solta e Cmd seguem para o processo", () => {
    for (const k of ["d", "w", "c", "k", "n", "l"]) expect(win({ key: k, ctrlKey: true })).toBeNull();
    expect(win({ key: "d" })).toBeNull();
    expect(win({ key: "d", metaKey: true })).toBeNull();
    expect(win({ key: "Enter", ctrlKey: true })).toBeNull();
    expect(interpretarAtalho(new KeyboardEvent("keyup", { key: "d", ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });
});

describe("vizinhoCircular e lista", () => {
  it("dá a volta nas duas pontas", () => {
    expect(vizinhoCircular(["a", "b", "c"], "c", 1)).toBe("a");
    expect(vizinhoCircular(["a", "b", "c"], "a", -1)).toBe("c");
    expect(vizinhoCircular(["a", "b"], null, 1)).toBe("a");
    expect(vizinhoCircular([], "a", 1)).toBeNull();
  });
  it("a lista de ajuda traz as duas grafias de cada ação", () => {
    expect(LISTA_ATALHOS.every((a) => a.mac !== "" && a.outros !== "")).toBe(true);
    expect(LISTA_ATALHOS.map((a) => a.acao)).toContain("Buscar no terminal");
  });
});

describe("saída de teclado do terminal (WCAG 2.1.2: o xterm engole o Tab)", () => {
  it("⌘⇧M (mac) e Ctrl+Shift+M (demais) tiram o foco do terminal", () => {
    expect(mac({ key: "M", metaKey: true, shiftKey: true })).toEqual({ tipo: "sair" });
    expect(win({ key: "M", ctrlKey: true, shiftKey: true })).toEqual({ tipo: "sair" });
    expect(win({ key: "m", ctrlKey: true })).toBeNull(); // Ctrl+M puro (Enter no readline) segue para o processo
  });
  it("está na lista de atalhos mostrada na ajuda", () => {
    expect(LISTA_ATALHOS.some((l) => l.acao.startsWith("Sair do terminal"))).toBe(true);
  });
});
