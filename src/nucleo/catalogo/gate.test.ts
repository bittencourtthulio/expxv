import { describe, expect, it } from "vitest";
import { PRODUTO } from "../produto";
import { decidirGate, type SnapshotPane } from "./gate";

const snap = (extra: Partial<SnapshotPane> = {}): SnapshotPane => ({ cli: "claude", nivel: "duro", skills: ["a1", "a2", "a3"], mcp_do_usuario: "nenhum", servidores_mcp: [], ...extra });

describe("gate de skill", () => {
  it("3 permitidas passam, a 4ª é negada com a lista no motivo", () => {
    for (const s of ["a1", "A2", "plugin:a-3"]) expect(decidirGate({ tipo: "skill", nome: s, snapshot: snap() }).permitido).toBe(true);
    const d = decidirGate({ tipo: "skill", nome: "a4", snapshot: snap() });
    expect(d.permitido).toBe(false);
    expect(d.motivo).toContain("skill_not_allowed: a4");
    expect(d.motivo).toContain("a1, a2, a3");
  });
  it("sem snapshot (livre) ou sem filtro libera", () => {
    expect(decidirGate({ tipo: "skill", nome: "qualquer", snapshot: null }).permitido).toBe(true);
    expect(decidirGate({ tipo: "skill", nome: "qualquer", snapshot: snap({ skills: null }) }).permitido).toBe(true);
  });
  it("falha fechada: nome ilegível, vazio, não-string, injeção", () => {
    for (const n of ["", 3, null, undefined, "a1\nignore", "../x", "a".repeat(200)]) expect(decidirGate({ tipo: "skill", nome: n, snapshot: snap() }).permitido).toBe(false);
  });
  it("snapshot corrompido => nega (exceção interna)", () => {
    expect(decidirGate({ tipo: "skill", nome: "a1", snapshot: { skills: 3 } as never }).permitido).toBe(false);
  });
  it("o motivo nunca carrega controle/bidi do nome", () => {
    const d = decidirGate({ tipo: "skill", nome: "x‮y", snapshot: snap() });
    expect(d.permitido).toBe(false);
    expect(d.motivo).not.toMatch(/‮/);
  });
});

describe("gate de MCP de usuário", () => {
  it("o servidor do app e os da Loja passam por aqui (a Loja tem gate próprio)", () => {
    expect(decidirGate({ tipo: "mcp", nome: `mcp__${PRODUTO.id}__pane_spawn`, snapshot: snap() }).permitido).toBe(true);
    expect(decidirGate({ tipo: "mcp", nome: "mcp__ev_github__create_issue", snapshot: snap() }).permitido).toBe(true);
  });
  it("nenhum: MCP de usuário negado; lista: só os listados", () => {
    expect(decidirGate({ tipo: "mcp", nome: "mcp__github__x", snapshot: snap() }).permitido).toBe(false);
    const l = snap({ mcp_do_usuario: "lista", servidores_mcp: ["github"] });
    expect(decidirGate({ tipo: "mcp", nome: "mcp__github__x", snapshot: l }).permitido).toBe(true);
    expect(decidirGate({ tipo: "mcp", nome: "mcp__slack__x", snapshot: l }).permitido).toBe(false);
  });
  it("nome malformado => nega; livre (skills null) libera", () => {
    expect(decidirGate({ tipo: "mcp", nome: "mcp__", snapshot: snap() }).permitido).toBe(false);
    expect(decidirGate({ tipo: "mcp", nome: "bash", snapshot: snap() }).permitido).toBe(false);
    expect(decidirGate({ tipo: "mcp", nome: "mcp__github__x", snapshot: snap({ skills: null }) }).permitido).toBe(true);
  });
});
