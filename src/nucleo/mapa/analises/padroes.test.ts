import { describe, expect, it } from "vitest";
import type { Extracao, PadraoBruto, SimboloBruto } from "../tipos";
import { VERSAO_EXTRATOR } from "../tipos";
import { analisarPadroes, classificarForca } from "./padroes";
import type { ArquivoMapa } from "./tipos";
import { QUEM_VALIDA, termosDe, zonasCandidatas } from "./zonas";

describe("classificarForca (rótulos do stackx)", () => {
  const v = (nome: string, n: number, criado_medio?: number) => ({ nome, n, ...(criado_medio === undefined ? {} : { criado_medio }) });
  it.each([
    ["AUSENTE", [], "AUSENTE", "lacuna"],
    ["AUSENTE com variantes zeradas", [v("a", 0)], "AUSENTE", "lacuna"],
    ["ÚNICO CASO", [v("a", 1)], "ÚNICO CASO", "convencao_fraca"],
    ["UNÂNIME", [v("a", 12)], "UNÂNIME", "convencao"],
    ["MAJORITÁRIO com minoria trivial (< 10%)", [v("a", 19), v("b", 1)], "MAJORITÁRIO 19/20", "convencao_com_excecao"],
    ["minoria relevante vira CONFLITO", [v("a", 8), v("b", 2)], "CONFLITO", "conflito"],
    ["sem maioria", [v("a", 5), v("b", 5)], "CONFLITO", "conflito"],
    ["maioria exata de 50% não é maioria", [v("a", 3), v("b", 3)], "CONFLITO", "conflito"],
    ["minoria trivial mas mais recente = CONFLITO", [v("a", 30, 1000), v("b", 1, 2000)], "CONFLITO", "conflito"],
    ["minoria trivial e mais antiga continua MAJORITÁRIO", [v("a", 30, 2000), v("b", 1, 1000)], "MAJORITÁRIO 30/31", "convencao_com_excecao"],
  ] as const)("%s", (_nome, variantes, forca, destino) => {
    const r = classificarForca(variantes);
    expect(r.forca).toBe(forca);
    expect(r.destino).toBe(destino);
  });
  it("traz total, minoria e nota", () => {
    expect(classificarForca([v("a", 9), v("b", 1)])).toMatchObject({ dominante: "a", total: 10, minoria: 1 });
  });
});

const sim = (nome: string, assinatura = nome, extra: Partial<SimboloBruto> = {}): SimboloBruto => ({ nome, qualificado: nome, tipo: "funcao", linha: 3, linha_fim: 5, exportado: true, visibilidade: null, complexidade: 1, assinatura, doc: null, decoradores: [], ...extra });
const arq = (caminho: string, p: Partial<Extracao> = {}): ArquivoMapa => ({ caminho, extracao: { versao_extrator: VERSAO_EXTRATOR, linguagem: "typescript", hash: "h", loc: 1, loc_codigo: 1, loc_comentario: 0, complexidade_total: 0, complexidade_max: 0, erros_parse: 0, e_teste: false, e_gerado: false, truncado: false, simbolos: [], imports: [], chamadas: [], herancas: [], entradas: [], dados: [], padroes: [], dinamicos: [], ...p } });
const thr: PadraoBruto = { tipo: "throw", nome: null, linha: 7 };

describe("analisarPadroes", () => {
  const arquivos = [
    arq("src/pedidos/a.ts", { padroes: [thr], simbolos: [sim("calcularTotal", "function calcularTotal(valor: number): number")] }),
    arq("src/pedidos/b.ts", { padroes: [thr], simbolos: [sim("aplicarDesconto", "function aplicarDesconto(desconto: number): number")] }),
    arq("src/pedidos/c.ts", { simbolos: [sim("lerSaldo", "function lerSaldo(): Result<Decimal, Erro>")] }),
    arq("src/pedidos/d.ts", { simbolos: [sim("somarValor", "function somarValor(valor: Decimal): Decimal")] }),
    arq("src/pedidos/e.ts", { simbolos: [sim("somarPreco", "function somarPreco(): Decimal")], padroes: [{ tipo: "env", nome: "CHAVE_API", linha: 2 }, { tipo: "env", nome: "CHAVE_API", linha: 9 }] }),
    arq("src/pedidos/f.test.ts", { e_teste: true, padroes: [thr], imports: [{ especificador: "vitest", tipo: "estatico", linha: 1, so_tipo: false, nomes: [] }] }),
    arq("src/util/g.ts", { imports: [{ especificador: "dayjs", tipo: "estatico", linha: 1, so_tipo: false, nomes: [] }], dados: [{ tabela: "x", operacao: "le", de: null, linha: 4, confianca: "exata", fonte: "prisma" }, { tabela: "y", operacao: "le", de: null, linha: 5, confianca: "exata", fonte: "sql" }] }),
  ];
  const criado = new Map([["src/pedidos/a.ts", Date.parse("2020-01-01")], ["src/pedidos/b.ts", Date.parse("2020-03-01")], ["src/pedidos/c.ts", Date.parse("2024-01-01")]]);
  const r = analisarPadroes(arquivos, criado);
  const eixo = (e: string) => r.eixos.find((x) => x.eixo === e)!;

  it("dois dialetos de erro → CONFLITO com contagens e recência; teste não conta", () => {
    expect(eixo("erro").variantes.map((x) => [x.nome, x.arquivos])).toEqual([["excecao (throw)", 2], ["retorno tipado de erro (Result/error)", 1]]);
    expect(eixo("erro").forca).toMatchObject({ forca: "CONFLITO", total: 3, minoria: 1 });
    expect(eixo("erro").variantes[0]?.criado_medio).toBe("2020-01-31T00:00:00.000Z");
    expect(eixo("erro").variantes[0]?.evidencias).toEqual(["src/pedidos/a.ts:7", "src/pedidos/b.ts:7"]);
  });
  it("float e Decimal no mesmo módulo → CONFLITO (2 × 3)", () => {
    const d = eixo("dinheiro");
    expect(d.variantes.map((x) => [x.nome, x.arquivos])).toEqual([["decimal / centavos", 3], ["ponto flutuante (float/double/number)", 2]]);
    expect(d.forca.forca).toBe("CONFLITO");
    expect(d.variantes[0]?.por_pasta).toEqual({ "src/pedidos": 3 });
  });
  it("acesso a dados, data/hora e estilo de teste", () => {
    expect(eixo("acesso_dados").variantes.map((x) => x.nome).sort()).toEqual(["ORM (prisma)", "SQL cru"]);
    expect(eixo("data_hora").forca.forca).toBe("ÚNICO CASO");
    expect(eixo("estilo_teste").forca.forca).toBe("ÚNICO CASO");
    expect(eixo("di").forca.forca).toBe("AUSENTE");
  });
  it("variáveis de ambiente: só NOMES, nunca valores", () => {
    expect(r.variaveis_de_ambiente).toEqual([{ nome: "CHAVE_API", arquivos: 1 }]);
    const x = analisarPadroes([arq("a.ts", { padroes: [{ tipo: "env", nome: "TOKEN_X", linha: 1 }], simbolos: [sim("f", "function f()")] })]);
    expect(JSON.stringify(x)).not.toContain("segredo-do-valor");
  });
  it("idioma dos nomes por pasta", () => {
    expect(r.idioma_por_pasta.find((p) => p.pasta === "src/pedidos")?.proporcao_pt).toBe(1);
    const mist = analisarPadroes([arq("a/x.ts", { simbolos: [sim("getUser"), sim("createOrder")] }), arq("b/y.ts", { simbolos: [sim("calcularTotal"), sim("buscarCliente")] })]);
    expect(mist.eixos.find((e) => e.eixo === "idioma")?.forca.forca).toBe("CONFLITO");
  });
});

describe("zonas de risco candidatas", () => {
  it("termos separam camelCase, snake_case e ignoram acento", () => {
    expect(termosDe("emitirNFe_SPED/Folha-Pagamento")).toEqual(["emitir", "nfe", "sped", "folha", "pagamento"]);
    expect(termosDe("Cobrança")).toEqual(["cobranca"]);
  });
  it("zona fiscal candidata com as pastas corretas; testes e gerados ignorados; sempre candidata", () => {
    const z = zonasCandidatas({
      arquivos: [
        arq("src/fiscal/nfe/emitir.ts", { simbolos: [sim("calcularICMS")] }),
        arq("src/fiscal/sped/gerar.ts"),
        arq("src/relatorios/vendas.ts", { simbolos: [sim("calcularImposto", "x", { linha: 12 })] }),
        arq("src/fiscal/nfe/emitir.test.ts", { e_teste: true }),
        arq("src/web/tela.ts"),
        arq("src/auth/login.ts"),
      ],
      tabelas: ["notas_fiscais", "usuarios", "tax_rates"],
    });
    const fiscal = z.find((x) => x.categoria === "fiscal")!;
    expect(fiscal.pastas).toEqual(["src/fiscal/nfe", "src/fiscal/sped", "src/relatorios"]);
    expect(fiscal.arquivos).toEqual(["src/fiscal/nfe/emitir.ts", "src/fiscal/sped/gerar.ts", "src/relatorios/vendas.ts"]);
    expect(fiscal.tabelas).toEqual(["notas_fiscais", "tax_rates"]);
    expect(fiscal.simbolos).toEqual(["src/fiscal/nfe/emitir.ts#calcularICMS", "src/relatorios/vendas.ts#calcularImposto"]);
    expect(fiscal.evidencias).toContain("src/relatorios/vendas.ts:12");
    expect(z.find((x) => x.categoria === "autenticacao")?.arquivos).toEqual(["src/auth/login.ts"]);
    expect(z.every((x) => x.rotulo === "candidata" && x.quem_valida === QUEM_VALIDA)).toBe(true);
    expect(z.some((x) => x.arquivos.includes("src/web/tela.ts") || x.arquivos.includes("src/fiscal/nfe/emitir.test.ts"))).toBe(false);
  });
  it("sem ocorrências: nenhuma zona", () => {
    expect(zonasCandidatas({ arquivos: [arq("src/a.ts")] })).toEqual([]);
  });
});
