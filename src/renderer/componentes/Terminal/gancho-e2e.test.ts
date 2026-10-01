import { describe, expect, it } from "vitest";
import { registrarLeitorDeBuffer } from "./gancho-e2e";

const xterm = {
  cols: 80, rows: 24,
  getSelection: () => "ola",
  onWriteParsed: () => ({ dispose: () => undefined }),
  buffer: { active: { viewportY: 0, length: 2, getLine: (i: number) => ({ translateToString: () => (i === 0 ? "ola" : "mundo") }) } },
};

describe("gancho de teste do buffer do xterm", () => {
  it("sem a marca E2E nada existe", () => {
    const janela: Record<string, unknown> = {};
    const soltar = registrarLeitorDeBuffer("s1", xterm, janela);
    expect(janela.__ade_terminais).toBeUndefined();
    soltar();
    expect(janela.__ade_terminais).toBeUndefined();
  });
  it("com a marca expõe o texto do buffer e some ao soltar", () => {
    const janela: Record<string, unknown> = { __ade_e2e: true };
    const soltar = registrarLeitorDeBuffer("s1", xterm, janela);
    const mapa = janela.__ade_terminais as Record<string, { texto(): string; colunas(): number }>;
    expect(mapa.s1?.texto()).toBe("ola\nmundo");
    expect(mapa.s1?.colunas()).toBe(80);
    expect((mapa.s1 as unknown as { fim(n: number): string }).fim(1)).toBe("mundo");
    soltar();
    expect(mapa.s1).toBeUndefined();
  });
});
