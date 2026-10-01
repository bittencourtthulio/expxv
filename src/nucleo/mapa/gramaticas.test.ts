import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  carregarGramatica,
  carregarGramaticaPorNome,
  compilarConsulta,
  estatisticasGramaticas,
  gramaticasCarregadas,
  iniciarRuntime,
  liberarGramaticas,
  obterParser,
  resolverPastaWasm,
  VERSAO_GRAMATICAS_VSCODE,
  VERSAO_WEB_TREE_SITTER,
} from "./gramaticas";
import { arquivoWasm, detectarLinguagem, GRAMATICAS_EMBARCADAS, linguagemPorShebang, temGramatica } from "./linguagens";
import { LINGUAGENS, type Linguagem } from "./tipos";

const RAIZ = resolve(__dirname, "../../..");
const pkg = (p: string): { version: string } => JSON.parse(readFileSync(join(RAIZ, p), "utf8"));

afterAll(() => liberarGramaticas());

describe("guarda de versão (D-160): as duas dependências andam juntas e exatas", () => {
  it("package.json fixa as versões exatas (sem ^ nem ~)", () => {
    const j = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(j.dependencies["web-tree-sitter"]).toBe("0.27.0");
    expect(j.devDependencies["@vscode/tree-sitter-wasm"]).toBe("0.3.1");
    expect(j.dependencies["@vscode/tree-sitter-wasm"]).toBeUndefined();
  });

  it("o instalado em node_modules é o esperado (as gramáticas de tree-sitter-wasms NÃO carregam neste runtime)", () => {
    expect(pkg("node_modules/web-tree-sitter/package.json").version).toBe(VERSAO_WEB_TREE_SITTER);
    expect(pkg("node_modules/@vscode/tree-sitter-wasm/package.json").version).toBe(VERSAO_GRAMATICAS_VSCODE);
    expect(VERSAO_WEB_TREE_SITTER).toBe("0.27.0");
    expect(VERSAO_GRAMATICAS_VSCODE).toBe("0.3.1");
  });
});

const AMOSTRA: Record<string, string> = {
  typescript: "const olá: string = 'olá';",
  tsx: "const a = <b>olá</b>;",
  javascript: "const olá = 'olá';",
  python: "olá = 'olá'\n",
  java: "class Ola { String s = \"olá\"; }",
  php: "<?php $ola = 'olá';",
  "c-sharp": "class Ola { string s = \"olá\"; }",
  go: "package ola\nvar s = \"olá\"\n",
  ruby: "ola = 'olá'\n",
  rust: "fn ola() { let s = \"olá\"; }",
  cpp: "int main() { const char* s = \"olá\"; }",
};

describe("carregador de gramáticas WASM (T-17.02)", () => {
  it("a tabela cobre as 11 gramáticas embarcadas e cada arquivo .wasm existe", () => {
    expect([...GRAMATICAS_EMBARCADAS]).toEqual(Object.keys(AMOSTRA).sort());
    const pasta = resolverPastaWasm();
    for (const g of GRAMATICAS_EMBARCADAS) expect(statSync(join(pasta, arquivoWasm(g))).isFile()).toBe(true);
  });

  it("carrega TODAS as gramáticas e parseia um 'olá' de cada, sem erro de sintaxe", async () => {
    await iniciarRuntime();
    for (const g of GRAMATICAS_EMBARCADAS) {
      const lang = await carregarGramaticaPorNome(g);
      expect(lang.abiVersion, `ABI de ${g}`).toBeGreaterThanOrEqual(13);
      const parser = await obterParser(g === "c-sharp" ? "csharp" : (g as Linguagem));
      expect(parser, g).not.toBeNull();
      const arvore = parser!.parse(AMOSTRA[g] as string);
      expect(arvore!.rootNode.hasError, `erro de sintaxe em ${g}`).toBe(false);
      expect(arvore!.rootNode.childCount).toBeGreaterThan(0);
      arvore!.delete();
    }
    expect(gramaticasCarregadas()).toEqual([...GRAMATICAS_EMBARCADAS]);
  });

  it("cache: segunda carga devolve a mesma gramática; carga é preguiçosa por linguagem", async () => {
    liberarGramaticas();
    expect(gramaticasCarregadas()).toEqual([]);
    const a = await carregarGramatica("typescript");
    const b = await carregarGramatica("typescript");
    expect(a).toBe(b);
    expect(gramaticasCarregadas()).toEqual(["typescript"]);
    expect(await carregarGramatica("outra")).toBeNull();
  });

  it("tempos: runtime e Language.load por gramática (registrados no log; teto frouxo de 150 ms, o orçamento de 15 ms vai para tests/perf)", async () => {
    liberarGramaticas();
    for (const g of GRAMATICAS_EMBARCADAS) await carregarGramaticaPorNome(g);
    const e = estatisticasGramaticas();
    const pior = Math.max(...Object.values(e.carregadas));
    console.log(`runtime ${e.runtime_ms.toFixed(1)} ms; load por gramática (ms): ${JSON.stringify(Object.fromEntries(Object.entries(e.carregadas).map(([k, v]) => [k, +v.toFixed(1)])))}`);
    expect(pior).toBeLessThan(150);
  });

  it("compilarConsulta usa cache por (gramática, fonte)", async () => {
    const q1 = await compilarConsulta("typescript", "(function_declaration name: (identifier) @n)");
    const q2 = await compilarConsulta("typescript", "(function_declaration name: (identifier) @n)");
    expect(q1).toBe(q2);
    const parser = await obterParser("typescript");
    const arvore = parser!.parse("function a() {} function b() {}")!;
    expect(q1!.captures(arvore.rootNode).map((c) => c.node.text)).toEqual(["a", "b"]);
    arvore.delete();
  });

  it("peso: soma dos .wasm embarcados + runtime dentro do teto (ver pendência P-245: o plano estimou 18 MB; medido, 18,6 MiB)", () => {
    const pasta = resolverPastaWasm();
    let total = statSync(join(RAIZ, "node_modules/web-tree-sitter/web-tree-sitter.wasm")).size + statSync(join(RAIZ, "node_modules/web-tree-sitter/web-tree-sitter.cjs")).size;
    for (const g of GRAMATICAS_EMBARCADAS) total += statSync(join(pasta, arquivoWasm(g))).size;
    console.log(`peso das gramáticas + runtime: ${(total / 1048576).toFixed(2)} MiB`);
    expect(total).toBeLessThanOrEqual(20 * 1048576); // P-271: peso aceito pelo dono (Onda 1+2 no instalador)
  });

  it("licenças das gramáticas e do runtime constam em THIRD-PARTY-LICENSES.md", () => {
    const t = readFileSync(join(RAIZ, "THIRD-PARTY-LICENSES.md"), "utf8");
    for (const nome of ["web-tree-sitter", "@vscode/tree-sitter-wasm", "tree-sitter-typescript", "tree-sitter-javascript", "tree-sitter-python", "tree-sitter-java", "tree-sitter-php", "tree-sitter-c-sharp", "tree-sitter-go", "tree-sitter-ruby", "tree-sitter-rust", "tree-sitter-cpp"]) {
      expect(t, nome).toContain(nome);
    }
  });
});

describe("tabela extensão → linguagem", () => {
  it("extensões e shebang", () => {
    expect(detectarLinguagem("a/b.ts")).toBe("typescript");
    expect(detectarLinguagem("a/b.TSX")).toBe("tsx");
    expect(detectarLinguagem("a/b.mjs")).toBe("javascript");
    expect(detectarLinguagem("a/b.jsx")).toBe("jsx");
    expect(detectarLinguagem("a/b.h")).toBe("cpp");
    expect(detectarLinguagem("a/b.c")).toBe("c");
    expect(detectarLinguagem("a/b.kt")).toBe("outra");
    expect(detectarLinguagem("a/b.md")).toBeNull();
    expect(detectarLinguagem("bin/run", "#!/usr/bin/env node")).toBe("javascript");
    expect(detectarLinguagem("bin/run", "#!/usr/bin/python3")).toBe("python");
    expect(detectarLinguagem("bin/run", "#!/bin/sh")).toBeNull();
    expect(linguagemPorShebang("sem shebang")).toBeNull();
  });

  it("toda linguagem com gramática tem arquivo mapeado; `outra` não", () => {
    for (const l of LINGUAGENS) expect(temGramatica(l)).toBe(l !== "outra");
  });
});
