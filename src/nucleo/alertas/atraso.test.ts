import { describe, expect, it } from "vitest";
import { CONFIG_ALERTAS_PADRAO } from "../../compartilhado/alertas";
import { decidirAtraso, estimar, limiteDe, mediana, proximoVencimento, sprintEmRisco, type AmostraConcluida, type TaskAtraso } from "./atraso";

const CFG = CONFIG_ALERTAS_PADRAO.atraso;
const MIN = 60_000;
const AGORA = Date.parse("2026-10-01T12:00:00Z");
const amostras = (n: number, sp: number | null, minutos: number, ws = "w1"): AmostraConcluida[] => Array.from({ length: n }, () => ({ workspace_id: ws, story_points: sp, tempo_trabalho_ms: minutos * MIN }));
const task = (p: Partial<TaskAtraso> = {}): TaskAtraso => ({ task_id: "T-1", workspace_id: "w1", story_points: 3, ativo_ms: 0, estado: "em_andamento", alertou_atraso: 0, ...p });

describe("estimar", () => {
  it.each([
    [0, 1, 15], [0, 2, 30], [0, 3, 60], [0, 5, 120], [0, 8, 240], [0, 13, 480], [0, 21, 960],
    [4, 3, 60], // 4 amostras: não basta, usa a tabela
  ])("SP %#: %i amostras, SP %i => tabela %i min", (n, sp, esperado) => {
    const e = estimar(task({ story_points: sp }), amostras(n, sp, 999), CFG);
    expect(e.origem).toBe("tabela");
    expect(e.estimativa_ms).toBe(esperado * MIN);
  });
  it("5+ amostras do mesmo SP: mediana do workspace", () => {
    const e = estimar(task({ story_points: 3 }), [...amostras(5, 3, 55), ...amostras(10, 5, 500), ...amostras(10, 3, 1, "outro")], CFG);
    expect(e).toEqual({ estimativa_ms: 55 * MIN, origem: "mediana_sp" });
  });
  it("50 amostras: mediana correta (par e ímpar)", () => {
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(mediana([5, 1, 3])).toBe(3);
    const a = Array.from({ length: 50 }, (_, i) => ({ workspace_id: "w1", story_points: 3, tempo_trabalho_ms: (i + 1) * MIN }));
    expect(estimar(task(), a, CFG).estimativa_ms).toBe(25.5 * MIN);
  });
  it("SP fora da tabela usa o menor degrau >= SP; acima do maior usa o maior", () => {
    expect(estimar(task({ story_points: 4 }), [], CFG).estimativa_ms).toBe(120 * MIN);
    expect(estimar(task({ story_points: 34 }), [], CFG).estimativa_ms).toBe(960 * MIN);
  });
  it("sem SP: mediana geral (>=5) ou sem_base", () => {
    expect(estimar(task({ story_points: null }), amostras(5, 8, 40), CFG)).toEqual({ estimativa_ms: 40 * MIN, origem: "mediana_geral" });
    expect(estimar(task({ story_points: null }), amostras(4, 8, 40), CFG)).toEqual({ estimativa_ms: null, origem: "sem_base" });
    expect(estimar(task({ story_points: null }), [], CFG).origem).toBe("sem_base");
  });
});

describe("limite", () => {
  it("max(est x 1,5; est + 10 min)", () => {
    expect(limiteDe(15 * MIN, CFG)).toBe(25 * MIN); // 22,5 < 25
    expect(limiteDe(60 * MIN, CFG)).toBe(90 * MIN);
  });
  it("propriedade: o limite é monotônico crescente em SP (tabela)", () => {
    let anterior = 0;
    for (const sp of [1, 2, 3, 5, 8, 13, 21]) {
      const l = limiteDe(estimar(task({ story_points: sp }), [], CFG).estimativa_ms as number, CFG);
      expect(l).toBeGreaterThan(anterior);
      anterior = l;
    }
  });
});

describe("decidirAtraso (tabela de casos do plano)", () => {
  const hist55 = amostras(5, 3, 55); // limite = 82,5 min
  it("caso 2 do plano: 90 min de trabalho ativo => atrasada uma vez; 3 h => muito atrasada (critico); no máximo 2", () => {
    const d1 = decidirAtraso(task({ ativo_ms: 90 * MIN }), hist55, CFG, AGORA);
    expect(d1.veredito).toBe("atrasada");
    expect(d1.limite_ms).toBe(82.5 * MIN);
    expect(d1.emitir).toEqual({ tipo: "atrasada", motivo: "esforco", novo_nivel: 1 });
    expect(decidirAtraso(task({ ativo_ms: 95 * MIN, alertou_atraso: 1 }), hist55, CFG, AGORA).emitir).toBeNull();
    const d2 = decidirAtraso(task({ ativo_ms: 180 * MIN, alertou_atraso: 1 }), hist55, CFG, AGORA);
    expect(d2.veredito).toBe("muito_atrasada");
    expect(d2.emitir).toEqual({ tipo: "muito_atrasada", motivo: "esforco", novo_nivel: 2 });
    expect(decidirAtraso(task({ ativo_ms: 400 * MIN, alertou_atraso: 2 }), hist55, CFG, AGORA).emitir).toBeNull();
  });
  it.each([
    ["antes da estimativa", 30, "no_prazo"],
    ["na estimativa", 55, "em_risco"],
    ["entre estimativa e limite", 70, "em_risco"],
    ["exatamente no limite (não é maior)", 82.5, "em_risco"],
    ["logo depois do limite", 83, "atrasada"],
    ["em 2 x limite", 165, "muito_atrasada"],
  ])("%s (%d min)", (_nome, min, esperado) => {
    expect(decidirAtraso(task({ ativo_ms: min * MIN }), hist55, CFG, AGORA).veredito).toBe(esperado);
  });
  it("aguardando, bloqueada e concluída nunca são atraso", () => {
    for (const estado of ["aguardando", "bloqueada", "concluida", "outro"] as const) {
      const d = decidirAtraso(task({ estado, ativo_ms: 999 * MIN }), hist55, CFG, AGORA);
      expect(d.veredito).toBe("nao_aplica");
      expect(d.emitir).toBeNull();
    }
  });
  it("sem base: nunca atrasada (por esforço), mesmo com 100 h", () => {
    const d = decidirAtraso(task({ story_points: null, ativo_ms: 100 * 60 * MIN }), [], CFG, AGORA);
    expect(d.veredito).toBe("sem_base");
    expect(d.emitir).toBeNull();
    expect(d.estimativa_ms).toBeNull();
  });
  it("prazo da sprint vencido => atrasada por prazo, uma vez; sem base também vale", () => {
    const fim = new Date(AGORA - 3_600_000).toISOString();
    const d = decidirAtraso(task({ story_points: null, prazo_sprint: fim }), [], CFG, AGORA);
    expect(d.veredito).toBe("atrasada");
    expect(d.emitir).toEqual({ tipo: "atrasada", motivo: "prazo", novo_nivel: null });
    expect(decidirAtraso(task({ story_points: null, prazo_sprint: fim, alertou_prazo: true }), [], CFG, AGORA).emitir).toBeNull();
    expect(decidirAtraso(task({ prazo_sprint: new Date(AGORA + 3_600_000).toISOString() }), [], CFG, AGORA).emitir).toBeNull();
  });
  it("2 x limite de uma vez (após suspensão): UM alerta crítico, não dois", () => {
    const d = decidirAtraso(task({ ativo_ms: 300 * MIN, alertou_atraso: 0 }), hist55, CFG, AGORA);
    expect(d.emitir?.tipo).toBe("muito_atrasada");
    expect(d.emitir?.novo_nivel).toBe(2);
  });
  it("configurável: fator 2 e folga 0", () => {
    const cfg = { ...CFG, fator: 2, folga_min: 0 };
    expect(limiteDe(60 * MIN, cfg)).toBe(120 * MIN);
    expect(decidirAtraso(task({ ativo_ms: 109 * MIN }), hist55, cfg, AGORA).veredito).not.toBe("atrasada");
  });
  it("é rápido: <= 1 ms por task (200 tasks, mediana de lotes)", () => {
    const hist = amostras(200, 3, 50);
    const ts = task({ ativo_ms: 70 * MIN });
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) decidirAtraso(ts, hist, CFG, AGORA);
    expect((performance.now() - t0) / 200).toBeLessThan(1);
  });
});

describe("proximoVencimento e sprintEmRisco", () => {
  it("agenda para o instante em que o ativo cruza o limite (restante = limite - ativo)", () => {
    const v = proximoVencimento(task({ ativo_ms: 40 * MIN }), hist(), CFG, AGORA) as number;
    expect(v).toBe(AGORA + (82.5 - 40) * MIN + 1);
  });
  it("depois do 1º alerta mira 2 x limite; depois do 2º não agenda; sem base ou sem andamento = null", () => {
    expect(proximoVencimento(task({ ativo_ms: 90 * MIN, alertou_atraso: 1 }), hist(), CFG, AGORA)).toBe(AGORA + (165 - 90) * MIN + 1);
    expect(proximoVencimento(task({ alertou_atraso: 2 }), hist(), CFG, AGORA)).toBeNull();
    expect(proximoVencimento(task({ story_points: null }), [], CFG, AGORA)).toBeNull();
    expect(proximoVencimento(task({ estado: "aguardando" }), hist(), CFG, AGORA)).toBeNull();
  });
  it("prazo da sprint entra como candidato", () => {
    const fim = new Date(AGORA + 10 * MIN).toISOString();
    expect(proximoVencimento(task({ story_points: null, prazo_sprint: fim }), [], CFG, AGORA)).toBe(Date.parse(fim) + 1);
  });
  it("sprint em risco: restante > capacidade; dado ausente nunca afirma", () => {
    expect(sprintEmRisco(10, 5)?.em_risco).toBe(true);
    expect(sprintEmRisco(5, 10)?.em_risco).toBe(false);
    expect(sprintEmRisco(null, 10)).toBeNull();
  });
  function hist(): AmostraConcluida[] {
    return amostras(5, 3, 55);
  }
});
