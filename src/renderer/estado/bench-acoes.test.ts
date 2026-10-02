import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { aoPedirBench, ehAtalhoDoBench, ligarAtalhosBench, pedirBench, VALIDADE_PEDIDO_BENCH_MS, type PedidoBench } from "./bench-acoes";
import { aoPedirTela } from "./navegacao";

const tecla = (o: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ key: "B", code: "KeyB", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });

describe("atalho ⌘⇧B / Ctrl+Shift+B", () => {
  it("abre só com o modificador do sistema + Shift + B (sem Alt)", () => {
    expect(ehAtalhoDoBench(tecla({ metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(ehAtalhoDoBench(tecla({ ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(ehAtalhoDoBench(tecla({ ctrlKey: true, shiftKey: true }), true)).toBe(false);
    expect(ehAtalhoDoBench(tecla({ metaKey: true }), true)).toBe(false);
    expect(ehAtalhoDoBench(tecla({ metaKey: true, shiftKey: true, altKey: true }), true)).toBe(false);
    expect(ehAtalhoDoBench(tecla({ metaKey: true, shiftKey: true, code: "KeyA", key: "A" }), true)).toBe(false);
  });
  it("o ouvinte global pede a tela Bench e impede o padrão; outras teclas passam", () => {
    const telas: string[] = [];
    const sair = aoPedirTela((t) => telas.push(t));
    const ouvintes: Array<(e: Event) => void> = [];
    const alvo = { addEventListener: (_n: string, f: (e: Event) => void) => void ouvintes.push(f), removeEventListener: vi.fn() } as unknown as Window;
    const desligar = ligarAtalhosBench(alvo, true);
    const e1 = { ...tecla({ metaKey: true, shiftKey: true }), preventDefault: vi.fn() };
    ouvintes[0]!(e1 as unknown as Event);
    expect(telas).toContain("bench");
    expect(e1.preventDefault).toHaveBeenCalled();
    const e2 = { ...tecla({ metaKey: true, key: "k", code: "KeyK" }), preventDefault: vi.fn() };
    ouvintes[0]!(e2 as unknown as Event);
    expect(e2.preventDefault).not.toHaveBeenCalled();
    desligar();
    expect(alvo.removeEventListener).toHaveBeenCalled();
    sair();
  });
  it("não existe pedido nem atalho para INICIAR Run (Rodar não tem atalho, de propósito)", () => {
    const fonte = readFileSync(resolve(__dirname, "bench-acoes.ts"), "utf8");
    const tipo = /export type PedidoBench = ([^;]+);/.exec(fonte)![1]!;
    expect(tipo).not.toMatch(/rodar|executar|iniciar|julgar/);
  });
});

describe("pedidos à tela lazy", () => {
  it("pedido sem ouvinte espera o primeiro ouvinte, por pouco tempo", () => {
    vi.useFakeTimers();
    try {
      pedirBench("comparar");
      const recebidos: PedidoBench[] = [];
      aoPedirBench((p) => recebidos.push(p))();
      expect(recebidos).toEqual(["comparar"]);
      pedirBench("alvos");
      vi.advanceTimersByTime(VALIDADE_PEDIDO_BENCH_MS + 1);
      const tarde: PedidoBench[] = [];
      aoPedirBench((p) => tarde.push(p))();
      expect(tarde).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

describe("altura útil (D-32)", () => {
  it("a tela ocupa a altura toda, a barra é uma linha só e a grade/Detalhe rolam por dentro", () => {
    const css = readFileSync(resolve(__dirname, "../telas/bench/bench.css"), "utf8");
    expect(css).toMatch(/\.bench \{[^}]*height: 100%/);
    expect(css).toMatch(/\.bn-barra \{[^}]*min-height: var\(--barra-altura\)/);
    expect(css).toMatch(/\.bn-barra \{[^}]*overflow-x: auto/);
    expect(css).toMatch(/\.bn-corpo \{[^}]*flex: 1/);
    expect(css).toMatch(/\.bn-principal \{[^}]*overflow: auto/);
    expect(css).not.toMatch(/\.bench \{[^}]*(?:padding|margin)-top: [2-9]\d/);
  });
});
