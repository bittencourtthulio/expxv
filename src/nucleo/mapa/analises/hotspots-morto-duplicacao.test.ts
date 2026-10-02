import { describe, expect, it } from "vitest";
import { acharClones, impressoes, prepararDuplicacao, tokenizar } from "./duplicacao";
import { calcularHotspots, faixaDoScore, rankPercentil } from "./hotspots";
import { candidatosMortos, ROTULO_CANDIDATO, type ArestaUso } from "./morto";
import type { Extracao, SimboloBruto } from "../tipos";
import { VERSAO_EXTRATOR } from "../tipos";
import type { ArquivoMapa } from "./tipos";

describe("hotspots", () => {
  it("rank percentil com empates", () => {
    expect(rankPercentil([1, 2, 3])).toEqual([0, 0.5, 1]);
    expect(rankPercentil([5, 5, 5])).toEqual([0.5, 0.5, 0.5]);
    expect(rankPercentil([7])).toEqual([1]);
  });
  it("alto churn × alta complexidade fica no topo; churn sem complexidade e o inverso não aparecem quentes", () => {
    const r = calcularHotspots(
      [
        { caminho: "a.ts", churn_janela: 60, complexidade_max: 50, autores_n: 4, criado_git: "2020-01-01T00:00:00Z", commits_correcao: 9 },
        { caminho: "b.ts", churn_janela: 50, complexidade_max: 1 },
        { caminho: "c.ts", churn_janela: 1, complexidade_max: 40 },
        { caminho: "d.ts", churn_janela: 5, complexidade_max: 5 },
        { caminho: "e.ts", churn_janela: 0, complexidade_max: 90 },
      ],
      [{ a: "a.ts", b: "d.ts", co_alteracoes: 8, grau: 0.7 }],
      new Date("2021-01-01T00:00:00Z"),
    );
    expect(r.disponivel).toBe(true);
    expect(r.hotspots.map((h) => h.caminho)[0]).toBe("a.ts");
    expect(r.hotspots[0]).toMatchObject({ faixa: "quente", idade_dias: 366, autores_n: 4, commits_correcao: 9, parceiros: [{ caminho: "d.ts", co_alteracoes: 8, grau: 0.7 }] });
    expect(r.hotspots.find((h) => h.caminho === "b.ts")?.faixa).not.toBe("quente");
    expect(r.hotspots.find((h) => h.caminho === "e.ts")?.score).toBe(0);
    expect(faixaDoScore(0.3)).toBe("morno");
  });
  it("sem história: indisponível", () => {
    expect(calcularHotspots([{ caminho: "a", churn_janela: null, complexidade_max: 3 }])).toEqual({ disponivel: false, hotspots: [] });
  });
});

const sim = (q: string, extra: Partial<SimboloBruto> = {}): SimboloBruto => ({ nome: q, qualificado: q, tipo: "funcao", linha: 3, linha_fim: 5, exportado: true, visibilidade: null, complexidade: 1, assinatura: q, doc: null, decoradores: [], ...extra });
const arq = (caminho: string, p: Partial<Extracao> = {}): ArquivoMapa => ({ caminho, extracao: { versao_extrator: VERSAO_EXTRATOR, linguagem: "typescript", hash: "h", loc: 1, loc_codigo: 1, loc_comentario: 0, complexidade_total: 0, complexidade_max: 0, erros_parse: 0, e_teste: false, e_gerado: false, truncado: false, simbolos: [], imports: [], chamadas: [], herancas: [], entradas: [], dados: [], padroes: [], dinamicos: [], ...p } });
const uso = (tipo: string, de: string, para: string, confianca: "exata" | "heuristica" = "exata"): ArestaUso => ({ tipo, de, para, confianca });

describe("código morto candidato", () => {
  const arquivos = [
    arq("src/usado.ts", { simbolos: [sim("a")] }),
    arq("src/orfao.ts", { simbolos: [sim("b")] }),
    arq("src/heur.ts"),
    arq("src/handler.ts", { simbolos: [sim("h")] }),
    arq("src/decorado.ts", { simbolos: [sim("Ctl", { tipo: "classe", decoradores: ["@Controller()"] })] }),
    arq("src/lib/index.ts", { simbolos: [sim("pub")] }),
    arq("src/cfg.ts"),
    arq("src/x.test.ts", { e_teste: true }),
    arq("src/gerado.ts", { e_gerado: true }),
    arq("src/parcial.ts", { simbolos: [sim("vivo"), sim("sobra")] }),
  ];
  const arestas = [uso("importa", "arq:src/main.ts", "arq:src/usado.ts"), uso("importa", "arq:src/main.ts", "arq:src/heur.ts", "heuristica"), uso("importa", "arq:src/main.ts", "arq:src/parcial.ts"), uso("chama", "sim:src/main.ts#m", "sim:src/parcial.ts#vivo"), uso("importa", "arq:src/main.ts", "arq:src/handler.ts")];
  const r = candidatosMortos({
    arquivos,
    arestas,
    handlers: new Set(["sim:src/handler.ts#h"]),
    apiPublica: new Set(["src/lib/index.ts"]),
    referenciadosPorConfig: new Set(["src/cfg.ts"]),
    caminhosDeEntrada: new Set<string>(),
    idadeDias: new Map([["src/orfao.ts", 900], ["src/heur.ts", 900], ["src/parcial.ts", 900]]),
  });
  it("só candidatos legítimos; falsos positivos (handler, API pública, decorado, config, teste, gerado) ficam de fora", () => {
    const ids = r.map((c) => c.id);
    expect(ids).toContain("arq:src/orfao.ts");
    expect(ids).toContain("sim:src/parcial.ts#sobra");
    expect(ids).not.toContain("sim:src/parcial.ts#vivo");
    for (const nao of ["arq:src/usado.ts", "arq:src/handler.ts", "arq:src/lib/index.ts", "arq:src/cfg.ts", "arq:src/x.test.ts", "arq:src/gerado.ts", "sim:src/decorado.ts#Ctl"]) expect(ids).not.toContain(nao);
  });
  it("confiança: alta só com tudo satisfeito; heurística/idade desconhecida rebaixam", () => {
    expect(r.find((c) => c.id === "arq:src/orfao.ts")?.confianca).toBe("alta");
    expect(r.find((c) => c.id === "arq:src/heur.ts")?.confianca).toBe("media"); // só referência heurística
  });
  it("sem idade conhecida a confiança cai; recurso dinâmico rebaixa mais", () => {
    const base = candidatosMortos({ arquivos: [arq("a.ts")], arestas: [] });
    expect(base[0]?.confianca).toBe("media");
    const din = candidatosMortos({ arquivos: [arq("a.ts", { dinamicos: [{ tipo: "eval", linha: 1 }] })], arestas: [] });
    expect(din[0]?.confianca).toBe("baixa");
  });
  it("toda saída é rotulada candidato", () => {
    expect(r.every((c) => c.rotulo === ROTULO_CANDIDATO && /candidato/.test(c.rotulo))).toBe(true);
    expect(JSON.stringify(r).match(/morto/gi)?.every(() => /candidato a código morto/.test(JSON.stringify(r)))).toBe(true);
  });
});

const corpo = (nome: string): string =>
  Array.from({ length: 12 }, (_, i) => `  const v${i} = calcular(${nome}, ${i}, "x${i}") + outra(${i});\n  if (v${i} > 10) { registrar(v${i}); }`).join("\n");

describe("duplicação (winnowing)", () => {
  const licenca = "/* Copyright 2020 ACME. Todos os direitos reservados. Texto de licença repetido em todo arquivo do projeto inteiro. */\n";
  it("tokenização normaliza e ignora comentários e imports", () => {
    expect(tokenizar('import x from "y";\n// c\nconst a = 1; /* b */ foo("s");').map((t) => t.texto).join(" ")).toBe("const I = N ; I ( S ) ;");
  });
  it("clone plantado com identificadores renomeados é detectado; cabeçalho de licença repetido, não", () => {
    const a = prepararDuplicacao("a.ts", `${licenca}function f(p) {\n${corpo("p")}\n}\n`, "typescript");
    const b = prepararDuplicacao("b.ts", `${licenca}function g(q) {\n${corpo("q")}\n}\nfunction outra() { return 1; }\n`, "typescript");
    const c = prepararDuplicacao("c.ts", `${licenca}export const z = 3;\n`, "typescript");
    const r = acharClones([a, b, c]);
    expect(r.pares.length).toBeGreaterThanOrEqual(1);
    const p = r.pares[0]!;
    expect([p.a.caminho, p.b.caminho].sort()).toEqual(["a.ts", "b.ts"]);
    expect(p.tokens).toBeGreaterThanOrEqual(50);
    expect(r.pares.some((x) => [x.a.caminho, x.b.caminho].includes("c.ts"))).toBe(false);
    expect(r.classes[0]!.map((t) => t.caminho).sort()).toEqual(["a.ts", "b.ts"]);
  });
  it("winnowing garante pelo menos uma impressão por trecho de k+w-1 tokens", () => {
    const t = tokenizar(corpo("p"));
    expect(impressoes(t).length).toBeGreaterThan(0);
    expect(acharClones([prepararDuplicacao("a.ts", "const a = 1;", "typescript")]).pares).toEqual([]);
  });
});
