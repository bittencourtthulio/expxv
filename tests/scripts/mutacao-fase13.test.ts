// A lista de mutações (Fase 13) não apodrece: cada trecho aparece EXATAMENTE 1 vez no fonte e cada teste apontado existe. A execução em si (lenta, edita o fonte) é
// `node tests/scripts/mutacao-fase13.mjs` (ver o cabeçalho do script). Cobre também as mitigações citadas no estudo de ameaças.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sem tipos (script de CLI)
import { MUTACOES } from "./mutacoes-fase13.mjs";

const RAIZ = resolve(__dirname, "..", "..");
interface Edicao {
  arquivo: string;
  de: string;
  para: string;
}
interface Mutacao {
  id: string;
  descricao: string;
  arquivo?: string;
  de?: string;
  para?: string;
  edicoes?: Edicao[];
  testes: string[];
  nome?: string;
}
const lista = MUTACOES as Mutacao[];

describe("lista de mutações da Fase 13", () => {
  it("ids únicos e cobertura mínima das mitigações de maior risco", () => {
    expect(new Set(lista.map((m) => m.id)).size).toBe(lista.length);
    for (const id of ["AR-05a", "AR-06b", "AR-01a", "AR-04a", "AR-14", "AR-07a", "AR-09a", "AR-10a", "AR-11", "AR-13", "AR-17a", "AR-15", "AR-24", "AR-18"]) expect(lista.some((m) => m.id === id), id).toBe(true);
  });
  it.each(lista.map((m) => [m.id, m] as const))("%s: o trecho existe exatamente 1 vez e os testes existem", (_id, m) => {
    const edicoes: Edicao[] = m.edicoes ?? [{ arquivo: m.arquivo as string, de: m.de as string, para: m.para as string }];
    for (const e of edicoes) {
      const fonte = readFileSync(resolve(RAIZ, e.arquivo), "utf8");
      expect(fonte.split(e.de).length - 1, `${e.arquivo}`).toBe(1);
      expect(e.para).not.toBe(e.de);
    }
    for (const t of m.testes) {
      expect(existsSync(resolve(RAIZ, t)), t).toBe(true);
      // ao menos um dos padrões do `-t` aparece em algum dos testes apontados
      if (m.nome !== undefined) expect(m.nome.split("|").some((p) => m.testes.some((tt) => readFileSync(resolve(RAIZ, tt), "utf8").includes(p))), `${m.id}: padrão -t "${m.nome}" não aparece nos testes`).toBe(true);
    }
  });
});
