import { describe, expect, it } from "vitest";
import { NIVEIS_RIGIDEZ } from "../../../compartilhado/maestro";
import { PRODUTO } from "../../produto";
import { argumentoComInstrucoes, caminhoDeInstrucoes, caminhoRelatorioRapido, gravarInstrucoes, instrucoesDaEtapa, instrucoesRapido, precisaDeInstrucoes, promptRapido } from "./instrucoes";

describe("instruções de rigidez", () => {
  it("caminho dentro da pasta do produto, por pipeline e etapa; id perigoso é recusado", () => {
    expect(caminhoDeInstrucoes("mpl_01", "sprintx.f2")).toBe(`${PRODUTO.pastaNoProjeto}/maestro/mpl_01/instrucoes-f2.md`);
    expect(() => caminhoDeInstrucoes("../x", "runx.e1")).toThrow();
    expect(() => caminhoDeInstrucoes("a/b", "runx.e1")).toThrow();
  });
  it("sprintx.f2 no nível 2: densidade mvp, forma autonomo, plano condensado e o piso", () => {
    const t = instrucoesDaEtapa("sprintx.f2", 2, "sprintx");
    expect(t).toMatch(/Densidade `mvp`, forma `autonomo`/);
    expect(t).toMatch(/D-00 confirmado/);
    expect(t).toMatch(/Piso de qualidade/);
    expect(t).toMatch(/Leve/);
  });
  it("nível 4: entrevista completa; avaliador sabe que não aprova o próprio trabalho", () => {
    expect(instrucoesDaEtapa("sprintx.f2", 4, "sprintx")).toMatch(/Densidade `completo`, forma `entrevista`/);
    expect(instrucoesDaEtapa("runx.e4", 4, "runx")).toMatch(/quem implementa não aprova/);
  });
  it("o piso está em TODA instrução de etapa que implementa, em todos os níveis", () => {
    for (const n of NIVEIS_RIGIDEZ) for (const e of ["runx.e3", "sprintx.f6", "rapido.executar"] as const) expect(instrucoesDaEtapa(e, n, e === "rapido.executar" ? "rapido" : "runx")).toMatch(/Piso de qualidade/);
  });
  it("nunca contém segredo nem caminho absoluto", () => {
    for (const n of NIVEIS_RIGIDEZ) for (const e of ["runx.e1", "runx.e3", "runx.e4", "sprintx.f2", "buildx.condutor"] as const) {
      const t = instrucoesDaEtapa(e, n, "runx");
      expect(t).not.toMatch(/\/Users\/|[A-Z]:\\|sk-|ghp_/);
    }
  });
  it("precisaDeInstrucoes: nível 3 em etapa comum não precisa; implementador e níveis ≠ 3 precisam; humana e consulta nunca", () => {
    expect(precisaDeInstrucoes("runx", "runx.e1", 3)).toBe(false);
    expect(precisaDeInstrucoes("runx", "runx.e3", 3)).toBe(true);
    expect(precisaDeInstrucoes("runx", "runx.e1", 2)).toBe(true);
    expect(precisaDeInstrucoes("runx", "runx.e4", 4)).toBe(true);
    expect(precisaDeInstrucoes("prodx", "prodx.assinatura", 2)).toBe(false);
    expect(precisaDeInstrucoes("runx", "memox.consultar", 2)).toBe(false);
  });
  it("argumento final: base + ponteiro, uma linha, ≤ 1 500 (ponteiro, não texto)", () => {
    const a = argumentoComInstrucoes("feature-x", "x/instrucoes-f2.md", 2) as string;
    expect(a).toBe("feature-x — rigidez Leve (N2): siga x/instrucoes-f2.md");
    const longo = argumentoComInstrucoes(`linha\n${"x".repeat(9000)}`, "x/instrucoes-f2.md", 4) as string;
    expect(longo.length).toBeLessThanOrEqual(1500);
    expect(longo).not.toMatch(/\n/);
    expect(longo.endsWith("siga x/instrucoes-f2.md")).toBe(true);
    expect(argumentoComInstrucoes(null, "x.md", 3)).toContain("siga x.md");
  });
  it("gravarInstrucoes escreve só pela porta, no caminho relativo", async () => {
    const gravados: Array<[string, string]> = [];
    const rel = await gravarInstrucoes({ gravar: async (r, t) => void gravados.push([r, t]) }, "mpl_9", "runx.e3", 2, "runx");
    expect(rel).toBe(`${PRODUTO.pastaNoProjeto}/maestro/mpl_9/instrucoes-e3.md`);
    expect(gravados).toHaveLength(1);
    expect(gravados[0]?.[0]).toBe(rel);
  });
  it("pipeline rápido: prompt uma linha com instruções e relatório; piso de 5 itens", () => {
    const p = promptRapido("mpl_1", "muda a cor do botão\nsalvar") as string;
    expect(p).toContain(`${PRODUTO.pastaNoProjeto}/maestro/mpl_1/instrucoes-rapido.md`);
    expect(p).toContain("Pedido: muda a cor do botão salvar");
    expect(p).not.toMatch(/\n/);
    expect(p.startsWith("/")).toBe(false);
    const i = instrucoesRapido("mpl_1");
    expect(i).toMatch(/teste do comportamento alterado/);
    expect(i).toMatch(/suíte inteira/);
    expect(i).toContain(caminhoRelatorioRapido("mpl_1"));
    expect(i).toMatch(/Não chame skills do método/);
    expect(caminhoRelatorioRapido("mpl_1")).toBe(`${PRODUTO.pastaNoProjeto}/maestro/mpl_1/rapido-relatorio.md`);
  });
});
