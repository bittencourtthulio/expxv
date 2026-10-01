import { describe, expect, it } from "vitest";
import { CODIGOS_ACHADO, LIMITES_SQUAD, PAPEIS_SQUAD, PAPEL_INTERNO, VARIAVEIS_NAO_CONFIAVEIS, VARIAVEIS_PROMPT, agentIdDe, caminhoPromptDe, estadoDaExecucao, PADRAO_SLUG } from "./squads";
import { PAPEIS } from "../nucleo/dominio";

describe("contratos de squads", () => {
  it("papel externo mapeia 1:1 para um papel interno existente", () => {
    expect(Object.keys(PAPEL_INTERNO).sort()).toEqual([...PAPEIS_SQUAD].sort());
    for (const p of PAPEIS_SQUAD) expect(PAPEIS).toContain(PAPEL_INTERNO[p]);
    expect(new Set(Object.values(PAPEL_INTERNO)).size).toBe(4);
  });

  it("variáveis: 10 fechadas, as 3 não confiáveis estão entre elas; códigos de achado únicos; padrão de slug", () => {
    expect(VARIAVEIS_PROMPT).toHaveLength(10);
    for (const v of VARIAVEIS_NAO_CONFIAVEIS) expect(VARIAVEIS_PROMPT).toContain(v);
    expect(new Set(CODIGOS_ACHADO).size).toBe(CODIGOS_ACHADO.length);
    expect(CODIGOS_ACHADO).toHaveLength(24);
    expect(PADRAO_SLUG.test("feature-fullstack")).toBe(true);
    expect(PADRAO_SLUG.test("../x")).toBe(false);
    expect(LIMITES_SQUAD.paralelas_padrao).toBe(6); // P-233
  });

  it("agent_id e caminho do prompt são derivados do slug (nunca de texto livre)", () => {
    expect(agentIdDe("s", "m")).toBe("s.m");
    expect(caminhoPromptDe("orquestrador")).toBe("membros/orquestrador.md");
  });

  it("estadoDaExecucao: plano pendente vira 'plano'; o resto espelha a Missão", () => {
    expect(estadoDaExecucao(null, true)).toBe("intake");
    expect(estadoDaExecucao("intake", true)).toBe("plano");
    expect(estadoDaExecucao("intake", false)).toBe("intake");
    expect(estadoDaExecucao("planejando", false)).toBe("plano");
    expect(estadoDaExecucao("executando", true)).toBe("executando");
    expect(estadoDaExecucao("concluida", false)).toBe("concluida");
    expect(estadoDaExecucao("abortada", false)).toBe("abortada");
  });
});
