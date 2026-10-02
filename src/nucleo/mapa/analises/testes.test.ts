import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { avisoDefasagem, casarCaminhos, coberturaPorPasta, detectarFormato, lerCoberturaTexto, lerGoCover, lerJacoco, lerLcov, lerCobertura } from "../cobertura";
import type { Extracao, SimboloBruto } from "../tipos";
import { VERSAO_EXTRATOR } from "../tipos";
import { analisarTestes, baseDoAlvoPorConvencao, ehCaminhoDeTeste, resumoPorEstado } from "./testes";
import type { ArquivoMapa } from "./tipos";

const FIX = join(__dirname, "../../../../tests/fixtures/mapa/analises/cobertura");
const ler = (n: string): string => readFileSync(join(FIX, n), "utf8");

describe("importadores de cobertura (um relatório de cada formato)", () => {
  it("lcov: LF/LH, DA sem LF e caminho absoluto", () => {
    const r = lerLcov(ler("lcov.info"));
    expect(r).toEqual([
      { caminho: "/home/ci/work/proj/src/servico.ts", linhas_total: 4, linhas_cobertas: 2, pct: 50, formato: "lcov" },
      { caminho: "src/util.ts", linhas_total: 2, linhas_cobertas: 2, pct: 100, formato: "lcov" },
    ]);
  });
  it("Cobertura XML", () => {
    expect(lerCobertura(ler("cobertura.xml"))).toEqual([{ caminho: "app/views.py", linhas_total: 4, linhas_cobertas: 2, pct: 50, formato: "cobertura" }]);
  });
  it("JaCoCo XML usa o contador LINE", () => {
    expect(lerJacoco(ler("jacoco.xml"))).toEqual([{ caminho: "com/acme/pedidos/PedidoService.java", linhas_total: 8, linhas_cobertas: 6, pct: 75, formato: "jacoco" }]);
  });
  it("go cover pondera por instruções", () => {
    expect(lerGoCover(ler("cover.out"))).toEqual([{ caminho: "github.com/acme/proj/pkg/calc/calc.go", linhas_total: 5, linhas_cobertas: 3, pct: 60, formato: "gocover" }]);
  });
  it("detecta o formato e despacha", () => {
    expect(detectarFormato("lcov.info", ler("lcov.info"))).toBe("lcov");
    expect(detectarFormato("cobertura.xml", ler("cobertura.xml"))).toBe("cobertura");
    expect(detectarFormato("jacoco.xml", ler("jacoco.xml"))).toBe("jacoco");
    expect(detectarFormato("cover.out", ler("cover.out"))).toBe("gocover");
    expect(detectarFormato("x.txt", "nada")).toBeNull();
    expect(lerCoberturaTexto("gocover", "lixo")).toEqual([]);
  });
  it("casamento de caminhos: prefixo absoluto removido, sufixo único; ambíguo descartado", () => {
    const projeto = ["src/servico.ts", "src/util.ts", "app/views.py", "src/main/java/com/acme/pedidos/PedidoService.java", "pkg/calc/calc.go", "a/dup.ts", "b/dup.ts"];
    const brutos = [...lerLcov(ler("lcov.info")), ...lerCobertura(ler("cobertura.xml")), ...lerJacoco(ler("jacoco.xml")), ...lerGoCover(ler("cover.out")), { caminho: "dup.ts", linhas_total: 1, linhas_cobertas: 1, pct: 100, formato: "lcov" as const }];
    const c = casarCaminhos(brutos, projeto, "/home/ci/work/proj");
    expect(c.map((x) => x.arquivo).sort()).toEqual(["app/views.py", "pkg/calc/calc.go", "src/main/java/com/acme/pedidos/PedidoService.java", "src/servico.ts", "src/util.ts"]);
    const pastas = coberturaPorPasta(c);
    expect(pastas.find((p) => p.pasta === "src")).toMatchObject({ linhas_total: 6, linhas_cobertas: 4, pct: 66.67, arquivos: 2 });
  });
  it("relatório mais velho que o código gera aviso", () => {
    expect(avisoDefasagem(1_000_000, 1_000_000 + 3 * 86_400_000)).toMatch(/3 dia/);
    expect(avisoDefasagem(5, 5)).toBeNull();
  });
});

const sim = (nome: string, tipo: SimboloBruto["tipo"] = "funcao", exportado = true): SimboloBruto => ({ nome, qualificado: nome, tipo, linha: 1, linha_fim: 2, exportado, visibilidade: null, complexidade: 1, assinatura: nome, doc: null, decoradores: [] });
const arq = (caminho: string, p: Partial<Extracao> = {}): ArquivoMapa => ({ caminho, extracao: { versao_extrator: VERSAO_EXTRATOR, linguagem: "typescript", hash: "h", loc: 1, loc_codigo: 1, loc_comentario: 0, complexidade_total: 0, complexidade_max: 0, erros_parse: 0, e_teste: false, e_gerado: false, truncado: false, simbolos: [], imports: [], chamadas: [], herancas: [], entradas: [], dados: [], padroes: [], dinamicos: [], ...p } });

describe("convenções de nome de teste", () => {
  it.each([
    ["src/a.test.ts", "a"],
    ["src/__tests__/a.spec.js", "a"],
    ["tests/test_calc.py", "calc"],
    ["pkg/calc_test.go", "calc"],
    ["spec/models/user_spec.rb", "user"],
    ["src/test/java/com/x/PedidoServiceTest.java", "PedidoService"],
    ["Tests/PedidoTests.cs", "Pedido"],
    ["tests/CalcTest.php", "Calc"],
  ])("%s → %s", (c, base) => {
    expect(baseDoAlvoPorConvencao(c)?.base ?? base).toBe(base);
    expect(ehCaminhoDeTeste(c)).toBe(true);
  });
  it("arquivo comum não é teste", () => {
    expect(ehCaminhoDeTeste("src/atestado.ts")).toBe(false);
    expect(baseDoAlvoPorConvencao("src/latest.ts")).toBeNull();
  });
});

describe("analisarTestes", () => {
  const arquivos = [
    arq("src/servico.ts", { simbolos: [sim("calcular")] }),
    arq("src/servico.test.ts", { e_teste: true, imports: [{ especificador: "vitest", tipo: "estatico", linha: 1, so_tipo: false, nomes: [{ nome: "it", alias: null }] }, { especificador: "./servico", tipo: "estatico", linha: 2, so_tipo: false, nomes: [{ nome: "calcular", alias: null }] }], chamadas: [{ de: null, alvo: "calcular", receptor: null, tipo: "chamada", linha: 5 }] }),
    arq("src/parcial.ts", { simbolos: [sim("a")] }),
    arq("tests/parcial.test.ts", { e_teste: true, imports: [{ especificador: "jest", tipo: "estatico", linha: 1, so_tipo: false, nomes: [] }] }),
    arq("src/sem.ts", { simbolos: [sim("b")] }),
    arq("src/tipos.ts", { simbolos: [sim("T", "tipo")] }),
    arq("app/models.py", { linguagem: "python", simbolos: [sim("M", "classe")] }),
    arq("tests/test_models.py", { linguagem: "python", e_teste: true }),
  ];
  const importa = [{ de: "arq:src/servico.test.ts", para: "arq:src/servico.ts", confianca: "exata" as const, linha: 2 }];
  const r = analisarTestes(arquivos, { importa });
  const estado = (c: string): string | undefined => r.arquivos.find((a) => a.caminho === c)?.estado;
  it("existente (import exato + símbolo exportado), parcial (só convenção), ausente e não aplicável", () => {
    expect(estado("src/servico.ts")).toBe("existente");
    expect(estado("src/parcial.ts")).toBe("parcial");
    expect(estado("app/models.py")).toBe("parcial");
    expect(estado("src/sem.ts")).toBe("ausente");
    expect(estado("src/tipos.ts")).toBe("nao_aplicavel");
    expect(r.arquivos.every((a) => a.fonte === "estimada")).toBe(true);
    expect(resumoPorEstado(r.arquivos)).toEqual({ existente: 1, parcial: 2, ausente: 1, nao_aplicavel: 1 });
  });
  it("arestas testa: exata por import, heurística por convenção", () => {
    expect(r.arestas.map((a) => `${a.de}>${a.para}:${a.confianca}`)).toEqual([
      "arq:src/servico.test.ts>arq:src/servico.ts:exata",
      "arq:tests/parcial.test.ts>arq:src/parcial.ts:heuristica",
      "arq:tests/test_models.py>arq:app/models.py:heuristica",
    ]);
    expect(r.arestas[0]?.evidencias).toEqual(["src/servico.test.ts:2"]);
  });
  it("estatísticas para o stackx: co-localizado × pasta própria, formas de nome e runner", () => {
    expect(r.estatisticas).toEqual({ total_testes: 3, colocalizado: 1, pasta_propria: 2, formas_de_nome: { ".test.": 2, test_: 1 }, runners: { vitest: 1, jest: 1 } });
  });
  it("cobertura medida decide o estado e vira fonte `medida`", () => {
    const m = analisarTestes(arquivos, { importa, cobertura: [{ caminho: "x", arquivo: "src/sem.ts", linhas_total: 10, linhas_cobertas: 9, pct: 90, formato: "lcov" }] });
    expect(m.arquivos.find((a) => a.caminho === "src/sem.ts")).toMatchObject({ estado: "existente", fonte: "medida", pct: 90 });
  });
});
