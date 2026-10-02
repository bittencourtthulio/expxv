import { describe, expect, it } from "vitest";
import { avisoAgente, chaveModelo, ordenarModelos, regraNova, resumoRegra, situacaoTamanho, validarRegra } from "./logica";
import { CATALOGO_FALSO } from "./fabrica-teste";

describe("lógica da tela Alertas", () => {
  it("tamanho: alvo 1 500 e teto 3 500", () => {
    expect(situacaoTamanho(1500)).toBe("ok");
    expect(situacaoTamanho(1501)).toBe("acima_do_alvo");
    expect(situacaoTamanho(3501)).toBe("acima_do_teto");
  });
  it("validar regra: nome, tipos, canal, horas, digest, lote", () => {
    expect(validarRegra(regraNova(""))).toEqual(expect.arrayContaining(["Dê um nome à regra.", "Escolha ao menos um tipo de alerta.", "Escolha o canal."]));
    const ok = { ...regraNova("c"), nome: "x", tipos: ["tarefa_atrasada" as const] };
    expect(validarRegra(ok)).toEqual([]);
    expect(validarRegra({ ...ok, silencio: { inicio: "25:00", fim: "07:00" } })).toContain("Hora de início inválida (use HH:MM).");
    expect(validarRegra({ ...ok, silencio: { inicio: "22:00" } })).toContain("O silêncio precisa de início e fim.");
    expect(validarRegra({ ...ok, agrupamento: { modo: "digest" } })[0]).toMatch(/hora/);
    expect(validarRegra({ ...ok, agrupamento: { modo: "lote", janela_s: 1 } })[0]).toMatch(/janela/);
  });
  it("aviso do curinga para agente_mensagem só em canal externo", () => {
    expect(avisoAgente(["*"], true)).toMatch(/nunca vão a canal externo/);
    expect(avisoAgente(["*"], false)).toBeNull();
    expect(avisoAgente(["*", "agente_mensagem"], true)).toBeNull();
  });
  it("resumo de regra e ordenação de modelos pelo catálogo", () => {
    const rot = new Map(CATALOGO_FALSO.map((c) => [c.tipo as string, c.rotulo]));
    expect(resumoRegra({ ...regraNova("c"), id: "r", tipos: ["*"] }, rot)).toBe("todos os tipos");
    expect(resumoRegra({ ...regraNova("c"), id: "r", tipos: ["tarefa_concluida", "tarefa_atrasada", "pr_aberto", "agente_mensagem"] }, rot)).toBe("Tarefa concluída, Tarefa atrasada, PR aberto e mais 1");
    const m = (tipo: "tarefa_atrasada" | "tarefa_concluida", nivel: "minimo" | "padrao") => ({ tipo, canal_tipo: "telegram" as const, nivel, corpo: "", editado: false, atualizado_em: null });
    const o = ordenarModelos([m("tarefa_atrasada", "minimo"), m("tarefa_concluida", "padrao"), m("tarefa_concluida", "minimo")], CATALOGO_FALSO);
    expect(o.map(chaveModelo)).toEqual(["tarefa_concluida|telegram|minimo", "tarefa_concluida|telegram|padrao", "tarefa_atrasada|telegram|minimo"]);
  });
});
