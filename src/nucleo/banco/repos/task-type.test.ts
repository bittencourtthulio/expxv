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

import { TaskTypeEmbutidoErro } from "./task-type";

const base = { slug: "meu-tipo", categoria: "docs", rotulo: "Meu tipo", descricao: null };

describe("repo task-type", () => {
  it("grava, atualiza e lista por categoria; semente é idempotente e marca embutido", () => {
    const { r } = novo();
    expect(r.taskType.semear([{ slug: "implementar", categoria: "desenvolvimento", rotulo: "Implementar", descricao: null }, { slug: "triar", categoria: "planejamento", rotulo: "Triar", descricao: "x" }])).toBe(2);
    expect(r.taskType.semear([{ slug: "implementar", categoria: "desenvolvimento", rotulo: "EDITADO", descricao: null }])).toBe(0);
    expect(r.taskType.obter("implementar")).toMatchObject({ rotulo: "Implementar", embutido: true });
    r.taskType.gravar(base);
    r.taskType.gravar({ ...base, rotulo: "Outro rótulo" });
    expect(r.taskType.obter("meu-tipo")).toMatchObject({ rotulo: "Outro rótulo", embutido: false });
    expect(r.taskType.listar().map((t) => t.slug)).toEqual(["implementar", "meu-tipo", "triar"]);
  });

  it("slug inválido é recusado; só tipos não embutidos são apagados (e levam a política em cascata)", () => {
    const { r } = novo();
    expect(() => r.taskType.gravar({ ...base, slug: "Meu Tipo" })).toThrow(ValorInvalidoErro);
    expect(() => r.taskType.gravar({ ...base, rotulo: " " })).toThrow(ValorInvalidoErro);
    r.taskType.semear([{ slug: "auditar", categoria: "revisao", rotulo: "Auditar", descricao: null }]);
    expect(() => r.taskType.apagar("auditar")).toThrow(TaskTypeEmbutidoErro);
    expect(() => r.taskType.exigir("nao-existe")).toThrow(NaoEncontradoErro);
    r.taskType.gravar(base);
    const exec = { provider: "claude", cli: null, model: null, effort: null, faixa: null };
    r.politica.gravar({ workspace_id: null, task_type: "meu-tipo", executor: exec, alternativas: [], fallback: [exec], skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: true, habilitada: true }, "usuario");
    expect(r.taskType.apagar("meu-tipo")).toBe(true);
    expect(r.taskType.apagar("meu-tipo")).toBe(false);
    expect(r.politica.listar(null)).toHaveLength(0);
  });
});
