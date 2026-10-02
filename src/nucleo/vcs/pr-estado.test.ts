import { describe, expect, it } from "vitest";
import { parsePrDaEntrega } from "./pr-estado";
import { sinaleiraDoPr } from "./pr-sinaleira";

describe("PR registrado em ENTREGA.md (leitura tolerante)", () => {
  it("escalar, #n, URL e bloco; sem frontmatter ou sem pr = null", () => {
    expect(parsePrDaEntrega("---\npr: 42\n---\n")).toEqual({ numero: 42, estado: null });
    expect(parsePrDaEntrega("---\npr: '#7'\n---\n")).toEqual({ numero: 7, estado: null });
    expect(parsePrDaEntrega("---\npr: https://github.com/a/b/pull/19\n---\n")).toEqual({ numero: 19, estado: null });
    expect(parsePrDaEntrega("---\npr:\n  numero: 5\n  estado: Aberto\ncommits: []\n---\n")).toEqual({ numero: 5, estado: "aberto" });
    expect(parsePrDaEntrega("---\npr: {numero: 8, estado: merged}\n---\n")).toEqual({ numero: 8, estado: "mesclado" });
    expect(parsePrDaEntrega("sem frontmatter")).toBeNull();
    expect(parsePrDaEntrega("---\ncommits: []\n---\n")).toBeNull();
    expect(parsePrDaEntrega("---\npr: abc\n---\n")).toBeNull();
    expect(parsePrDaEntrega("---\npr: 0\n---\n")).toBeNull();
  });
});

describe("sinaleira do PR (checks vermelhos = amarela, com motivo em texto)", () => {
  const pr = (o: Partial<{ numero: number; estado: string; checks_falhando: number; checks_pendentes: number }> = {}) => ({ numero: 3, estado: "aberto", checks_falhando: 0, checks_pendentes: 0, ...o });
  it("sem PR no forge: neutra", () => {
    expect(sinaleiraDoPr(null, null)).toEqual({ cor: "neutra", motivo: null, entrega_desatualizada: false });
  });
  it("checks falhando: amarela com a contagem; pendentes: neutra; ok: verde", () => {
    expect(sinaleiraDoPr(pr({ checks_falhando: 2 }), null)).toEqual({ cor: "amarela", motivo: "2 checks falhando no PR #3", entrega_desatualizada: false });
    expect(sinaleiraDoPr(pr({ checks_falhando: 1 }), null).motivo).toBe("1 check falhando no PR #3");
    expect(sinaleiraDoPr(pr({ checks_pendentes: 1 }), null).cor).toBe("neutra");
    expect(sinaleiraDoPr(pr(), null).cor).toBe("verde");
  });
  it("disco diferente do forge: sinaliza ENTREGA.md desatualizado e nunca reescreve (só devolve o aviso)", () => {
    const a = sinaleiraDoPr(pr(), { numero: 9, estado: null });
    expect(a.entrega_desatualizada).toBe(true);
    expect(sinaleiraDoPr(pr({ estado: "mesclado" }), { numero: 3, estado: "aberto" }).entrega_desatualizada).toBe(true);
    expect(sinaleiraDoPr(pr(), { numero: 3, estado: "aberto" }).entrega_desatualizada).toBe(false);
    expect(sinaleiraDoPr(pr(), { numero: 3, estado: null }).entrega_desatualizada).toBe(false);
    expect(sinaleiraDoPr(null, { numero: 3, estado: "aberto" }).entrega_desatualizada).toBe(false); // sem consulta no forge não há o que comparar
  });
});
