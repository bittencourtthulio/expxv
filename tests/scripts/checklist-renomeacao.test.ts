import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ITENS_MANUAIS, LISTA_FECHADA } from "../../scripts/lib/renomear.mjs";

// T-21.06: o checklist e a lista fechada do script não podem divergir (todo arquivo da lista aparece no checklist e vice-versa).

const CHECKLIST = readFileSync(join(__dirname, "..", "..", "docs", "ade", "CHECKLIST-RENOMEACAO.md"), "utf8");

function secao(titulo: string): string {
  const partes = CHECKLIST.split(/^## /m).slice(1);
  const achada = partes.find((p) => p.startsWith(titulo));
  if (achada === undefined) throw new Error(`seção ausente: ${titulo}`);
  return achada;
}
const codigos = (texto: string): string[] => [...texto.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

describe("CHECKLIST-RENOMEACAO.md ⇄ lista fechada de scripts/lib/renomear.mjs", () => {
  it("a seção de arquivos alterados lista exatamente a lista fechada", () => {
    const linhas = secao("Arquivos alterados pelo script")
      .split("\n")
      .filter((l) => l.startsWith("|"))
      .map((l) => /^\|\s*`([^`]+)`/.exec(l)?.[1])
      .filter((x): x is string => x !== undefined);
    expect([...linhas].sort()).toEqual([...LISTA_FECHADA].sort());
  });

  it("a seção manual cita cada item manual do script, e só eles", () => {
    const ids = codigos(secao("O que é manual")).filter((c) => c.startsWith("manual:")).map((c) => c.slice("manual:".length));
    expect([...ids].sort()).toEqual(ITENS_MANUAIS.map((m: { id: string }) => m.id).sort());
  });

  it("tem as duas fases (antes e depois do 1º release) e o uso do script", () => {
    expect(secao("Antes do 1º release")).toContain("npm run renomear");
    const depois = secao("Depois do 1º release");
    for (const palavra of ["appId", "assinatura", "feed", "protocolo", "Keychain", "instaladores antigos"]) expect(depois.toLowerCase()).toContain(palavra.toLowerCase());
    expect(CHECKLIST).toContain("--migrar-dados");
    expect(CHECKLIST).toContain("--reverter");
  });

  it("o checklist cita as flags reais do CLI", () => {
    const cli = readFileSync(join(__dirname, "..", "..", "scripts", "renomear.mjs"), "utf8");
    for (const flag of ["--nome", "--id", "--dono", "--repo", "--dry-run", "--aplicar", "--reverter", "--migrar-dados", "--host-feed"]) {
      expect(cli, flag).toContain(`"${flag}"`);
      expect(CHECKLIST, flag).toContain(flag);
    }
  });
});
