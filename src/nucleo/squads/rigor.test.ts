import { describe, expect, it } from "vitest";
import { NIVEIS_RIGIDEZ } from "../../compartilhado/squads";
import { NIVEL_RIGIDEZ_PADRAO, nivelRigidezPadrao, PISO_DE_QUALIDADE, politicaDePortoes, rigidezEfetiva, snippetDeRigor } from "./rigor";

describe("snippetDeRigor", () => {
  it("os 5 níveis são distintos, em PT-BR, e TODOS contêm o piso de qualidade (rigor 1 inclusive)", () => {
    const textos = NIVEIS_RIGIDEZ.map((n) => snippetDeRigor(n));
    expect(new Set(textos).size).toBe(5);
    for (const t of textos) {
      expect(t).toContain(PISO_DE_QUALIDADE);
      expect(t).toMatch(/teste/);
      expect(t).toMatch(/segredo/);
      expect(t).toMatch(/git destrutiva/);
    }
    expect(snippetDeRigor(1)).toContain("Rigor mínimo");
    expect(snippetDeRigor(3)).toContain("dois testes por card");
    expect(snippetDeRigor(4)).toContain("teste antes do código");
    expect(snippetDeRigor(5)).toContain("evidência anexada a cada critério");
  });
  it("não remove regras inalteráveis: o piso lembra que as regras do papel e do handoff valem", () => {
    expect(snippetDeRigor(1)).toContain("regras do seu papel e do handoff continuam valendo");
  });
  it("nível ausente/inválido cai no padrão 3 (nunca abaixo do piso)", () => {
    for (const n of [null, undefined, 0, 6, 2.5, NaN]) expect(snippetDeRigor(n)).toBe(snippetDeRigor(3));
    expect(NIVEL_RIGIDEZ_PADRAO).toBe(3);
  });
  it("rigidezEfetiva: membro > squad > padrão; porta padrão devolve 3", async () => {
    expect(rigidezEfetiva(null, 4)).toBe(4);
    expect(rigidezEfetiva(2, 4)).toBe(2);
    expect(rigidezEfetiva(null, null)).toBe(3);
    expect(await nivelRigidezPadrao.efetivo({ workspace_id: "w", mission_id: null, squad_slug: null, membro_slug: null })).toBe(3);
  });
});

describe("politicaDePortoes: nível × planoAntes", () => {
  const tabela: Array<[number, boolean, string[]]> = [
    [1, true, []],
    [2, true, []],
    [3, true, ["build"]],
    [4, true, ["direction", "build"]],
    [5, true, ["direction", "content", "build", "qa"]],
    [1, false, []],
    [3, false, []],
    [5, false, []],
  ];
  it.each(tabela)("nível %i, plano antes=%s => pendentes %j", (nivel, plano, pendentes) => {
    const p = politicaDePortoes(nivel, plano);
    expect(p.pendentes).toEqual(pendentes);
    expect([...p.liberar, ...p.pendentes].sort()).toEqual(["build", "content", "direction", "qa"]);
    expect(p.revisor_obrigatorio).toBe(true); // o revisor segue obrigatório em qualquer nível
  });
  it("nível ausente => padrão 3", () => {
    expect(politicaDePortoes(null, true).pendentes).toEqual(["build"]);
  });
});
