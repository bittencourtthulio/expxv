import { describe, expect, it } from "vitest";
import type { Intencao } from "../../../compartilhado/maestro";
import { combinarRegraEDecisor, deveConsultarDecisor, type CasoCombinacao } from "./combinar";

const r = (intencao: Intencao, confianca: number) => ({ intencao, confianca });
type Linha = [nome: string, regra: ReturnType<typeof r>, decisor: ReturnType<typeof r> | null, tentado: boolean, caso: CasoCombinacao, intencao: Intencao, fonte: string, divergiu: boolean, confianca: number];
const TABELA: Linha[] = [
  ["1: conf_r ≥ 0,85 dispensa o decisor", r("bug", 0.9), r("feature", 0.99), false, 1, "bug", "regra", false, 0.9],
  ["1: borda 0,85", r("bug", 0.85), null, false, 1, "bug", "regra", false, 0.85],
  ["2: decisor desligado/erro (não tentado)", r("bug", 0.6), null, false, 2, "bug", "regra", false, 0.6],
  ["2: decisor falhou (tentado) ⇒ fallback", r("bug", 0.6), null, true, 2, "bug", "fallback", false, 0.6],
  ["3: conf_d < 0,60 ignorado, discordando ⇒ divergiu", r("bug", 0.5), r("feature", 0.59), true, 3, "bug", "regra", true, 0.5],
  ["3: conf_d < 0,60 ignorado, concordando ⇒ não divergiu", r("bug", 0.5), r("bug", 0.3), true, 3, "bug", "regra", false, 0.5],
  ["4: mesma intenção ⇒ max das confianças", r("bug", 0.6), r("bug", 0.9), true, 4, "bug", "regra+decisor", false, 0.9],
  ["4: mesma intenção, regra mais confiante", r("bug", 0.8), r("bug", 0.7), true, 4, "bug", "regra+decisor", false, 0.8],
  ["5: regra baixa e decisor ≥ 0,60 ⇒ decisor", r("feature", 0.3), r("bug", 0.6), true, 5, "bug", "decisor", true, 0.6],
  ["5: regra baixa (0,44) e decisor forte", r("feature", 0.44), r("pedido", 0.95), true, 5, "pedido", "decisor", true, 0.95],
  ["6: regra média e decisor ≥ 0,80 ⇒ decisor", r("feature", 0.5), r("bug", 0.8), true, 6, "bug", "decisor", true, 0.8],
  ["6: regra 0,69 e decisor 0,95", r("feature", 0.69), r("bug", 0.95), true, 6, "bug", "decisor", true, 0.95],
  ["7: regra média, decisor 0,60–0,79 ⇒ regra vence", r("feature", 0.5), r("bug", 0.7), true, 7, "feature", "regra", true, 0.5],
  ["7: borda 0,79", r("feature", 0.6), r("bug", 0.79), true, 7, "feature", "regra", true, 0.6],
  ["8: regra alta (0,70) e decisor discordando ⇒ regra vence", r("feature", 0.7), r("bug", 0.99), true, 8, "feature", "regra", true, 0.7],
  ["8: regra 0,84", r("projeto", 0.84), r("bug", 0.9), true, 8, "projeto", "regra", true, 0.84],
];
describe("combinarRegraEDecisor: as 8 linhas da tabela (a regra é a autoridade)", () => {
  it.each(TABELA)("%s", (_n, regra, decisor, tentado, caso, intencao, fonte, divergiu, confianca) => {
    const c = combinarRegraEDecisor(regra, decisor, tentado);
    expect(c).toMatchObject({ caso, intencao, fonte, divergiu, confianca });
  });
  it("casos 7 e 8 trazem o decisor como alternativa; caso 5/6 trazem a regra", () => {
    expect(combinarRegraEDecisor(r("feature", 0.5), r("bug", 0.7), true).alternativa).toBe("bug");
    expect(combinarRegraEDecisor(r("feature", 0.8), r("bug", 0.9), true).alternativa).toBe("bug");
    expect(combinarRegraEDecisor(r("feature", 0.3), r("bug", 0.7), true).alternativa).toBe("feature");
  });
  it("só consulta o decisor quando conf_r < 0,85", () => {
    expect(deveConsultarDecisor(0.84)).toBe(true);
    expect(deveConsultarDecisor(0.85)).toBe(false);
    expect(deveConsultarDecisor(1)).toBe(false);
  });
  it("o resultado sempre pertence às duas intenções de entrada", () => {
    for (const cr of [0.1, 0.44, 0.45, 0.69, 0.7, 0.84, 0.85, 1]) for (const cd of [0, 0.59, 0.6, 0.79, 0.8, 1]) for (const mesma of [true, false]) {
      const c = combinarRegraEDecisor(r("bug", cr), r(mesma ? "bug" : "feature", cd), true);
      expect(["bug", "feature"]).toContain(c.intencao);
      expect(c.caso).toBeGreaterThanOrEqual(1);
      expect(c.caso).toBeLessThanOrEqual(8);
    }
  });
});
