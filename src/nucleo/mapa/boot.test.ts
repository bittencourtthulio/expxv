import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P-248 (parcial): nada do mapa carrega no boot. O grafo ESTÁTICO de imports de `src/main/main.ts` não pode conter nenhum
// módulo de `src/nucleo/mapa` (o registro é preguiçoso: `await import(...)` só quando a tela Mapa é aberta), e dentro do
// próprio mapa nenhum módulo leve (tipos, esquema, contrato) puxa o runtime WASM.

const SRC = resolve(__dirname, "../..");

// só importações ESTÁTICAS (`import … from`, `export … from`); `import("…")` é carga preguiçosa e fica de fora
const ESTATICO = /^\s*(?:import|export)\s[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']|^\s*import\s*["'](\.{1,2}\/[^"']+)["']/gm;

function resolver(de: string, rel: string): string | null {
  const base = resolve(dirname(de), rel);
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function fecho(entrada: string): string[] {
  const vistos = new Set<string>();
  const pilha = [entrada];
  while (pilha.length > 0) {
    const arq = pilha.pop() as string;
    if (vistos.has(arq)) continue;
    vistos.add(arq);
    const texto = readFileSync(arq, "utf8");
    for (const m of texto.matchAll(ESTATICO)) {
      const alvo = resolver(arq, (m[1] ?? m[2]) as string);
      if (alvo !== null) pilha.push(alvo);
    }
  }
  return [...vistos].map((a) => relative(SRC, a).split("\\").join("/")).sort();
}

describe("o mapa não entra no boot (P-248, D-163)", () => {
  it("o grafo estático de imports de main.ts não contém src/nucleo/mapa", () => {
    const main = join(SRC, "main", "main.ts");
    expect(existsSync(main)).toBe(true);
    const grafo = fecho(main);
    expect(grafo.length).toBeGreaterThan(10); // a análise de imports de fato andou
    expect(grafo.filter((a) => a.startsWith("nucleo/mapa/"))).toEqual([]);
  });

  it("tipos, esquema e contrato não carregam o runtime WASM nem o pool (leves por construção)", () => {
    for (const leve of ["tipos.ts", "esquema.ts", "contrato.ts", "validacao.ts", "linguagens.ts"]) {
      const g = fecho(join(SRC, "nucleo", "mapa", leve));
      expect(g.filter((a) => /gramaticas|pool|worker-extracao|armazem|varredura/.test(a)), leve).toEqual([]);
    }
  });

  it("o worker de extração só depende do que cabe no `dist/nucleo/mapa` (fecho sem banco, vcs ou electron)", () => {
    const g = fecho(join(SRC, "nucleo", "mapa", "worker-extracao.ts"));
    expect(g.filter((a) => !a.startsWith("nucleo/mapa/"))).toEqual([]);
    const texto = g.map((a) => readFileSync(join(SRC, a), "utf8")).join("\n");
    expect(texto).not.toMatch(/from\s*["']electron["']/);
  });
});
