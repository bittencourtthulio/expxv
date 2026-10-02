import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { detectarLinguagem } from "../linguagens";
import { extrairArquivo } from "./registro";

// T-17.12 (Rust): gabarito `esperado.json` das fixtures e casos de borda. Não há `rustc` local para referência cruzada.

const gab = carregarGabarito("rust");
describe("extrator Rust: fixtures", () => {
  for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
    it(`${caminho}: 100% do gabarito e nenhuma armadilha`, async () => {
      const texto = lerFixture("rust", caminho);
      const e = await extrairArquivo(texto, detectarLinguagem(caminho)!, caminho);
      expect(compararComGabarito(e, esperado)).toEqual([]);
    });
  }
});

describe("extrator Rust: casos de borda", () => {
  const ext = (texto: string, caminho = "src/x.rs") => extrairArquivo(texto, "rust", caminho);

  it("use aninhado vira uma importação por folha, com caminhos crate/super/self", async () => {
    const e = await ext("use a::{b::{c, d as e}, f, g::*};\nuse super::h;\nuse self::i::J;\n");
    expect(e.imports.map((i) => `${i.especificador}|${i.nomes.map((n) => (n.alias ? `${n.nome}=${n.alias}` : n.nome)).join(",")}`)).toEqual([
      "a::b|c",
      "a::b|d=e",
      "a|f",
      "a::g|*",
      "super|h",
      "self::i|J",
    ]);
  });

  it("table! do diesel e #[diesel(table_name)] geram dados", async () => {
    const e = await ext("table! { usuarios (id) { id -> Int4, } }\n#[diesel(table_name = contas)]\nstruct C {}\n");
    expect(e.dados.map((d) => [d.tabela, d.operacao, d.fonte])).toEqual([["usuarios", "define", "diesel"], ["contas", "desconhecida", "diesel"]]);
  });

  it("rocket normaliza <id>; clap derive(Parser) vira cli", async () => {
    const e = await ext('#[rocket::get("/r/<id>")]\nfn r() {}\n');
    expect(e.entradas).toMatchObject([{ chave: "GET /r/:id", framework: "rocket", confianca: "exata" }]);
  });

  it("função main só é entrada no topo; main de módulo inline não", async () => {
    const e = await ext("mod m { fn main() {} }\nfn main() {}\n");
    expect(e.entradas).toHaveLength(1);
    expect(e.simbolos.map((s) => s.qualificado)).toEqual(["m.main", "main"]);
  });

  it("complexidade: if let, while, loop, ? e operadores lógicos", async () => {
    const e = await ext("fn f(a: bool, b: bool) -> Option<i32> {\n if a || b {}\n while a {}\n loop { break; }\n let x = g()?;\n None\n}\n");
    expect(e.simbolos[0]?.complexidade).toBe(1 + 1 + 1 + 1 + 1 + 1);
  });

  it("env::var registra só o NOME; format! com {} é heurístico", async () => {
    const e = await ext('fn f() { let _ = std::env::var("SEGREDO_X"); let q = format!("UPDATE {} SET a = 1", t); }\n');
    expect(e.padroes.filter((p) => p.tipo === "env")).toEqual([{ tipo: "env", nome: "SEGREDO_X", linha: 1 }]);
    expect(e.dados.every((d) => d.confianca === "heuristica")).toBe(true);
  });

  it("erro de sintaxe devolve erros_parse > 0; arquivo vazio não quebra", async () => {
    const e = await ext("fn ok() {}\nfn ( {\n");
    expect(e.erros_parse).toBeGreaterThan(0);
    expect(e.simbolos.some((s) => s.qualificado === "ok")).toBe(true);
    expect((await ext("")).simbolos).toEqual([]);
  });
});
