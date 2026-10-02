import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import { sondar, resolvedorTs } from "./ts";
import type { ArquivoParaResolver, ContextoResolucao, ResultadoResolucao } from "./comum";
import type { ImportBruto } from "../tipos";

// T-17.16: resolvedor JS/TS contra tabela de casos e contra o compilador TypeScript (oráculo SÓ no teste).

let ctx: ContextoResolucao;
let raiz: string;
let r: ResultadoResolucao;
const alvo = (arquivo: string, spec: string) => r.ligacoes.find((l) => l.arquivo === arquivo && l.especificador === spec);

beforeAll(async () => {
  ({ ctx, raiz } = await montarContexto("resolucao-ts"));
  r = resolvedorTs.resolver(ctx);
});

const M = "src/main.ts";

describe("resolvedor TS: tabela de casos (main.ts)", () => {
  const tabela: Array<[string, string, "exata" | "heuristica"]> = [
    ["./a", "arq:src/a.ts", "exata"],
    ["./dir", "arq:src/dir/index.ts", "exata"],
    ["./esm.js", "arq:src/esm.ts", "exata"],
    ["@app/b", "arq:src/b.ts", "exata"],
    ["@lib/util", "arq:packages/lib/src/util.ts", "exata"],
    ["@acme/lib", "arq:packages/lib/src/index.ts", "heuristica"],
    ["@acme/lib/util", "arq:packages/lib/src/util.ts", "heuristica"],
    ["node:fs", "ext:stdlib:fs", "exata"],
    ["path", "ext:stdlib:path", "exata"],
    ["react", "ext:npm:react", "exata"],
    ["react/jsx-runtime", "ext:npm:react", "exata"],
    ["@/c", "arq:src/c.ts", "heuristica"],
    ["./modulo.mjs", "arq:src/modulo.mts", "exata"],
    ["./legado", "arq:src/legado.js", "exata"],
    ["./re", "arq:src/re.ts", "exata"],
    ["./b", "arq:src/b.ts", "exata"],
  ];
  for (const [spec, esperado, conf] of tabela)
    it(`${spec} -> ${esperado} (${conf})`, () => {
      const l = r.ligacoes.filter((x) => x.arquivo === M && x.especificador === spec);
      expect(l.length).toBeGreaterThan(0);
      expect(l[0]?.para).toBe(esperado);
      expect(l[0]?.confianca).toBe(conf);
    });

  it("`export * from` vira reexporta; import type continua importa", () => {
    expect(r.arestas.find((a) => a.de === `arq:${M}` && a.para === "arq:src/re.ts")?.tipo).toBe("reexporta");
    expect(r.arestas.find((a) => a.de === `arq:${M}` && a.para === "arq:src/a.ts")?.tipo).toBe("importa");
  });
  it("ativo (css) é ignorado e não entra em não resolvidos", () => {
    expect(r.nao_resolvidos.some((n) => n.especificador === "./style.css")).toBe(false);
    expect(r.ignorados).toBeGreaterThanOrEqual(1);
  });
  it("não encontrado e fora da raiz são LISTADOS, nunca omitidos", () => {
    expect(r.nao_resolvidos).toContainEqual({ arquivo: M, especificador: "./nao-existe", linha: 13, motivo: "nao_encontrado" });
    expect(r.nao_resolvidos).toContainEqual({ arquivo: M, especificador: "../../fora", linha: 14, motivo: "fora_da_raiz" });
  });
  it("baseUrl do tsconfig do pacote resolve import nu; paths herdados por extends sem baseUrl próprio", () => {
    const l = alvo("packages/lib/src/usa-baseurl.ts", "util");
    expect(l?.para).toBe("arq:packages/lib/src/util.ts");
    expect(l?.confianca).toBe("exata");
    // `@app/*` herdado do base com baseUrl "src": não aponta para src/nada => vira não resolvido (nunca pacote npm falso)
    expect(alvo("packages/lib/src/usa-baseurl.ts", "@app/nada")?.para).toBeNull();
  });
  it("tsconfig com `extends` em ciclo não trava", () => {
    const a = new Map(ctx.arquivos);
    const lerTexto = (c: string): string | null => (c === "tsconfig.json" ? '{"extends":"./b.json"}' : c === "b.json" ? '{"extends":"./tsconfig.json"}' : null);
    const out = resolvedorTs.resolver({ arquivos: a, manifestos: [], lerTexto });
    expect(out.arestas.length).toBeGreaterThan(0);
  });
  it("especificador absoluto é recusado", () => {
    const a = new Map(ctx.arquivos);
    a.set("x.ts", { caminho: "x.ts", linguagem: "typescript", extracao: { simbolos: [], imports: [{ especificador: "/etc/passwd", tipo: "estatico", linha: 1, so_tipo: false, nomes: [] }] } });
    const out = resolvedorTs.resolver({ arquivos: a, manifestos: [] });
    expect(out.nao_resolvidos).toContainEqual({ arquivo: "x.ts", especificador: "/etc/passwd", linha: 1, motivo: "fora_da_raiz" });
  });
  it("alias ambíguo vira `ambiguo`, não chute", () => {
    const mk = (c: string, imports: ImportBruto[] = []): ArquivoParaResolver => ({ caminho: c, linguagem: "typescript", extracao: { simbolos: [], imports } });
    const a = new Map<string, ArquivoParaResolver>([
      ["a/util.ts", mk("a/util.ts")], ["b/util.ts", mk("b/util.ts")],
      ["m.ts", mk("m.ts", [{ especificador: "@/util", tipo: "estatico", linha: 1, so_tipo: false, nomes: [] }])],
    ]);
    expect(resolvedorTs.resolver({ arquivos: a, manifestos: [] }).nao_resolvidos[0]?.motivo).toBe("ambiguo");
  });
});

describe("sondar", () => {
  const tem = (...fs: string[]) => (c: string) => fs.includes(c);
  it("ordem: .ts antes de .js; arquivo exato; index", () => {
    expect(sondar("x/a", tem("x/a.js", "x/a.ts"))).toBe("x/a.ts");
    expect(sondar("x/a.ts", tem("x/a.ts"))).toBe("x/a.ts");
    expect(sondar("x/a", tem("x/a/index.tsx"))).toBe("x/a/index.tsx");
    expect(sondar("x/a", tem())).toBeNull();
  });
});

describe("oráculo: ts.resolveModuleName concorda com o resolvedor", () => {
  it("todo import que o compilador resolve para arquivo do projeto resolve igual", () => {
    const opcoes: ts.CompilerOptions = { baseUrl: raiz, paths: { "@app/*": ["src/*"], "@lib/*": ["packages/lib/src/*"] }, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowImportingTsExtensions: true };
    let comparados = 0;
    const divergencias: string[] = [];
    for (const l of r.ligacoes) {
      if (l.arquivo.startsWith("packages/lib/")) continue; // baseUrl diferente: coberto na tabela
      const o = ts.resolveModuleName(l.especificador, join(raiz, l.arquivo), opcoes, ts.sys).resolvedModule;
      if (o === undefined || o.resolvedFileName.includes("node_modules") || o.extension === ts.Extension.Dts) continue;
      comparados++;
      const rel = relative(raiz, o.resolvedFileName).split("\\").join("/");
      if (l.para !== `arq:${rel}`) divergencias.push(`${l.arquivo} ${l.especificador}: oráculo ${rel}, obtido ${l.para}`);
    }
    expect(comparados).toBeGreaterThanOrEqual(8);
    expect(divergencias).toEqual([]);
    void dirname;
  });
});
