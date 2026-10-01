import { describe, expect, it } from "vitest";
import { extrairTabelasSql, pareceSql } from "./sql";

const tab = (sql: string): string[] => extrairTabelasSql(sql).map((t) => `${t.tabela}:${t.operacao}`).sort();

describe("extração de tabelas de SQL literal", () => {
  it("SELECT com JOIN, aliases, esquema e crase", () => {
    expect(tab("SELECT c.id, c.nome FROM public.clientes c INNER JOIN `pedidos` p ON p.cid = c.id")).toEqual(["clientes:le", "pedidos:le"]);
    expect(tab('select * from "Usuarios" u, perfis')).toEqual(["perfis:le", "usuarios:le"]);
  });

  it("escritas e DDL", () => {
    expect(tab("INSERT INTO auditoria (a) VALUES (1)")).toEqual(["auditoria:escreve"]);
    expect(tab("INSERT INTO resumo SELECT x FROM origem")).toEqual(["origem:le", "resumo:escreve"]);
    expect(tab("UPDATE estoque SET q = q - 1")).toEqual(["estoque:escreve"]);
    expect(tab("DELETE FROM sessoes WHERE x < 1")).toEqual(["sessoes:escreve"]);
    expect(tab("TRUNCATE TABLE logs")).toEqual(["logs:escreve"]);
    expect(tab("CREATE TABLE IF NOT EXISTS clientes (id int)")).toEqual(["clientes:define"]);
    expect(tab("ALTER TABLE clientes ADD COLUMN x int")).toEqual(["clientes:define"]);
    expect(tab("DROP TABLE IF EXISTS temp1")).toEqual(["temp1:define"]);
  });

  it("CTE não vira tabela", () => {
    expect(tab("WITH recentes AS (SELECT id FROM pedidos) SELECT * FROM recentes")).toEqual(["pedidos:le"]);
  });

  it("frases e SQL incompleto ou com placeholder no nome não casam", () => {
    for (const s of ["Select an item from the list", "update your profile", "delete from", "SELECT * FROM ${t}", "UPDATE ? SET a = 1", "select a from (select b from c) x"]) {
      expect(tab(s), s).not.toContain("list:le");
    }
    expect(tab("Select an item from the list")).toEqual([]);
    expect(tab("SELECT * FROM ?")).toEqual([]);
    expect(tab("UPDATE ? SET a = 1")).toEqual([]);
  });

  it("pareceSql", () => {
    expect(pareceSql("SELECT 1")).toBe(false); // curto demais
    expect(pareceSql("SELECT id, nome FROM clientes")).toBe(true);
    expect(pareceSql("x".repeat(30_000))).toBe(false);
  });
});
