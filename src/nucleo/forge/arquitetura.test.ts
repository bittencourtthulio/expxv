import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// T-06.22: nenhuma tela/camada importa adaptador concreto (github/gitlab/bitbucket/azure/rest); só `forge/index.ts`.

const RAIZ = resolve(__dirname, "../../..");
const FORGE = resolve(__dirname);
const ADAPTADORES = "(github|gitlab|bitbucket|azure|rest)";

function ts(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "dist" || n === "dist-app" || n === ".git") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) ts(p, acc);
    else if (/\.(ts|tsx|mts|cts)$/.test(n)) acc.push(p);
  }
  return acc;
}
const importa = (src: string, re: RegExp): boolean => re.test(src);

describe("arquitetura do Forge (T-06.22)", () => {
  it("nenhum arquivo fora de forge/ importa um adaptador concreto", () => {
    const re = new RegExp(`(from\\s+|import\\(\\s*|require\\(\\s*)["'][^"']*forge/${ADAPTADORES}["']`);
    const violacoes = [...ts(join(RAIZ, "src")), ...ts(join(RAIZ, "tests"))]
      .filter((f) => !f.startsWith(FORGE + sep) && !relative(RAIZ, f).startsWith(join("tests", "fixtures", "forge")))
      .filter((f) => importa(readFileSync(f, "utf8"), re))
      .map((f) => relative(RAIZ, f));
    expect(violacoes).toEqual([]);
  });
  it("dentro de forge/ só index.ts (e os testes do próprio adaptador) importam adaptadores", () => {
    const re = new RegExp(`(from\\s+|import\\(\\s*|require\\(\\s*)["']\\./${ADAPTADORES}["']`);
    const quem = ts(FORGE)
      .filter((f) => importa(readFileSync(f, "utf8"), re))
      .map((f) => relative(FORGE, f))
      .filter((f) => f !== "index.ts" && !new RegExp(`^${ADAPTADORES}\\.test\\.ts$`).test(f) && f !== "arquitetura.test.ts");
    // `rest.ts` é cliente compartilhado de bitbucket/azure; os demais módulos comuns nunca dependem de adaptador.
    expect(quem.filter((f) => !/^(bitbucket|azure)\.ts$/.test(f))).toEqual([]);
  });
  it("adaptadores não dependem uns dos outros", () => {
    for (const a of ["github", "gitlab", "bitbucket", "azure"]) {
      const src = readFileSync(join(FORGE, `${a}.ts`), "utf8");
      const outros = ["github", "gitlab", "bitbucket", "azure"].filter((o) => o !== a);
      expect(outros.filter((o) => new RegExp(`from\\s+["']\\./${o}["']`).test(src)), a).toEqual([]);
    }
  });
  it("o detector da própria regra pega o import proibido (guarda contra falso negativo)", () => {
    const re = new RegExp(`(from\\s+|import\\(\\s*|require\\(\\s*)["'][^"']*forge/${ADAPTADORES}["']`);
    expect(re.test(`import { x } from "../nucleo/forge/github";`)).toBe(true);
    expect(re.test(`const m = await import("../../forge/gitlab")`)).toBe(true);
    expect(re.test(`import { abrirForge } from "../nucleo/forge";`)).toBe(false);
    expect(re.test(`import type { Forge } from "../nucleo/forge/forge";`)).toBe(false);
  });
  it("a interface Forge expõe detectar, prs, checks, issues e capacidades; nenhum adaptador comercial-específico vaza", async () => {
    const { criarForge } = await import("./index");
    const f = criarForge("github", { host: "github.com", caminho: "acme/app" }, { cwd: process.cwd() });
    expect(typeof f.detectar).toBe("function");
    expect(typeof f.capacidades).toBe("function");
    expect(Object.keys(f.prs)).toEqual(expect.arrayContaining(["listar", "ver", "criar", "mesclar", "comentar"]));
    expect(Object.keys(f.checks)).toEqual(expect.arrayContaining(["doPr", "execucoes", "log", "reexecutarFalhos"]));
    expect(Object.keys(f.issues)).toEqual(expect.arrayContaining(["listar", "ver", "criar", "comentar"]));
  });
});
