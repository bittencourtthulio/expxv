import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PRODUTO } from "../src/nucleo/produto";

// D-01: o nome do produto mora em src/nucleo/produto.ts. Nenhum outro arquivo de src/ carrega o
// nome literal nem ids derivados (scheme, appId, pasta, prefixos).

const RAIZ = resolve(__dirname, "..");
const EXTENSOES = new Set([".ts", ".tsx", ".css", ".html", ".mjs", ".cjs", ".js", ".json"]);
const PERMITIDOS = new Set(["src/nucleo/produto.ts"]);
// testes podem nomear pastas temporárias etc.; a regra vale para o código que vai no pacote.
const ehTeste = (caminho: string): boolean => /\.test\.tsx?$/.test(caminho);

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const info = statSync(caminho);
    if (info.isDirectory()) {
      if (nome === "node_modules" || nome === "assets") continue;
      arquivos(caminho, acc);
    } else if ([...EXTENSOES].some((e) => nome.endsWith(e))) {
      acc.push(caminho);
    }
  }
  return acc;
}

describe("varredura de marca (D-01)", () => {
  const candidatos = arquivos(join(RAIZ, "src")).filter((c) => !PERMITIDOS.has(relative(RAIZ, c)) && !ehTeste(c));
  const termos = [PRODUTO.nome, PRODUTO.id, PRODUTO.appId, PRODUTO.scheme].map((t) => t.toLowerCase());

  it("varre ao menos um arquivo de src/ (a varredura não é vazia)", () => {
    expect(candidatos.length).toBeGreaterThan(0);
  });

  it("nenhum arquivo de src/ fora de produto.ts contém o nome literal ou ids derivados", () => {
    const vazamentos: string[] = [];
    for (const arquivo of candidatos) {
      const texto = readFileSync(arquivo, "utf8").toLowerCase();
      for (const termo of termos) {
        if (texto.includes(termo)) vazamentos.push(`${relative(RAIZ, arquivo)} contém "${termo}"`);
      }
    }
    expect(vazamentos).toEqual([]);
  });
});
