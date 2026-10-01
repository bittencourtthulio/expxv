import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { NaoEncontradoErro } from "../../dominio";
import { criarRepoConfig } from "./config";
import { criarRepoConta } from "./conta";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  return { conta: criarRepoConta(b), config: criarRepoConfig(b) };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

describe("repo conta", () => {
  it("cria com id conta_, habilitada por padrão; habilitar/desabilitar filtra a listagem", () => {
    const { conta } = novo();
    const a = conta.criar({ provedor: "claude", rotulo: "pessoal", config_dir_ref: "contas/a" });
    const b = conta.criar({ provedor: "codex", rotulo: "trabalho" });
    expect(a.id).toMatch(/^conta_/);
    expect(a.habilitada).toBe(true);
    conta.definirHabilitada(b.id, false);
    expect(conta.listar({ apenasHabilitadas: true }).itens.map((c) => c.id)).toEqual([a.id]);
    expect(conta.listar({ provedor: "codex" }).itens.map((c) => c.id)).toEqual([b.id]);
    expect(conta.listar().itens).toHaveLength(2);
  });

  it("inexistente é erro nominal e remover apaga", () => {
    const { conta } = novo();
    expect(() => conta.definirHabilitada("conta_x", true)).toThrow(NaoEncontradoErro);
    const a = conta.criar({ provedor: "claude", rotulo: "r" });
    conta.remover(a.id);
    expect(conta.obter(a.id)).toBeUndefined();
  });
});

describe("repo config", () => {
  it("guarda JSON por chave, sobrescreve, lista e remove", () => {
    const { config } = novo();
    expect(config.obter("x")).toBeUndefined();
    config.definir("x", { a: 1, b: [true, null] });
    expect(config.obter("x")).toEqual({ a: 1, b: [true, null] });
    config.definir("x", 7);
    expect(config.obter<number>("x")).toBe(7);
    config.definir("y", "s");
    expect(config.listar()).toEqual({ x: 7, y: "s" });
    config.remover("x");
    expect(config.obter("x")).toBeUndefined();
  });

  it("valor inválido para JSON (undefined) é recusado", () => {
    const { config } = novo();
    expect(() => config.definir("x", undefined)).toThrow();
  });
});
