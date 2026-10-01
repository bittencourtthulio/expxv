import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conferirFontesLocais, listarAsar, maioresDoAsar, pesoMorto, tamanhoDaPasta } from "../../scripts/lib/pacote.mjs";

const requerer = createRequire(join(__dirname, "..", "..", "package.json"));
const asar = requerer("@electron/asar") as { createPackage(src: string, dest: string): Promise<void> };

function pasta(arquivos: Record<string, string>): string {
  const raiz = mkdtempSync(join(tmpdir(), "asar-src-"));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const c = join(raiz, caminho);
    mkdirSync(join(c, ".."), { recursive: true });
    writeFileSync(c, conteudo);
  }
  return raiz;
}

describe("inspeção do app.asar (scripts/lib/pacote.mjs)", () => {
  it("lista, ordena os maiores e acusa peso morto (mapa, teste, typings, fixtures) mas não os prompts", async () => {
    const origem = pasta({
      "dist/main/main.js": "x".repeat(500),
      "dist/main/main.js.map": "{}",
      "dist/nucleo/orquestracao/prompts/piloto.md": "# piloto",
      "node_modules/a/index.js": "y".repeat(2000),
      "node_modules/a/index.d.ts": "export {}",
      "node_modules/a/test/x.js": "",
      "node_modules/a/README.md": "# a",
    });
    const arquivo = join(mkdtempSync(join(tmpdir(), "asar-")), "app.asar");
    await asar.createPackage(origem, arquivo);
    const lista = listarAsar(arquivo);
    expect(maioresDoAsar(lista, 2).map((a) => a.caminho)).toEqual(["/node_modules/a/index.js", "/dist/main/main.js"]);
    expect(pesoMorto(lista).sort()).toEqual(["/dist/main/main.js.map", "/node_modules/a/README.md", "/node_modules/a/index.d.ts", "/node_modules/a/test/x.js"]);
  });

  it("fonte local: confere cada url(.ttf) dos CSS do renderer e recusa recurso remoto ou fonte ausente", async () => {
    const boa = pasta({
      "dist/renderer/index.html": "<html></html>",
      "dist/renderer/assets/a.css": "@font-face{src:url(./f.ttf)}",
      "dist/renderer/assets/f.ttf": "fonte",
    });
    const ruim = pasta({
      "dist/renderer/index.html": "<html></html>",
      "dist/renderer/assets/a.css": "@import url(https://fonts.googleapis.com/x); @font-face{src:url(./some.ttf)}",
    });
    const d = mkdtempSync(join(tmpdir(), "asar-"));
    await asar.createPackage(boa, join(d, "boa.asar"));
    await asar.createPackage(ruim, join(d, "ruim.asar"));
    expect(conferirFontesLocais(join(d, "boa.asar"), listarAsar(join(d, "boa.asar")))).toEqual({ fontes: ["/dist/renderer/assets/f.ttf"], erros: [] });
    const erros = conferirFontesLocais(join(d, "ruim.asar"), listarAsar(join(d, "ruim.asar"))).erros;
    expect(erros.some((e) => e.includes("remoto"))).toBe(true);
    expect(erros.some((e) => e.includes("fonte ausente"))).toBe(true);
  });

  it("tamanhoDaPasta soma os arquivos", () => {
    expect(tamanhoDaPasta(pasta({ "a/b.txt": "12345", "c.txt": "123" }))).toBe(8);
  });
});

describe("afterPack: caminho do spawn-helper do node-pty (bug do .unpacked.unpacked)", () => {
  const hook = requerer("./scripts/depois-empacotar.cjs") as { corrigirCaminhoDoHelper(p: string): string };
  const ORIGINAL = "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');\n";

  it("aplica a correção uma vez, é idempotente e acusa node-pty diferente do esperado", () => {
    const raiz = pasta({ "lib/unixTerminal.js": ORIGINAL });
    expect(hook.corrigirCaminhoDoHelper(raiz)).toBe("corrigido");
    expect(hook.corrigirCaminhoDoHelper(raiz)).toBe("ja-corrigido");
    const texto = readFileSync(join(raiz, "lib", "unixTerminal.js"), "utf8");
    // semântica: o caminho já desempacotado não é duplicado; o do asar é traduzido
    const aplicar = (c: string): string => c.replace(/app\.asar(?!\.unpacked)/, "app.asar.unpacked");
    expect(texto).toContain("(?!\\.unpacked)");
    expect(aplicar("/R/app.asar/node_modules/node-pty")).toBe("/R/app.asar.unpacked/node_modules/node-pty");
    expect(aplicar("/R/app.asar.unpacked/node_modules/node-pty")).toBe("/R/app.asar.unpacked/node_modules/node-pty");
    expect(hook.corrigirCaminhoDoHelper(pasta({ "lib/unixTerminal.js": "outra coisa" }))).toBe("ausente");
    expect(hook.corrigirCaminhoDoHelper(pasta({ "x.js": "" }))).toBe("ausente");
  });
});
