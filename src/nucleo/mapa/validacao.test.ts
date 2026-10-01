import { describe, expect, it } from "vitest";
import { ErroExtracaoInvalida, LIMITES_EXTRACAO, validarExtracao } from "./validacao";
import type { Extracao } from "./tipos";

function base(): Extracao {
  return {
    versao_extrator: 1,
    linguagem: "typescript",
    hash: "abc",
    loc: 10,
    loc_codigo: 7,
    loc_comentario: 2,
    complexidade_total: 3,
    complexidade_max: 2,
    erros_parse: 0,
    e_teste: false,
    e_gerado: false,
    truncado: false,
    simbolos: [{ nome: "f", qualificado: "f", tipo: "funcao", linha: 1, linha_fim: 3, exportado: true, visibilidade: null, complexidade: 2, assinatura: "function f()", doc: null, decoradores: [] }],
    imports: [{ especificador: "./a", tipo: "estatico", linha: 1, so_tipo: false, nomes: [{ nome: "x", alias: null }] }],
    chamadas: [{ de: "f", alvo: "g", receptor: null, tipo: "chamada", linha: 2 }],
    herancas: [{ classe: "A", base: "B", tipo: "herda", linha: 1 }],
    entradas: [{ tipo: "rota", chave: "GET /", framework: "express", handler: null, linha: 4, confianca: "exata" }],
    dados: [{ tabela: "t", operacao: "le", de: null, linha: 5, confianca: "heuristica", fonte: "sql" }],
    padroes: [{ tipo: "env", nome: "X", linha: 6 }],
    dinamicos: [{ tipo: "eval", linha: 7 }],
  };
}

describe("validarExtracao (T-17.01)", () => {
  it("ida e volta por JSON preserva o conteúdo", () => {
    const e = base();
    expect(validarExtracao(JSON.parse(JSON.stringify(e)))).toEqual(e);
    expect(validarExtracao(JSON.stringify(e))).toEqual(e);
  });

  it("rejeita JSON malformado e tipos errados", () => {
    expect(() => validarExtracao("{nao json")).toThrow(ErroExtracaoInvalida);
    expect(() => validarExtracao(null)).toThrow(/extracao/);
    expect(() => validarExtracao([])).toThrow(ErroExtracaoInvalida);
    const e = base() as unknown as Record<string, unknown>;
    e.loc = "10";
    expect(() => validarExtracao(e)).toThrow(/loc/);
  });

  it("rejeita linha negativa/zero, enum desconhecido e linha_fim antes da linha", () => {
    const a = base();
    a.simbolos[0]!.linha = -1;
    expect(() => validarExtracao(a)).toThrow(/simbolos\[0\]\.linha/);
    const b = base();
    b.simbolos[0]!.linha_fim = 0;
    expect(() => validarExtracao(b)).toThrow(/linha_fim/);
    const c = base() as unknown as { chamadas: Array<Record<string, unknown>> };
    c.chamadas[0]!.tipo = "magica";
    expect(() => validarExtracao(c)).toThrow(/chamadas\[0\]\.tipo/);
    const d = base();
    (d.imports[0] as unknown as Record<string, unknown>).so_tipo = 1;
    expect(() => validarExtracao(d)).toThrow(/so_tipo/);
  });

  it("rejeita listas acima do teto (5 000 símbolos) e texto gigante", () => {
    const e = base();
    const s = e.simbolos[0]!;
    e.simbolos = Array.from({ length: LIMITES_EXTRACAO.simbolos + 1 }, () => s);
    expect(() => validarExtracao(e)).toThrow(/teto de 5000/);
    const g = base();
    g.simbolos[0]!.assinatura = "x".repeat(401);
    expect(() => validarExtracao(g)).toThrow(/assinatura/);
  });

  it("aceita exatamente o teto e descarta campos desconhecidos", () => {
    const e = base();
    const s = e.simbolos[0]!;
    e.simbolos = Array.from({ length: LIMITES_EXTRACAO.simbolos }, () => s);
    expect(validarExtracao(e).simbolos).toHaveLength(5000);
    const extra = { ...base(), codigo_fonte: "const x = 1" } as unknown;
    expect("codigo_fonte" in validarExtracao(extra)).toBe(false);
  });

  it("shingles opcionais: validados como pares de inteiros", () => {
    const e = { ...base(), shingles: [[1, 2]] };
    expect(validarExtracao(e).shingles).toEqual([[1, 2]]);
    expect(() => validarExtracao({ ...base(), shingles: [[1]] })).toThrow(/shingles/);
  });
});
