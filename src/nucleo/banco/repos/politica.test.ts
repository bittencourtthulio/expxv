import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { criarRepositorios } from "./index";
import { ErroDominio, NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const r = criarRepositorios(b);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const conta = r.conta.criar({ provedor: "claude", rotulo: "c1" });
  return { b, r, ws, conta };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

import type { Executor, PoliticaEntrada } from "../../../compartilhado/harness";

const exec = (provider: string, faixa: Executor["faixa"] = null): Executor => ({ provider, cli: null, model: null, effort: null, faixa });
function entrada(ws: string | null, tipo: string, provider = "claude", extra: Partial<PoliticaEntrada> = {}): PoliticaEntrada {
  return { workspace_id: ws, task_type: tipo, executor: exec(provider, "alto"), alternativas: [exec("codex")], fallback: [exec("claude", "topo")], skills: ["a"], agente: null, conta_fixa_id: null, evitar_reservadas: true, habilitada: true, ...extra };
}
function comTipos() {
  const m = novo();
  m.r.taskType.semear([
    { slug: "bug-fix", categoria: "desenvolvimento", rotulo: "Bug fix", descricao: null },
    { slug: "auditar", categoria: "revisao", rotulo: "Auditar", descricao: null },
  ]);
  return m;
}

describe("repo politica", () => {
  it("grava com id pol_, faz upsert por (workspace, task_type) e serializa o executor", () => {
    const { r } = comTipos();
    const a = r.politica.gravar(entrada(null, "bug-fix"), "semente");
    expect(a.id).toMatch(/^pol_/);
    expect(a).toMatchObject({ atualizado_por: "semente", executor: { provider: "claude", faixa: "alto" }, alternativas: [{ provider: "codex" }], evitar_reservadas: true });
    const b = r.politica.gravar(entrada(null, "bug-fix", "codex"), "usuario");
    expect(b.id).toBe(a.id);
    expect(b.executor.provider).toBe("codex");
    expect(b.atualizado_por).toBe("usuario");
    expect(r.politica.listar(null)).toHaveLength(1);
  });

  it("fallback vazio é recusado pelo repositório (e pelo CHECK do banco); executor sem provedor também", () => {
    const { r, b } = comTipos();
    expect(() => r.politica.gravar(entrada(null, "bug-fix", "claude", { fallback: [] }), "usuario")).toThrow(ValorInvalidoErro);
    expect(() => r.politica.gravar(entrada(null, "bug-fix", ""), "usuario")).toThrow(ValorInvalidoErro);
    expect(() => r.politica.gravar(entrada(null, "bug-fix", "claude", { executor: { ...exec("claude"), faixa: "ultra" as never } }), "usuario")).toThrow(ValorInvalidoErro);
    expect(() => b.executar("UPDATE politica SET fallback_json = '[]'")).not.toThrow(); // nenhuma linha ainda
    r.politica.gravar(entrada(null, "bug-fix"), "usuario");
    expect(() => b.executar("UPDATE politica SET fallback_json = '[]'")).toThrow(/CHECK/i);
    expect(() => r.politica.gravar(entrada(null, "bug-fix", "claude", { executor: exec("x"), fallback: [exec("y")] }), "inventado" as never)).toThrow(ValorInvalidoErro);
  });

  it("override do workspace vence a global (efetivas/efetiva); a unicidade vale por escopo", () => {
    const { r, ws } = comTipos();
    r.politica.gravar(entrada(null, "bug-fix", "claude"), "semente");
    r.politica.gravar(entrada(null, "auditar", "claude"), "semente");
    r.politica.gravar(entrada(ws.id, "bug-fix", "codex"), "usuario");
    const efetivas = r.politica.efetivas(ws.id);
    expect(efetivas.map((p) => [p.task_type, p.executor.provider])).toEqual([["auditar", "claude"], ["bug-fix", "codex"]]);
    expect(r.politica.efetiva(ws.id, "auditar")?.workspace_id).toBeNull();
    expect(r.politica.efetiva(ws.id, "bug-fix")?.workspace_id).toBe(ws.id);
    expect(r.politica.efetiva(null, "bug-fix")?.executor.provider).toBe("claude");
    expect(r.politica.efetiva(ws.id, "inexistente")).toBeUndefined();
    expect(r.politica.listar(ws.id)).toHaveLength(1);
  });

  it("remover por escopo e por tipo; conta fixa some (SET NULL) quando a conta é apagada", () => {
    const { r, ws, conta } = comTipos();
    r.politica.gravar(entrada(ws.id, "bug-fix", "claude", { conta_fixa_id: conta.id }), "usuario");
    r.politica.gravar(entrada(ws.id, "auditar"), "usuario");
    r.conta.remover(conta.id);
    expect(r.politica.obter(ws.id, "bug-fix")?.conta_fixa_id).toBeNull();
    expect(r.politica.remover(ws.id, "auditar")).toBe(1);
    expect(r.politica.remover(ws.id)).toBe(1);
    expect(r.politica.listar(ws.id)).toEqual([]);
    expect(ErroDominio).toBeDefined();
  });
});
