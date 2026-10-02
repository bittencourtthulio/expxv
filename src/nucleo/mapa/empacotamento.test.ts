import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// T-17.45 (parte estática do portão 6): tudo o que os workers do mapa carregam em tempo de execução precisa estar FORA do asar
// (`asarUnpack` do electron-builder.yml), senão `new Worker(...)` no app empacotado não encontra os módulos. O teste calcula o
// fecho de imports relativos de cada worker e confere cobertura pelos padrões de `asarUnpack`.

const RAIZ = resolve(__dirname, "../../..");
const SRC = join(RAIZ, "src");
const IMPORTS = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

function resolverFonte(de: string, rel: string): string | null {
  const base = resolve(dirname(de), rel);
  for (const c of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function fecho(entrada: string): string[] {
  const vistos = new Set<string>();
  const pilha = [join(SRC, entrada)];
  while (pilha.length > 0) {
    const arq = pilha.pop() as string;
    if (vistos.has(arq)) continue;
    vistos.add(arq);
    for (const m of readFileSync(arq, "utf8").matchAll(IMPORTS)) {
      const alvo = resolverFonte(arq, m[1] as string);
      if (alvo !== null) pilha.push(alvo);
    }
  }
  return [...vistos].map((a) => `dist/${relative(SRC, a).replace(/\.ts$/, ".js")}`.split("\\").join("/")).sort();
}

function cobre(padroes: string[], arquivo: string): boolean {
  return padroes.some((p) => (p.endsWith("/**/*") ? arquivo.startsWith(p.slice(0, -4)) : p === arquivo));
}

describe("empacotamento dos workers do mapa (portão 6)", () => {
  const cfg = parse(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")) as { asarUnpack?: string[] };
  const unpack = cfg.asarUnpack ?? [];

  it.each(["nucleo/mapa/worker-extracao.ts", "nucleo/mapa/worker-derivada.ts"])("o fecho de %s está fora do asar", (entrada) => {
    const faltando = fecho(entrada).filter((a) => !cobre(unpack, a));
    expect(faltando).toEqual([]);
  });

  it("as gramáticas e o runtime WASM ficam fora do asar", () => {
    expect(unpack).toContain("dist/nucleo/mapa/**/*");
    expect(unpack).toContain("node_modules/web-tree-sitter/**/*");
  });
});
