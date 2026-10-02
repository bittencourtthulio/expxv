import { describe, expect, it } from "vitest";
import { criarFatiador, ehAtalho, levaAConfiguracao, mensagemDeErro, paraPcm16, pertenceAoAtalho, reamostrar, rms, rotuloDoAtalho, rotuloDoBotao } from "./logica";

describe("reamostragem e PCM16", () => {
  it("48 kHz -> 16 kHz mantém a duração (±1%)", () => {
    const entrada = new Float32Array(48_000 * 2); // 2 s
    const saida = reamostrar(entrada, 48_000, 16_000);
    expect(saida.length).toBeGreaterThanOrEqual(32_000 * 0.99);
    expect(saida.length).toBeLessThanOrEqual(32_000 * 1.01);
  });
  it("44,1 kHz também mantém a duração e preserva uma senoide grave", () => {
    const n = 44_100;
    const e = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / 44_100));
    const s = reamostrar(e, 44_100, 16_000);
    expect(Math.abs(s.length - 16_000)).toBeLessThanOrEqual(2);
    expect(rms(s)).toBeGreaterThan(0.6);
  });
  it("mesma taxa copia e entrada vazia devolve vazio", () => {
    const e = Float32Array.from([0.1, -0.2]);
    expect(Array.from(reamostrar(e, 16_000))).toEqual(Array.from(e));
    expect(reamostrar(new Float32Array(0), 48_000).length).toBe(0);
  });
  it("PCM16 little-endian com saturação", () => {
    const b = paraPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
    const v = new DataView(b.buffer);
    expect([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
});

describe("fatiador de blocos", () => {
  it("nunca emite bloco acima de 64 KiB nem abaixo do mínimo, e a sequência é monotônica", () => {
    const vistos: [number, number][] = [];
    const f = criarFatiador((s, d) => vistos.push([s, d.byteLength]), 1_000_000); // pede mais que o teto
    f.adicionar(new Uint8Array(200_000));
    f.descarregar();
    expect(vistos.map(([s]) => s)).toEqual([0, 1, 2, 3]);
    expect(Math.max(...vistos.map(([, n]) => n))).toBeLessThanOrEqual(65_536);
    expect(vistos.reduce((a, [, n]) => a + n, 0)).toBe(200_000);
    const pequeno: number[] = [];
    const g = criarFatiador((_s, d) => pequeno.push(d.byteLength), 10);
    g.adicionar(new Uint8Array(9_000));
    expect(pequeno).toEqual([4096, 4096]);
  });
  it("descarregar envia o resto par e zera", () => {
    const vistos: number[] = [];
    const f = criarFatiador((_s, d) => vistos.push(d.byteLength));
    f.adicionar(new Uint8Array(101));
    f.descarregar();
    f.descarregar();
    expect(vistos).toEqual([100]);
  });
});

describe("atalho", () => {
  const e = (o: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  it("reconhece Command+Shift+Space no mac e Control+Shift+Space fora", () => {
    expect(ehAtalho(e({ code: "Space", metaKey: true, shiftKey: true }), "Command+Shift+Space", true)).toBe(true);
    expect(ehAtalho(e({ code: "Space", ctrlKey: true, shiftKey: true }), "Control+Shift+Space", false)).toBe(true);
    expect(ehAtalho(e({ code: "Space", metaKey: true }), "Command+Shift+Space", true)).toBe(false);
    expect(ehAtalho(e({ code: "Space", metaKey: true, shiftKey: true, altKey: true }), "Command+Shift+Space", true)).toBe(false);
    expect(ehAtalho(e({ code: "KeyK", ctrlKey: true, shiftKey: true }), "CommandOrControl+Shift+K", false)).toBe(true);
    expect(ehAtalho(e({ code: "KeyK", metaKey: true, shiftKey: true }), "CommandOrControl+Shift+K", true)).toBe(true);
    expect(ehAtalho(e({ code: "Digit5", metaKey: true, shiftKey: true }), "Command+Shift+5", true)).toBe(true);
    expect(ehAtalho(e({ code: "Space" }), "Space", true)).toBe(false);
  });
  it("soltar a tecla principal OU um modificador do atalho encerra a fala", () => {
    expect(pertenceAoAtalho({ code: "Space" }, "Command+Shift+Space")).toBe(true);
    expect(pertenceAoAtalho({ code: "MetaLeft" }, "Command+Shift+Space")).toBe(true);
    expect(pertenceAoAtalho({ code: "ShiftRight" }, "Command+Shift+Space")).toBe(true);
    expect(pertenceAoAtalho({ code: "KeyA" }, "Command+Shift+Space")).toBe(false);
    expect(pertenceAoAtalho({ code: "AltLeft" }, "Command+Shift+Space")).toBe(false);
  });
  it("rótulos legíveis por plataforma", () => {
    expect(rotuloDoAtalho("Command+Shift+Space", true)).toBe("⌘⇧Espaço");
    expect(rotuloDoAtalho("Control+Shift+Space", false)).toBe("Ctrl+Shift+Espaço");
  });
});

describe("textos de estado", () => {
  it("rótulo acessível distingue os 4 estados (nunca só cor)", () => {
    const r = (["ocioso", "gravando", "processando", "erro"] as const).map((s) => rotuloDoBotao(s, "⌘⇧Espaço"));
    expect(new Set(r).size).toBe(4);
    expect(r[0]).toContain("⌘⇧Espaço");
  });
  it("mensagens em português e erros que levam à configuração", () => {
    expect(mensagemDeErro("motor_ausente")).toBe("Sem motor de voz. Configurar.");
    expect(mensagemDeErro(null)).toBe("");
    expect(levaAConfiguracao("motor_ausente")).toBe(true);
    expect(levaAConfiguracao("fala_curta")).toBe(false);
  });
});

import { combinacaoDeEvento } from "./logica";
describe("teste de tecla (combinacaoDeEvento)", () => {
  const e = (o: Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  it("monta o acelerador e recusa modificador isolado e tecla sem modificador", () => {
    expect(combinacaoDeEvento(e({ code: "Space", metaKey: true, shiftKey: true }), true)).toBe("Command+Shift+Space");
    expect(combinacaoDeEvento(e({ code: "KeyK", ctrlKey: true, shiftKey: true }), false)).toBe("Control+Shift+K");
    expect(combinacaoDeEvento(e({ code: "AltRight", altKey: true }), true)).toBeNull();
    expect(combinacaoDeEvento(e({ code: "ShiftLeft", shiftKey: true }), true)).toBeNull();
    expect(combinacaoDeEvento(e({ code: "Space" }), true)).toBeNull();
    expect(combinacaoDeEvento(e({ code: "Enter", metaKey: true }), true)).toBeNull();
  });
});
