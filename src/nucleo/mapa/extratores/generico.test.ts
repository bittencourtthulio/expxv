import { describe, expect, it } from "vitest";
import { carregarGabarito, compararComGabarito, lerFixture } from "../../../../tests/fixtures/mapa/comparar";
import { comentariosDeTexto, extrairGenerico } from "./generico";

describe("extrator degradado: fixtures generico", () => {
  const gab = carregarGabarito("generico");
  for (const [caminho, esperado] of Object.entries(gab.arquivos)) {
    it(`${caminho}: 100% do gabarito`, () => {
      const e = extrairGenerico(lerFixture("generico", caminho), caminho);
      expect(e.linguagem).toBe("outra");
      expect(compararComGabarito(e, esperado)).toEqual([]);
    });
  }
});

describe("extrator degradado: bordas", () => {
  it("URL com // dentro de string não vira comentário", () => {
    const t = 'val u = "http://x"\n';
    expect(comentariosDeTexto(t, "a.kt")).toEqual([]);
  });
  it("arquivo vazio, extensão sem regra e texto sem imports não quebram", () => {
    expect(extrairGenerico("", "a.kt").loc).toBe(0);
    const e = extrairGenerico("conteudo qualquer\n", "a.desconhecida");
    expect(e.imports).toEqual([]);
    expect(e.loc_codigo).toBe(1);
  });
  it("bloco sem fim vai até o fim do arquivo", () => {
    const e = extrairGenerico("a\n/* aberto\nlinha\n", "x.scala");
    expect(e.loc_comentario).toBe(2);
  });
  it("SQL: frase comum não vira tabela e o texto do SQL não é guardado", () => {
    const e = extrairGenerico("Select an item from the list please;\n", "q.sql");
    expect(e.dados).toEqual([]);
    expect(JSON.stringify(extrairGenerico("SELECT a FROM segredo_t;\n", "q.sql"))).not.toContain("SELECT a");
  });
});
