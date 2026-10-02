import { describe, expect, it } from "vitest";
import { aplicar, CURIOSO_MS, COMEMORAR_MISSAO_MS, COMEMORAR_PANE_MS, DORMIR_APOS_MS, DOENTE_EXPIRA_MS, estaDoente, FLUXO_SEGURA_MS, humorDe, PREOCUPADO_MS, proximaMudanca, rastroInicial, SEGURAR_TRABALHO_MS, type EventoHumor, type Rastro } from "./humor";

const T0 = 1_000_000;
const rodar = (eventos: Array<[number, EventoHumor]>, inicio = T0): Rastro => eventos.reduce((r, [t, e]) => aplicar(r, e, t), rastroInicial(inicio));
const pane = (id: string, estado: "iniciando" | "pronto" | "trabalhando" | "aguardando" | "bloqueado" | "encerrado"): EventoHumor => ({ tipo: "pane", id, estado });

describe("máquina de humor (D-464): eventos → humor", () => {
  it("começa ocioso", () => expect(humorDe(rastroInicial(T0), T0)).toBe("ocioso"));

  const tabela: Array<[string, Array<[number, EventoHumor]>, number, string]> = [
    ["Pane trabalhando", [[T0, pane("a", "trabalhando")]], T0 + 5_000, "trabalhando"],
    ["Pane aguardando", [[T0, pane("a", "trabalhando")], [T0 + 100, pane("a", "aguardando")]], T0 + 200, "aguardando"],
    ["Pane bloqueado conta como aguardando", [[T0, pane("a", "bloqueado")]], T0 + 10, "aguardando"],
    ["Pane iniciando = pensando", [[T0, pane("a", "iniciando")]], T0 + 1_000, "pensando"],
    ["Missão iniciada = pensando", [[T0, { tipo: "missao", resultado: "iniciada" }]], T0 + 1_000, "pensando"],
    ["Missão concluída = comemorando", [[T0, { tipo: "missao", resultado: "concluida" }]], T0 + 1_000, "comemorando"],
    ["Missão falhou = preocupado", [[T0, { tipo: "missao", resultado: "falhou" }]], T0 + 1_000, "preocupado"],
    ["Missão abortada não muda o humor", [[T0, { tipo: "missao", resultado: "abortada" }]], T0 + 1_000, "ocioso"],
    ["Executar ok = comemorando (build/testes verdes)", [[T0, { tipo: "execucao", resultado: "sucesso" }]], T0 + 500, "comemorando"],
    ["Executar falhou = preocupado", [[T0, { tipo: "execucao", resultado: "falha" }]], T0 + 500, "preocupado"],
    ["Executar parado pelo usuário não comemora nem preocupa", [[T0, { tipo: "execucao", resultado: "parada" }]], T0 + 500, "ocioso"],
    ["alerta crítico = preocupado", [[T0, { tipo: "alerta", severidade: "critico" }]], T0 + 500, "preocupado"],
    ["alerta informativo não muda", [[T0, { tipo: "alerta", severidade: "info" }]], T0 + 500, "ocioso"],
    ["Pane que falhou ao abrir = preocupado", [[T0, pane("a", "iniciando")], [T0 + 10, { tipo: "pane_fechado", id: "a", motivo: "falha_ao_abrir" }]], T0 + 20, "preocupado"],
    ["Pane fechado pelo usuário não preocupa", [[T0, pane("a", "trabalhando")], [T0 + 10_000, { tipo: "pane_fechado", id: "a", motivo: "usuario" }]], T0 + 12_000, "ocioso"],
    ["atenção = curioso", [[T0, { tipo: "atencao" }]], T0 + 100, "curioso"],
  ];
  for (const [nome, eventos, quando, esperado] of tabela) it(nome, () => expect(humorDe(rodar(eventos), quando)).toBe(esperado));

  it("prioridade: aguardando > preocupado > trabalhando > pensando > comemorando", () => {
    const r = rodar([[T0, { tipo: "missao", resultado: "concluida" }], [T0 + 1, pane("a", "iniciando")], [T0 + 2, pane("b", "trabalhando")]]);
    expect(humorDe(r, T0 + 10)).toBe("trabalhando");
    const r2 = aplicar(r, { tipo: "missao", resultado: "falhou" }, T0 + 20);
    expect(humorDe(r2, T0 + 30)).toBe("preocupado");
    const r3 = aplicar(r2, pane("c", "aguardando"), T0 + 40);
    expect(humorDe(r3, T0 + 50)).toBe("aguardando");
  });

  it("Pane que trabalhou ≥ 3 s e fica pronto comemora; abaixo de 3 s (rajada do histórico) não", () => {
    const longo = rodar([[T0, pane("a", "trabalhando")], [T0 + 3_000, pane("a", "pronto")]]);
    expect(humorDe(longo, T0 + 3_000 + SEGURAR_TRABALHO_MS + 10)).toBe("comemorando");
    expect(humorDe(longo, T0 + 3_000 + COMEMORAR_PANE_MS + 10)).toBe("ocioso");
    const curto = rodar([[T0, pane("a", "trabalhando")], [T0 + 500, pane("a", "pronto")]]);
    expect(humorDe(curto, T0 + 500 + SEGURAR_TRABALHO_MS + 10)).toBe("ocioso");
  });

  it("debounce: entre dois turnos colados o humor não pisca (segura 'trabalhando')", () => {
    const r = rodar([[T0, pane("a", "trabalhando")], [T0 + 4_000, pane("a", "pronto")]]);
    expect(humorDe(r, T0 + 4_000 + SEGURAR_TRABALHO_MS - 1)).toBe("trabalhando");
    const volta = aplicar(r, pane("a", "trabalhando"), T0 + 4_300);
    expect(humorDe(volta, T0 + 4_400)).toBe("trabalhando");
  });

  it("sono: sem nenhuma atividade por 5 min dorme; qualquer evento acorda", () => {
    const r = rastroInicial(T0);
    expect(humorDe(r, T0 + DORMIR_APOS_MS - 1)).toBe("ocioso");
    expect(humorDe(r, T0 + DORMIR_APOS_MS)).toBe("dormindo");
    const acordou = aplicar(r, { tipo: "atencao" }, T0 + DORMIR_APOS_MS + 5);
    expect(humorDe(acordou, T0 + DORMIR_APOS_MS + 6)).toBe("curioso");
    expect(humorDe(acordou, T0 + DORMIR_APOS_MS + 6 + CURIOSO_MS)).toBe("ocioso");
  });

  it("preocupação passa sozinha; sucesso depois do erro cura na hora", () => {
    const r = rodar([[T0, { tipo: "execucao", resultado: "falha" }]]);
    expect(humorDe(r, T0 + PREOCUPADO_MS - 1)).toBe("preocupado");
    expect(humorDe(r, T0 + PREOCUPADO_MS)).toBe("ocioso");
    const curado = aplicar(r, { tipo: "missao", resultado: "concluida" }, T0 + 1_000);
    expect(humorDe(curado, T0 + 1_001)).toBe("comemorando");
    expect(humorDe(curado, T0 + 1_000 + COMEMORAR_MISSAO_MS + 1)).toBe("ocioso");
  });

  it("limite de cota ≥ 85% adoece; abaixo disso cura; expira sozinho", () => {
    const baixo = aplicar(rastroInicial(T0), { tipo: "limite", pct: 70 }, T0);
    expect(estaDoente(baixo, T0 + 1)).toBe(false);
    const alto = aplicar(rastroInicial(T0), { tipo: "limite", pct: 85 }, T0);
    expect(estaDoente(alto, T0 + 1)).toBe(true);
    expect(estaDoente(alto, T0 + DOENTE_EXPIRA_MS)).toBe(false);
    expect(estaDoente(aplicar(alto, { tipo: "limite", pct: 40 }, T0 + 10), T0 + 11)).toBe(false);
  });

  it("devolve o MESMO objeto quando o evento não muda nada", () => {
    const r = rastroInicial(T0);
    expect(aplicar(r, { tipo: "alerta", severidade: "aviso" }, T0)).toBe(r);
    expect(aplicar(r, { tipo: "limite", pct: 10 }, T0)).toBe(r);
    expect(aplicar(r, { tipo: "pane_fechado", id: "x", motivo: "usuario" }, T0)).toBe(r);
  });

  it("proximaMudanca: nada com trabalho em andamento; senão fim da janela ou hora de dormir; null depois de dormir", () => {
    const trabalhando = rodar([[T0, pane("a", "trabalhando")]]);
    expect(proximaMudanca(trabalhando, T0 + 10)).toBeNull();
    const festa = rodar([[T0, { tipo: "missao", resultado: "concluida" }]]);
    expect(proximaMudanca(festa, T0 + 10)).toBe(T0 + COMEMORAR_MISSAO_MS);
    expect(proximaMudanca(rastroInicial(T0), T0 + 10)).toBe(T0 + DORMIR_APOS_MS);
    expect(proximaMudanca(rastroInicial(T0), T0 + DORMIR_APOS_MS + 1)).toBeNull();
  });

  it("orçamento: 100 mil eventos de humor em < 400 ms (custo por evento desprezível; nada de timer)", () => {
    let r = rastroInicial(T0);
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) r = aplicar(r, pane(`p${i % 8}`, i % 3 === 0 ? "trabalhando" : i % 3 === 1 ? "aguardando" : "pronto"), T0 + i * 10);
    expect(humorDe(r, T0 + 1_000_000)).toBeTruthy();
    expect(performance.now() - t0).toBeLessThan(400 * Number(process.env["EXPXV_PERF_FATOR"] ?? "1"));
  });
});

describe("pulso de atividade (CLI sem adaptador)", () => {
  const pulso = (nivel: number, fluxo: boolean, atividade_em: number): EventoHumor => ({ tipo: "pulso", nivel, fluxo, atividade_em });
  it("saída fluindo = trabalhando mesmo sem nenhum evento de Pane (Grok)", () => {
    const r = rodar([[T0 + 1_000, pulso(3, true, T0 + 1_000)]]);
    expect(humorDe(r, T0 + 1_500)).toBe("trabalhando");
    expect(humorDe(r, T0 + 1_000 + FLUXO_SEGURA_MS + 1)).toBe("ocioso");
  });
  it("nível 1 (atento) sozinho não vira trabalhando", () => expect(humorDe(rodar([[T0 + 10, pulso(1, false, T0 + 10)]]), T0 + 20)).toBe("ocioso"));
  it("nunca dorme com esforço > 0 nem com atividade recente; dorme só depois de 5 min reais", () => {
    const r = rodar([[T0, pulso(1, false, T0)]]);
    expect(humorDe(r, T0 + DORMIR_APOS_MS + 1)).toBe("ocioso");
    const calmo = aplicar(r, pulso(0, false, T0), T0 + 30_000);
    expect(humorDe(calmo, T0 + DORMIR_APOS_MS - 1)).toBe("ocioso");
    expect(humorDe(calmo, T0 + DORMIR_APOS_MS)).toBe("dormindo");
  });
  it("pulso renova o relógio do sono; evento sem mudança devolve o mesmo objeto", () => {
    const r = rodar([[T0, pulso(0, false, T0 + 200_000)]]);
    expect(humorDe(r, T0 + 200_000 + DORMIR_APOS_MS - 1)).toBe("ocioso");
    expect(aplicar(r, pulso(0, false, T0 + 200_000), T0 + 1)).toBe(r);
  });
  it("aguardando e preocupado continuam vencendo o fluxo", () => {
    const r = rodar([[T0, pulso(4, true, T0)], [T0 + 1, pane("a", "aguardando")]]);
    expect(humorDe(r, T0 + 5)).toBe("aguardando");
  });
  it("proximaMudanca inclui o fim do fluxo", () => {
    const r = rodar([[T0, pulso(3, true, T0)]]);
    expect(proximaMudanca(r, T0 + 1)).toBe(T0 + FLUXO_SEGURA_MS);
  });
});
