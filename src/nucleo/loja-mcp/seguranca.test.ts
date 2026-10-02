// Guardas estáticas de segurança do núcleo da Loja de MCPs (T-07B.35, itens 3/4): nenhum caminho de código
// usa shell, `npx`, `@latest`, `curl | sh`, `--force`, `sudo` ou instalação global; e só um módulo toca a rede
// (`saude-servidor.ts`, com `fetch` INJETADO e só em teste de saúde por clique).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;
const fontes = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const semComentarios = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const codigo = (f: string): string => semComentarios(readFileSync(join(DIR, f), "utf8"));

describe("guardas estáticas do núcleo da Loja", () => {
  it("há fontes para varrer", () => { expect(fontes.length).toBeGreaterThan(15); });

  const proibidos: Array<[string, RegExp]> = [
    ["shell: true", /shell\s*:\s*true/],
    ["exec/execSync/execFile", /\b(?:execSync|execFileSync|execFile)\b|(?<![.\w])exec\s*\(/],
    ["npx", /["'`]npx["'`]/],
    ["@latest", /@latest\b/],
    ["curl | sh", /curl[^\n"'`]*\|\s*(?:ba)?sh/],
    ["--force", /["'`]--force["'`]/],
    ["sudo", /["'`]sudo["'`]/],
    ["instalação global", /["'`](?:-g|--global)["'`]/],
    ["escrita na casa do usuário", /homedir\(\)/],
    ["eval", /\beval\s*\(|new Function\s*\(/],
  ];
  for (const [nome, re] of proibidos) {
    it(`nenhum fonte usa ${nome}`, () => {
      const achados = fontes.filter((f) => re.test(codigo(f)));
      expect(achados).toEqual([]);
    });
  }

  it("só saude-servidor.ts (teste de saúde explícito) e descoberta.ts (clique em Descobrir, T-07B.32) usam fetch/rede; nenhum módulo importa http/https/net/dgram/tls", () => {
    const usaFetch = fontes.filter((f) => /\?\?\s*fetch\b|globalThis\.fetch|(?<![.\w])fetch\s*\(/.test(codigo(f)));
    expect(usaFetch.sort()).toEqual(["descoberta.ts", "saude-servidor.ts"]);
    const rede = fontes.filter((f) => /from\s+["']node:(?:https?|net|dgram|tls|http2)["']/.test(codigo(f)));
    expect(rede).toEqual([]);
  });

  it("spawn só no executor e nos clientes de saúde (sempre shell:false e executável separado dos args)", () => {
    const comSpawn = fontes.filter((f) => /\bspawn\s*\(/.test(codigo(f))).sort();
    expect(comSpawn).toEqual(["executor.ts", "verificacao.ts"]);
    for (const f of comSpawn) expect(codigo(f)).toMatch(/shell:\s*false/);
  });

  it("nenhum fonte lê arquivo de ambiente de ninguém", () => {
    const achados = fontes.filter((f) => /["'`]\.env(?:\.[a-z]+)?["'`]|readFile[^\n]*\.env\b/.test(codigo(f)));
    expect(achados).toEqual([]);
  });

  it("segredos: nenhum fonte registra valor em console", () => {
    expect(fontes.filter((f) => /\bconsole\.(?:log|info|warn|error|debug)\b/.test(codigo(f)))).toEqual([]);
  });
});
