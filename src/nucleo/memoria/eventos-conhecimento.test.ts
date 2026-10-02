import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { conhecimentoNulo, criarPortaEnfileirada, EventoInvalidoErro, idDeEvento, montarEvento, TABELA_EVENTOS, TIPOS_EVENTO_CONHECIMENTO, type EventoConhecimento } from "./eventos-conhecimento";

const base = { tipo: "handoff.submitted" as const, workspace_id: "ws_1", chave_natural: "hand_1", ocorrido_em: "2026-10-01T00:00:00.000Z", fonte: "agente" as const, importancia: 3, titulo: "T", texto: "x" };

describe("montarEvento / idDeEvento", () => {
  it("id determinístico (reentrega = mesmo id) e distinto por tipo/workspace/chave", () => {
    expect(idDeEvento("pane.closed", "ws", "a")).toBe(idDeEvento("pane.closed", "ws", "a"));
    expect(idDeEvento("pane.closed", "ws", "a")).not.toBe(idDeEvento("pane.closed", "ws2", "a"));
    expect(montarEvento(base).id).toBe(montarEvento(base).id);
  });
  it("redige segredo, remove controles, limita título/texto e relativiza caminho absoluto", () => {
    const e = montarEvento({ ...base, titulo: "t".repeat(300), texto: `chave sk-abcdefghijklmnopqrstuvwxyz012345 e API_KEY=abc\u0007 em /Users/fulano/proj/src/a.ts e /work/ws/docs/x.md ${"z".repeat(5000)}`, raiz: "/work/ws" });
    expect(Array.from(e.titulo).length).toBeLessThanOrEqual(120);
    expect(Array.from(e.texto).length).toBeLessThanOrEqual(4000);
    expect(e.texto).not.toContain("sk-abc");
    expect(e.texto).not.toContain("API_KEY=abc");
    expect(e.texto).not.toContain("/Users/fulano");
    expect(e.texto).not.toContain("/work/ws");
    expect(e.texto).toContain("docs/x.md");
    expect(e.texto).not.toMatch(/\u0007/);
  });
  it("recusa referência de arquivo absoluta ou com .. ; relativiza a que está sob a raiz", () => {
    expect(() => montarEvento({ ...base, referencias: [{ tipo: "arquivo_rel", id: "/etc/passwd" }] })).toThrow(EventoInvalidoErro);
    expect(() => montarEvento({ ...base, referencias: [{ tipo: "relatorio", id: "../fora.md" }] })).toThrow(EventoInvalidoErro);
    expect(() => montarEvento({ ...base, referencias: [{ tipo: "arquivo_rel", id: "C:\\Users\\x\\a.ts" }] })).toThrow(EventoInvalidoErro);
    const e = montarEvento({ ...base, raiz: "/work/ws", referencias: [{ tipo: "relatorio", id: "/work/ws/.rel/a.md" }] });
    expect(e.referencias).toEqual([{ tipo: "relatorio", id: ".rel/a.md" }]);
  });
  it("tags ≤ 8 minúsculas e importância dentro de 1..5", () => {
    const e = montarEvento({ ...base, importancia: 99, tags: Array.from({ length: 12 }, (_, i) => `Tag${i}`) });
    expect(e.tags).toHaveLength(8);
    expect(e.tags.every((t) => t === t.toLowerCase())).toBe(true);
    expect(e.importancia).toBe(5);
  });
  it("tabela cobre todos os tipos de evento", () => {
    for (const t of TIPOS_EVENTO_CONHECIMENTO) expect(TABELA_EVENTOS[t].chave_natural.length).toBeGreaterThan(0);
  });
});

describe("porta enfileirada", () => {
  const ev = (i: number): EventoConhecimento => montarEvento({ ...base, chave_natural: `h${i}` });
  it("nula descarta sem lançar", () => {
    expect(() => conhecimentoNulo.registrar(ev(1))).not.toThrow();
  });
  it("consumidor que lança não afeta o chamador nem os seguintes", async () => {
    const vistos: string[] = [];
    const porta = criarPortaEnfileirada((e) => {
      vistos.push(e.id);
      if (vistos.length === 1) throw new Error("falha do consumidor");
    });
    porta.registrar(ev(1));
    porta.registrar(ev(2));
    await porta.drenar();
    expect(vistos).toHaveLength(2);
  });
  it("consumidor travado: registrar custa ≤ 1 ms e a fila descarta o mais antigo", () => {
    const porta = criarPortaEnfileirada(() => new Promise<void>(() => undefined), { limite: 10 });
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) porta.registrar(ev(i));
    const ms = (performance.now() - t0) / 200;
    expect(ms).toBeLessThan(1);
    expect(porta.pendentes()).toBeLessThanOrEqual(10);
    expect(porta.descartados()).toBeGreaterThan(150);
  });
  it("entrega em ordem", async () => {
    const ids: string[] = [];
    const porta = criarPortaEnfileirada((e) => void ids.push(e.titulo + e.id.slice(0, 4)));
    const a = ev(1);
    const b = ev(2);
    porta.registrar(a);
    porta.registrar(b);
    await porta.drenar();
    expect(ids).toEqual([`T${a.id.slice(0, 4)}`, `T${b.id.slice(0, 4)}`]);
  });
});
