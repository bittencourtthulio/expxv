import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture, RAIZ_FIXTURES_MAPA } from "../../../../tests/fixtures/mapa/comparar";
import { detectarLinguagem } from "../linguagens";
import { extrairArquivo } from "./registro";
import { join } from "node:path";

// T-17.13 (Ruby): gabarito `esperado.json`, casos de borda e referência cruzada com o Ripper do Ruby (se houver `ruby`).

const gab = carregarGabarito("ruby");
describe("extrator Ruby: fixtures", () => {
  for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
    it(`${caminho}: 100% do gabarito e nenhuma armadilha`, async () => {
      const texto = lerFixture("ruby", caminho);
      const e = await extrairArquivo(texto, detectarLinguagem(caminho)!, caminho);
      expect(compararComGabarito(e, esperado)).toEqual([]);
    });
  }
});

describe("extrator Ruby: casos de borda", () => {
  const ext = (texto: string, caminho = "lib/x.rb") => extrairArquivo(texto, "ruby", caminho);

  it("class A::B vira A.B; módulo é classe com assinatura module", async () => {
    const e = await ext("module M\n  class A::B < C::D; end\nend\n");
    expect(e.simbolos.map((s) => [s.qualificado, s.assinatura])).toEqual([["M", "module M"], ["M.A.B", "class A::B < C::D"]]);
    expect(e.herancas).toMatchObject([{ classe: "M.A.B", base: "C::D", tipo: "herda" }]);
  });

  it("private com def e private :nome depois da definição", async () => {
    const e = await ext("class A\n  def a; end\n  def b; end\n  private def c; end\n  private :a\nend\n");
    expect(Object.fromEntries(e.simbolos.filter((s) => s.tipo === "metodo").map((s) => [s.nome, s.visibilidade]))).toEqual({ a: "privada", b: "publica", c: "privada" });
  });

  it("require com expressão é dinâmico e não vira import; require_relative ganha ./", async () => {
    const e = await ext('require File.join(a, "b")\nrequire_relative "c"\nrequire_relative "../d"\n');
    expect(e.imports.map((i) => i.especificador)).toEqual(["./c", "../d"]);
    expect(e.dinamicos).toMatchObject([{ tipo: "require_dinamico" }]);
  });

  it("variável local não vira chamada; método solto sim", async () => {
    const e = await ext("class A\n  def m(x)\n    y = 1\n    x\n    y\n    helper\n  end\nend\n");
    expect(e.chamadas.map((c) => c.alvo)).toEqual(["helper"]);
  });

  it("resources aninhado e only/except", async () => {
    const e = await ext("Rails.application.routes.draw do\n  resources :a, only: [:index] do\n    resources :bs, only: [:show]\n  end\n  resource :perfil, only: [:show]\nend\n");
    expect(e.entradas.map((x) => x.chave)).toEqual(["GET /a", "GET /a/:a_id/bs/:id", "GET /perfil"]);
  });

  it("heredoc com interpolação é heurístico; ENV.fetch registra só o NOME", async () => {
    const e = await ext('def m\n  ENV.fetch("TOKEN_Z", "valor-secreto")\n  q = <<~SQL\n    DELETE FROM sessoes WHERE id = #{i}\n  SQL\nend\n');
    expect(e.dados).toMatchObject([{ tabela: "sessoes", operacao: "escreve", confianca: "heuristica" }]);
    expect(e.padroes).toEqual([{ tipo: "env", nome: "TOKEN_Z", linha: 2 }]);
    expect(JSON.stringify(e)).not.toContain("valor-secreto");
  });

  it("erro de sintaxe devolve erros_parse > 0; arquivo vazio não quebra", async () => {
    const e = await ext("def ok; end\nclass ( \n");
    expect(e.erros_parse).toBeGreaterThan(0);
    expect(e.simbolos.some((s) => s.qualificado === "ok")).toBe(true);
    expect((await ext("")).simbolos).toEqual([]);
  });
});

const script = `
require 'ripper'; require 'json'
def nome(n) n.is_a?(Array) && n[0].to_s.start_with?('@') ? n[1] : (n.is_a?(Array) ? nome(n.flatten.find { |x| x.is_a?(String) }) : n) end
def achar(n, out)
  return unless n.is_a?(Array)
  case n[0]
  when :class then out[:classes] << n[1].flatten.select { |x| x.is_a?(String) }.last
  when :module then out[:classes] << n[1].flatten.select { |x| x.is_a?(String) }.last
  when :def then out[:metodos] << n[1][1]
  when :defs then out[:metodos] << n[3][1]
  when :command
    id = n[1]
    if id.is_a?(Array) && id[0] == :@ident && %w[require require_relative].include?(id[1])
      s = n.flatten.each_cons(2).find { |a, b| a == :@tstring_content }
      out[:requires] << (s ? s[1] : nil) if s
    end
  end
  n.each { |c| achar(c, out) }
end
res = {}
ARGV.each do |f|
  out = { classes: [], metodos: [], requires: [] }
  achar(Ripper.sexp(File.read(f)), out)
  res[f] = out
end
puts JSON.generate(res)
`;

const temRuby = spawnSync("ruby", ["-v"]).status === 0;
describe.skipIf(!temRuby)("extrator Ruby: referência cruzada com o Ripper", () => {
  it("classes, métodos e requires de cada fixture batem com o parser do Ruby", async () => {
    const arquivos = Object.keys(gab.arquivos);
    const abs = arquivos.map((a) => join(RAIZ_FIXTURES_MAPA, "ruby", a));
    const r = spawnSync("ruby", ["-e", script, ...abs], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const ref = JSON.parse(r.stdout) as Record<string, { classes: string[]; metodos: string[]; requires: string[] }>;
    for (const [i, a] of arquivos.entries()) {
      const e = await extrairArquivo(lerFixture("ruby", a), "ruby", a);
      const esperado = ref[abs[i] as string]!;
      expect(e.simbolos.filter((s) => s.tipo === "classe").map((s) => s.nome).sort(), a).toEqual([...esperado.classes].sort());
      expect(e.simbolos.filter((s) => s.tipo === "metodo" || s.tipo === "funcao").map((s) => s.nome).sort(), a).toEqual([...esperado.metodos].sort());
      const requires = e.imports.filter((x) => (x.tipo === "require" || x.tipo === "estatico") && x.nomes.length === 0).map((x) => x.especificador.replace(/^\.\//, "")).sort();
      expect(requires, a).toEqual(esperado.requires.map((x) => x).sort());
    }
  }, 30_000);
});
