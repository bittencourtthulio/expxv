// Orçamento de tamanho do sistema de partes (D-674): as 86 receitas + arquétipos + partes, minificados e comprimidos, e o CSS do bichinho.
// Mede com o próprio vite (em memória, nada gravado fora de os.tmpdir) e falha se estourar: corrige-se a causa, nunca o limite.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

export const LIMITE_SISTEMA_PARTES_GZ = 11 * 1024;
export const LIMITE_CSS_GZ = 5.5 * 1024;

describe("orçamento de tamanho do bichinho (D-674)", () => {
  it("sistema de partes (receitas + arquétipos + partes) ≤ 11 KB gz e CSS ≤ 5,5 KB gz", async () => {
    const { build } = await import("vite");
    const pasta = mkdtempSync(join(tmpdir(), "bi-orcamento-"));
    try {
      const aqui = __dirname.replace(/\\/g, "/");
      const entrada = join(pasta, "entrada.ts");
      writeFileSync(entrada, `export * from "${aqui}/montar";\nexport { RECEITAS } from "${aqui}/receitas";\n`);
      const r = await build({
        configFile: false, mode: "production", root: join(__dirname, "..", "..", "..", ".."), logLevel: "silent", esbuild: { jsx: "automatic", jsxDev: false } as never,
        build: { write: false, minify: true, target: "chrome138", lib: { entry: entrada, formats: ["es"], fileName: "e" }, rollupOptions: { external: ["react", "react/jsx-runtime"] } },
      });
      const saida = (Array.isArray(r) ? r[0]! : r) as { output: Array<{ type: string; code?: string }> };
      const codigo = saida.output.find((o) => o.type === "chunk")!.code!;
      const js = gzipSync(codigo, { level: 9 }).length;
      const css = gzipSync(readFileSync(join(__dirname, "..", "bichinho.css")), { level: 9 }).length;
      expect(js, `JS ${js} B gz`).toBeLessThanOrEqual(LIMITE_SISTEMA_PARTES_GZ);
      expect(css, `CSS ${css} B gz`).toBeLessThanOrEqual(LIMITE_CSS_GZ);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }, 60_000);
});
