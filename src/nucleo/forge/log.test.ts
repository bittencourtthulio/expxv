import { describe, expect, it } from "vitest";
import { ArmazemLog } from "./log";

describe("ArmazemLog (T-06.19)", () => {
  it("indexa linhas através de pedaços que cortam no meio da linha", () => {
    const a = new ArmazemLog();
    a.adicionar("um\ndo");
    a.adicionar("is\ntrês\n");
    a.adicionar("quatro");
    expect(a.totalLinhas).toBe(4);
    expect(a.linhas(0, 4)).toEqual(["um", "dois", "três", "quatro"]);
    expect(a.linhas(1, 2)).toEqual(["dois", "três"]);
    expect(a.linhas(3, 10)).toEqual(["quatro"]);
    expect(a.linhas(9, 1)).toEqual([]);
    expect(a.linhas(-1, 1)).toEqual([]);
  });
  it("50 MB: páginas corretas, índice rápido, respeita o teto", () => {
    const a = new ArmazemLog(60 * 1024 * 1024);
    const bloco = "linha de log do passo 1234567890abcdefghijklmnopqrstuvwxyz\n".repeat(1000);
    const t0 = Date.now();
    let ok = true;
    for (let i = 0; i < 900 && ok; i++) ok = a.adicionar(bloco);
    expect(ok).toBe(true);
    expect(a.totalBytes).toBeGreaterThan(50 * 1024 * 1024);
    expect(a.totalLinhas).toBe(900_000);
    expect(a.paginas(500)).toBe(1800);
    const ini = Date.now();
    expect(a.pagina(1799, 500)).toHaveLength(500);
    expect(a.pagina(1000, 500)[0]).toMatch(/^linha de log/);
    expect(Date.now() - ini).toBeLessThan(200);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(new ArmazemLog(10).adicionar("x".repeat(11))).toBe(false);
  });
});
