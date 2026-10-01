import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// D-31: o destaque do produto é AZUL (pedido do dono) — nunca rosa nem roxo.

const css = readFileSync(join(__dirname, "tokens.css"), "utf8");

function valoresDe(token: string): string[] {
  return [...css.matchAll(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "g"))].map((m) => m[1] as string);
}

function ehAzul(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return b > r + 40 && b >= g; // azul dominante: sem rosa (r alto) nem roxo (r e b altos)
}

function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
}

describe("cor de destaque azul (D-31)", () => {
  it("destaque, texto de destaque e segunda cor são azuis nos dois temas", () => {
    for (const token of ["destaque", "destaque-texto", "destaque-2"]) {
      const valores = valoresDe(token);
      expect(valores.length, `--${token} definido nos dois temas`).toBe(2);
      for (const v of valores) expect(ehAzul(v), `--${token}: ${v}`).toBe(true);
    }
  });

  it("não existe token rosa e o texto branco sobre o destaque tem contraste AA (≥ 4,5)", () => {
    expect(css).not.toMatch(/--rosa\b/);
    for (const v of valoresDe("destaque")) {
      const l = luminancia(v);
      expect(1.05 / (l + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("nenhum arquivo do renderer usa cor rosa/roxo conhecida do ExpxMedia", () => {
    const proibidas = ["#8250df", "#e65ca8", "#b89cff", "#c084fc", "#b79cf0", "#c2377f"];
    const achados: string[] = [];
    const varrer = (dir: string): void => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) {
          if (nome !== "assets") varrer(caminho);
        } else if (/\.(css|ts|tsx)$/.test(nome) && nome !== "cor-destaque.test.ts") {
          const texto = readFileSync(caminho, "utf8").toLowerCase();
          for (const cor of proibidas) if (texto.includes(cor)) achados.push(`${caminho} usa ${cor}`);
        }
      }
    };
    varrer(__dirname);
    expect(achados).toEqual([]);
  });
});
