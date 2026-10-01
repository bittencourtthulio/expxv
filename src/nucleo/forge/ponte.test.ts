import { describe, expect, it } from "vitest";
import { issueParaPedido, issuesFechadasPorPr } from "./ponte";

describe("issueParaPedido (T-06.20)", () => {
  it("issue comum vira pedido (prodx) com a referência #N", () => {
    const p = issueParaPedido({ numero: 123, titulo: "Exportar relatório em CSV", corpo: "Gostaria de exportar.", labels: ["enhancement"], url: "https://github.com/acme/app/issues/123" });
    expect(p).toMatchObject({ tipo: "pedido", comando: "/expx:prodx", referencia: "#123", fechamento: "Closes #123", numero: 123 });
    expect(p.texto).toContain("Exportar relatório em CSV");
    expect(p.texto).toContain("Origem: issue #123 — https://github.com/acme/app/issues/123");
  });
  it("label ou título de defeito vira ocorrência (runx); o usuário pode forçar o tipo", () => {
    expect(issueParaPedido({ numero: 7, titulo: "Login", labels: ["bug"] })).toMatchObject({ tipo: "ocorrencia", comando: "/expx:runx" });
    expect(issueParaPedido({ numero: 8, titulo: "App quebra ao salvar", labels: [] }).tipo).toBe("ocorrencia");
    expect(issueParaPedido({ numero: 8, titulo: "Crash", labels: ["bug"] }, { tipo: "pedido" }).tipo).toBe("pedido");
    expect(issueParaPedido({ numero: 9, titulo: "x" }, { repo: "acme/app" }).referencia).toBe("acme/app#9");
  });
  it("texto não confiável: sem controles, sem segredos, truncado e nunca lança", () => {
    const p = issueParaPedido({ numero: 1, titulo: "t\u0000\u0007", corpo: `token ghp_ABCDEFGHIJKLMNOPQRSTUV1234\r\n${"x".repeat(20_000)}`, url: "javascript:alert(1)" }, { maxChars: 500 });
    expect(p.texto).not.toMatch(/ghp_|\u0000|\u0007|\r/);
    expect(p.truncado).toBe(true);
    expect(p.texto.length).toBeLessThan(900);
    expect(p.url).toBe("");
    expect(() => issueParaPedido({} as never)).not.toThrow();
    expect(issueParaPedido({} as never)).toMatchObject({ titulo: "(sem título)", numero: 0, fechamento: "" });
  });
  it("PR fecha a issue: reconhece palavras-chave de fechamento", () => {
    expect(issuesFechadasPorPr("Closes #7\nfixes acme/app#8, resolved: #9\nver #10")).toEqual([7, 8, 9]);
    expect(issuesFechadasPorPr("")).toEqual([]);
  });
});
