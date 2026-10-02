// T-22.01: consistência do estudo de ameaças da Fase 22 (docs/ade/AMEACAS-RELAY.md).
// Toda ameaça Alta aponta para uma task T-22.NN que EXISTE no plano e para um teste nomeado; linha `pronto` tem o teste no código.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const DOC = readFileSync(join(RAIZ, "docs/ade/AMEACAS-RELAY.md"), "utf8");
const PLANO = readFileSync(join(RAIZ, "docs/ade/fase-22-acesso-remoto-estendido.md"), "utf8");
const testes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "ameacas-relay.test.ts") return [];
    const c = join(dir, n);
    return statSync(c).isDirectory() ? testes(c) : /\.test\.tsx?$/.test(n) ? [c] : [];
  });

interface Linha {
  ax: string;
  sev: string;
  task: string;
  teste: string;
  estado: string;
}
const linhas: Linha[] = DOC.split("\n")
  .filter((l) => /^\| AX-\d\d \|/.test(l))
  .map((l) => {
    const c = l.split("|").map((x) => x.trim());
    return { ax: c[1] as string, sev: c[3] as string, task: c[5] as string, teste: (c[6] as string).replace(/`/g, ""), estado: c[7] as string };
  });

describe("T-22.01: AMEACAS-RELAY.md", () => {
  it("tem os 34 casos AX-01..AX-34, sem repetir", () => {
    expect(linhas.map((l) => l.ax)).toEqual(Array.from({ length: 34 }, (_, i) => `AX-${String(i + 1).padStart(2, "0")}`));
  });
  it("toda ameaça tem task existente no plano e teste nomeado ax<NN>_*", () => {
    for (const l of linhas) {
      expect(PLANO, l.ax).toMatch(new RegExp(`\\*\\*${l.task.replace(".", "\\.")} ·`));
      expect(l.teste, l.ax).toMatch(new RegExp(`^ax${l.ax.slice(3)}_[a-z0-9_]+$`));
      expect(["Alta", "Média"]).toContain(l.sev);
    }
  });
  it("linha `pronto` tem o teste no código; as demais declaram a onda", () => {
    const fontes = [...testes(join(RAIZ, "src")), ...testes(join(RAIZ, "tests"))].map((f) => readFileSync(f, "utf8"));
    for (const l of linhas) {
      if (l.estado === "pronto") expect(fontes.some((t) => t.includes(l.teste)), `${l.ax} ${l.teste}`).toBe(true);
      else expect(l.estado, l.ax).toMatch(/^W[3-6]$/);
    }
  });
  it("declara os residuais R-A..R-F e os portões G1..G5", () => {
    for (const r of ["R-A", "R-B", "R-C", "R-D", "R-E", "R-F"]) expect(DOC).toContain(`**${r}**`);
    for (const g of ["G1", "G2", "G3", "G4", "G5"]) expect(DOC).toContain(`**${g} `);
  });
});
