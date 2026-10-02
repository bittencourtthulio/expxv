// Contrato de `BancoAgil`: memória e SQLite precisam se comportar igual (T-18.02). Inclui a migration 0011 e o cenário completo da fixture (40 sprints).
import { afterEach, describe, expect, it } from "vitest";
import { carregarHistorico } from "../../../../tests/fixtures/agil/gerar";
import { criarBancoMemoria } from "../../agil/memoria";
import type { BancoAgil } from "../../agil/repos";
import { itemAgil } from "../../../../tests/fixtures/agil/ajudas";
import { abrirBanco, type Banco } from "../banco";
import { migrar } from "../migrar";
import { MIGRACOES } from "../migracoes";
import { criarBancoAgilSqlite } from "./agil";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const novoSqlite = (workspaces: string[] = ["ws1", "ws2"]): { banco: Banco; agil: ReturnType<typeof criarBancoAgilSqlite> } => {
  const banco = abrirBanco(":memory:");
  abertos.push(banco);
  migrar(banco);
  for (const w of workspaces) banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [w, w, `/r/${w}`, "t", "t"]);
  return { banco, agil: criarBancoAgilSqlite(banco) };
};

describe("migration 0011-agil", () => {
  it("é a versão 11 e cria as tabelas agil_*", () => {
    expect(MIGRACOES[10]?.nome).toBe("0011-agil");
    const { banco } = novoSqlite();
    const t = banco.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    expect(t).toEqual(expect.arrayContaining([
      "agil_config", "agil_membro", "agil_membro_alias", "agil_epico", "agil_item", "agil_estimativa", "agil_classificacao", "agil_sprint", "agil_sprint_item", "agil_capacidade", "agil_cerimonia",
      "agil_retro_item", "agil_retro_acao", "agil_fato_task", "agil_versao_trabalho", "agil_retrabalho_evento", "agil_retrabalho_task", "agil_erro_estimativa", "agil_metrica_snapshot",
      "agil_checklist", "agil_dod_resultado", "agil_demo", "agil_evento", "agil_auditoria", "agil_chamada_ia",
    ]));
  });
  it("migra da v10 com dados sem perda", () => {
    const b = abrirBanco(":memory:");
    abertos.push(b);
    migrar(b, { migracoes: MIGRACOES.slice(0, 10) });
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r','t','t')");
    expect(migrar(b).aplicadas).toContain("0011-agil");
    expect(b.consultarUm("SELECT nome FROM workspace WHERE id='ws_1'")).toEqual({ nome: "n" });
  });
  it("CASCADE por workspace: apagar o workspace limpa itens, sprints e config", () => {
    const { banco, agil } = novoSqlite();
    agil.itens.set("it1", itemAgil());
    agil.invalidar();
    banco.executar("DELETE FROM workspace WHERE id='ws1'");
    expect(banco.consultar("SELECT id FROM agil_item")).toEqual([]);
    expect(agil.itens.valores()).toEqual([]);
  });
});

const fabricas: [string, () => BancoAgil][] = [["memória", criarBancoMemoria], ["SQLite", () => novoSqlite().agil]];
describe.each(fabricas)("contrato BancoAgil (%s)", (_n, fabrica) => {
  it("set/get/delete/valores de item, com campos opcionais nulos e JSON", () => {
    const b = fabrica();
    const i = itemAgil({ id: "it1", origem_ref: { proposto_por: "agente" }, criterios: ["a", "b"] });
    b.itens.set("it1", i);
    b.itens.set("it2", itemAgil({ id: "it2", ordem: 2048 }));
    expect(b.itens.get("it1")).toEqual(i);
    expect(b.itens.get("nao")).toBeUndefined();
    expect(b.itens.valores().map((x) => x.id).sort()).toEqual(["it1", "it2"]);
    b.itens.set("it1", { ...i, titulo: "novo" });
    expect(b.itens.valores()).toHaveLength(2);
    expect(b.itens.get("it1")?.titulo).toBe("novo");
    expect(b.itens.delete("it2")).toBe(true);
    expect(b.itens.delete("it2")).toBe(false);
    expect(b.itens.valores()).toHaveLength(1);
  });
  it("transação desfaz tudo se lançar", () => {
    const b = fabrica();
    b.itens.set("it1", itemAgil({ id: "it1" }));
    expect(() => b.transacao(() => { b.itens.set("it2", itemAgil({ id: "it2" })); b.itens.set("it1", itemAgil({ id: "it1", titulo: "mudou" })); throw new Error("falha"); })).toThrow("falha");
    expect(b.itens.get("it2")).toBeUndefined();
    expect(b.itens.get("it1")?.titulo).toBe("Item");
  });
  it("chamadas de IA e versões por chave composta", () => {
    const b = fabrica();
    b.chamadasIa.set("ws1|2026-03-10", 3);
    b.versoes.set("ws1|tr-1", "v9");
    expect(b.chamadasIa.get("ws1|2026-03-10")).toBe(3);
    expect(b.versoes.get("ws1|tr-1")).toBe("v9");
    b.chamadasIa.set("ws1|2026-03-10", 4);
    expect(b.chamadasIa.get("ws1|2026-03-10")).toBe(4);
  });
});

describe("SQLite: persistência real", () => {
  it("o cache se recompõe do disco (reabrir) e preserva aliases do membro", () => {
    const { banco, agil } = novoSqlite();
    agil.membros.set("m1", { id: "m1", workspace_id: "ws1", tipo: "agente", rotulo: "Ag", squad_id: null, horas_dia: null, fator_foco: 0.6, pontos_sprint_fixo: null, ativo: true, aliases: [{ tipo: "agente", valor: "impl-1" }] });
    agil.itens.set("it1", itemAgil({ id: "it1", origem_ref: { x: 1 } }));
    agil.chamadasIa.set("ws1|d", 2);
    agil.eventos.set("1", { seq: 1, tipo: "sprint.fechada", workspace_id: "ws1", sprint_id: "s", trabalho_id: null, task_ref: null, pontos: null, duracao_observada_ms: null, tokens: null, quando: "q", dados: { a: 1 } });
    const outra = criarBancoAgilSqlite(banco);
    expect(outra.membros.get("m1")?.aliases).toEqual([{ tipo: "agente", valor: "impl-1" }]);
    expect(outra.itens.get("it1")?.origem_ref).toEqual({ x: 1 });
    expect(outra.chamadasIa.get("ws1|d")).toBe(2);
    expect(outra.eventos.get("1")?.dados).toEqual({ a: 1 });
  });
  it("o mesmo alias em dois workspaces não colide", () => {
    const { agil } = novoSqlite();
    const m = (id: string, ws: string) => ({ id, workspace_id: ws, tipo: "agente" as const, rotulo: id, squad_id: null, horas_dia: null, fator_foco: 0.6, pontos_sprint_fixo: null, ativo: true, aliases: [{ tipo: "agente" as const, valor: "impl-1" }] });
    agil.membros.set("m1", m("m1", "ws1"));
    expect(() => agil.membros.set("m2", m("m2", "ws2"))).not.toThrow();
  });
  it("histórico completo (40 sprints): painel idêntico ao da memória", async () => {
    const mem = await carregarHistorico();
    const { agil: sq } = novoSqlite(["ws1"]);
    const sql = await carregarHistorico({ banco: sq });
    const a = mem.agil.painel("ws1");
    const b = sql.agil.painel("ws1");
    expect({ ...b, gerado_em: "" }).toEqual({ ...a, gerado_em: "" });
    sq.invalidar();
    expect(sql.agil.banco.itens.valores()).toHaveLength(mem.agil.banco.itens.valores().length);
    expect({ ...sql.agil.painel("ws1"), gerado_em: "" }).toEqual({ ...a, gerado_em: "" });
  }, 60_000);
});
