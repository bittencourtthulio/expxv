import { describe, expect, it } from "vitest";
import { ESTADOS_MISSAO, TRANSICOES_MISSAO, missaoTerminal, transicaoMissaoValida } from "./index";

describe("dominio: máquina de estados da Missão", () => {
  it("terminais não saem; ativos podem falhar ou abortar", () => {
    for (const t of ["concluida", "falhou", "abortada"] as const) {
      expect(missaoTerminal(t)).toBe(true);
      for (const p of ESTADOS_MISSAO) expect(transicaoMissaoValida(t, p)).toBe(false);
    }
    for (const a of ["intake", "planejando", "executando", "revisando"] as const) {
      expect(transicaoMissaoValida(a, "falhou")).toBe(true);
      expect(transicaoMissaoValida(a, "abortada")).toBe(true);
    }
  });
  it("não pula etapas nem volta", () => {
    expect(transicaoMissaoValida("intake", "executando")).toBe(false);
    expect(transicaoMissaoValida("executando", "planejando")).toBe(false);
    expect(transicaoMissaoValida("planejando", "concluida")).toBe(false);
    expect(Object.keys(TRANSICOES_MISSAO)).toEqual([...ESTADOS_MISSAO]);
  });
});
