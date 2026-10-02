import { describe, expect, it } from "vitest";
import type { AcessoDadoBruto, Extracao, SimboloBruto } from "../tipos";
import { VERSAO_EXTRATOR } from "../tipos";
import { acessosDeSqlTexto, analisarDados, definicoesDeTexto, ehMigracao, normalizarTabela, quemToca, tabelasDe } from "./dados";
import type { ArquivoMapa } from "./tipos";

const sim = (q: string): SimboloBruto => ({ nome: q, qualificado: q, tipo: "funcao", linha: 1, linha_fim: 2, exportado: true, visibilidade: null, complexidade: 1, assinatura: q, doc: null, decoradores: [] });
const dado = (tabela: string, operacao: AcessoDadoBruto["operacao"], extra: Partial<AcessoDadoBruto> = {}): AcessoDadoBruto => ({ tabela, operacao, de: null, linha: 4, confianca: "exata", fonte: "sql", ...extra });
const arq = (caminho: string, dados: AcessoDadoBruto[], simbolos: SimboloBruto[] = []): ArquivoMapa => ({
  caminho,
  extracao: { versao_extrator: VERSAO_EXTRATOR, linguagem: "typescript", hash: "h", loc: 1, loc_codigo: 1, loc_comentario: 0, complexidade_total: 0, complexidade_max: 0, erros_parse: 0, e_teste: false, e_gerado: false, truncado: false, simbolos, imports: [], chamadas: [], herancas: [], entradas: [], dados, padroes: [], dinamicos: [] } as Extracao,
});

describe("normalizarTabela", () => {
  it.each([["`Pedidos`", "pedidos"], ['"public"."Users"', "users"], ["dbo.[Cliente]", "cliente"], ["${t}", null], ["a b", null], ["", null], ["1abc", null]])("%s", (e, r) => expect(normalizarTabela(e)).toBe(r));
});

describe("ehMigracao", () => {
  it.each([["db/migrate/20240101_x.rb", true], ["src/migrations/001_init.ts", true], ["sql/V1_2__criar.sql", true], ["prisma/schema.prisma", true], ["src/servico.ts", false], ["docs/migrationsdoc.md", false]])("%s", (c, r) => expect(ehMigracao(c)).toBe(r));
});

describe("analisarDados", () => {
  const r = analisarDados(
    [
      arq("src/repo.ts", [dado("Pedidos", "le", { de: "listar" }), dado("pedidos", "escreve", { de: "gravar", linha: 9 }), dado("clientes", "le", { de: "naoExiste" }), dado("log", "desconhecida"), dado("${x}", "le"), dado("pedidos", "le", { de: "listar", linha: 7, confianca: "heuristica" })], [sim("listar"), sim("gravar")]),
      arq("db/migrations/001_init.ts", [dado("pedidos", "define"), dado("clientes", "define")]),
      arq("src/modelo.ts", [dado("produtos", "define")]),
    ],
    { definicoes: definicoesDeTexto("sql/V1__x.sql", "CREATE TABLE IF NOT EXISTS Itens (\n id int,\n nome text,\n PRIMARY KEY (id)\n);\n-- DROP TABLE comentario;\nALTER TABLE itens ADD x int;") },
  );
  it("nós, arestas por símbolo ou arquivo, confiança e peso", () => {
    expect([...r.tabelas.keys()].sort()).toEqual(["clientes", "itens", "log", "pedidos", "produtos"]);
    const le = r.arestas.find((a) => a.tipo === "le_tabela" && a.de === "sim:src/repo.ts#listar")!;
    expect(le).toMatchObject({ para: "tab:pedidos", peso: 2, confianca: "exata" });
    expect(r.arestas.find((a) => a.tipo === "escreve_tabela")?.de).toBe("sim:src/repo.ts#gravar");
    expect(r.arestas.find((a) => a.para === "tab:clientes" && a.tipo === "le_tabela")?.de).toBe("arq:src/repo.ts");
    expect(r.arestas.find((a) => a.para === "tab:log")?.confianca).toBe("heuristica");
  });
  it("definições e e_migracao (pasta, só-define e esquema)", () => {
    expect(r.tabelas.get("pedidos")?.definidaEm.map((d) => d.caminho)).toEqual(["db/migrations/001_init.ts"]);
    expect(r.tabelas.get("itens")).toMatchObject({ colunas: 2, definidaEm: [expect.objectContaining({ fonte: "ddl", linha: 1 }), expect.objectContaining({ linha: 7 })] });
    expect([...r.migracoes].sort()).toEqual(["db/migrations/001_init.ts", "sql/V1__x.sql", "src/modelo.ts"]);
    expect(r.migracoes.has("src/repo.ts")).toBe(false);
  });
  it("quem toca e tabelas de uma entrada", () => {
    expect(quemToca(r.arestas, "Pedidos").map((t) => `${t.de}:${t.operacao}`)).toEqual(["sim:src/repo.ts#gravar:escreve", "sim:src/repo.ts#listar:le"]);
    expect(quemToca(r.arestas, "nada")).toEqual([]);
    expect(tabelasDe(r.arestas, ["sim:src/repo.ts#gravar"])).toEqual([{ tabela: "pedidos", le: false, escreve: true }]);
  });
});

describe("definicoesDeTexto", () => {
  it("prisma com @@map, schema.rb e SQL com crase/aspas/CTE sem falso positivo", () => {
    expect(definicoesDeTexto("prisma/schema.prisma", 'model User {\n id Int @id\n nome String\n @@map("usuarios")\n}\nmodel Post {\n id Int\n}\n').map((d) => [d.tabela, d.colunas])).toEqual([["usuarios", 2], ["post", 1]]);
    expect(definicoesDeTexto("db/schema.rb", 'ActiveRecord::Schema.define do\n  create_table "contas", force: :cascade do |t|\n').map((d) => d.tabela)).toEqual(["contas"]);
    expect(definicoesDeTexto("a.sql", 'create table `x`.`Fatura` (a int); DROP TABLE "velha";').map((d) => d.tabela)).toEqual(["fatura", "velha"]);
    expect(definicoesDeTexto("a.ts", "CREATE TABLE x (a int)")).toEqual([]);
  });
  it("acessos de SQL multi-instrução: JOIN múltiplo, CTE, frase com from", () => {
    const r = acessosDeSqlTexto("WITH r AS (SELECT id FROM pedidos)\nSELECT * FROM r JOIN clientes c ON 1=1 JOIN itens i ON 1=1;\n-- select x from comentario;\nINSERT INTO auditoria (a) VALUES (1);\nSelect an item from the list please;");
    expect(r.map((x) => `${x.tabela}:${x.operacao}`).sort()).toEqual(["auditoria:escreve", "clientes:le", "itens:le", "pedidos:le"]);
    expect(r.find((x) => x.tabela === "auditoria")?.linha).toBe(4);
  });
});
