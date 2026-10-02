import { describe, expect, it } from "vitest";
import { cfg, itemM, novoAgil } from "../../../tests/fixtures/agil/ajudas";
import type { SprintAgil, SprintItemAgil } from "../../compartilhado/agil";
import { calcularBurn } from "./metricas/burn";
import { calcularVelocidade } from "./metricas/velocidade";
import { amostrasLead, cycleTime, inicioDoLead, leadTime, segundaDa, throughput } from "./metricas/fluxo";
import { calcularCfd } from "./metricas/cfd";
import { calcularWip } from "./metricas/wip";
import { calcularPlanejado } from "./metricas/planejado";
import { calcularDefeitosEscapados } from "./metricas/defeitos";
import { indicadoresSaude, sprintEmRisco, type EntradaSaude } from "./metricas/saude";
import { amostraDiasUteis, preverTermino } from "./metricas/previsao";
import { gravarSnapshots, serieSnapshots, snapshotsDeFechamento, snapshotsDoPainel } from "./metricas/snapshots";
import { criarPainelComCache, filtrarItens, montarPainel, versaoDados, FILTROS_VAZIOS } from "./metricas/painel";
import { prng } from "./util";

const C = cfg();
const sprint = (o: Partial<SprintAgil> = {}): SprintAgil => ({ id: "s1", workspace_id: "ws1", nome: "S1", meta: null, inicio: "2026-03-02", fim: "2026-03-06", estado: "ativa", capacidade_pontos: null, compromisso_pontos: null, iniciada_em: null, fechada_em: null, versao_lancamento: null, resumo_fechamento: null, criado_em: "", atualizado_em: "", ...o });
const part = (o: Partial<SprintItemAgil> = {}): SprintItemAgil => ({ sprint_id: "s1", item_id: "x", adicionado_em: "2026-03-01T00:00:00.000Z", removido_em: null, pontos_compromisso: null, no_compromisso_inicial: true, motivo: null, resultado: null, ...o });
const H = 3_600_000;

describe("burndown/burnup com escopo variável (T-18.30)", () => {
  // seg 02 .. sex 06 (5 dias úteis). Compromisso 10 (5+5). Item C (3) entra na quarta; item B (5) sai na quinta; A (5) conclui na terça.
  const A = itemM({ item_id: "A", ref: "A", pontos: 5, concluida_em: "2026-03-03T10:00:00.000Z", participacoes: [part({ item_id: "A", pontos_compromisso: 5 })] });
  const B = itemM({ item_id: "B", ref: "B", pontos: 5, participacoes: [part({ item_id: "B", pontos_compromisso: 5, removido_em: "2026-03-05T09:00:00.000Z" })] });
  const Cc = itemM({ item_id: "C", ref: "C", pontos: 3, concluida_em: "2026-03-06T10:00:00.000Z", participacoes: [part({ item_id: "C", adicionado_em: "2026-03-04T09:00:00.000Z", no_compromisso_inicial: false, pontos_compromisso: 3 })] });
  const D = itemM({ item_id: "D", ref: "D", pontos: null, participacoes: [part({ item_id: "D" })] });
  it("escopo vigente por dia, concluído acumulado e ideal do compromisso inicial a zero", () => {
    const b = calcularBurn({ sprint: sprint({ compromisso_pontos: 10 }), itens: [A, B, Cc, D], unidade: "pontos", config: C, hoje: "2026-03-06" });
    expect(b.compromisso_inicial).toBe(10);
    expect(b.sem_estimativa).toBe(1);
    expect(b.dias.map((d) => [d.dia, d.escopo, d.concluido, d.restante, d.ideal])).toEqual([
      ["2026-03-02", 10, 0, 10, 8],
      ["2026-03-03", 10, 5, 5, 6],
      ["2026-03-04", 13, 5, 8, 4],
      ["2026-03-05", 8, 5, 3, 2],
      ["2026-03-06", 8, 8, 0, 0],
    ]);
  });
  it("dias futuros ficam null (sem linha plana inventada); alternar para itens", () => {
    const b = calcularBurn({ sprint: sprint({ compromisso_pontos: 10 }), itens: [A, B, Cc, D], unidade: "pontos", config: C, hoje: "2026-03-03" });
    expect(b.dias.map((d) => d.concluido)).toEqual([0, 5, null, null, null]);
    const i = calcularBurn({ sprint: sprint(), itens: [A, B, Cc, D], unidade: "itens", config: C, hoje: "2026-03-06" });
    expect(i.compromisso_inicial).toBe(3); // A, B, D no compromisso inicial
    expect(i.sem_estimativa).toBe(0);
    expect(i.dias[4]).toMatchObject({ escopo: 3, concluido: 2 }); // A e C concluídos; B removido; D (sem pontos) conta como item
  });
  it("fim de semana e feriado não entram no ideal; sem compromisso => ideal 0", () => {
    const s = sprint({ inicio: "2026-03-06", fim: "2026-03-09", compromisso_pontos: 6 }); // sex, sáb, dom, seg
    const b = calcularBurn({ sprint: s, itens: [], unidade: "pontos", config: C, hoje: "2026-03-09" });
    expect(b.dias.map((d) => d.ideal)).toEqual([3, 3, 3, 0]);
    const f = calcularBurn({ sprint: s, itens: [], unidade: "pontos", config: { ...C, feriados: ["2026-03-09"] }, hoje: "2026-03-09" });
    expect(f.dias.map((d) => d.ideal)).toEqual([0, 0, 0, 0]);
    expect(calcularBurn({ sprint: sprint(), itens: [], unidade: "pontos", config: C, hoje: "2026-03-06" }).dias.every((d) => d.ideal === 0)).toBe(true);
  });
  it("propriedades: burnup (concluído) monotônico e restante = escopo - concluído, com dados aleatórios", () => {
    const r = prng(5);
    for (let k = 0; k < 20; k++) {
      const itens = Array.from({ length: 12 }, (_, i) => itemM({ item_id: `i${i}`, ref: `i${i}`, pontos: 1 + Math.floor(r() * 8), concluida_em: r() > 0.4 ? `2026-03-0${2 + Math.floor(r() * 5)}T10:00:00.000Z` : null, participacoes: [part({ item_id: `i${i}`, adicionado_em: `2026-03-0${1 + Math.floor(r() * 3)}T00:00:00.000Z`, no_compromisso_inicial: r() > 0.5 })] }));
      const b = calcularBurn({ sprint: sprint(), itens, unidade: "pontos", config: C, hoje: "2026-03-06" });
      b.dias.forEach((d, i) => { expect(d.restante).toBe(d.escopo - (d.concluido as number)); if (i > 0) expect(d.concluido as number).toBeGreaterThanOrEqual(b.dias[i - 1]?.concluido as number); });
    }
  });
});

describe("velocidade (T-18.30)", () => {
  const fech = (id: string, ini: string, fim: string): SprintAgil => sprint({ id, nome: id, inicio: ini, fim, estado: "fechada", compromisso_pontos: 10 });
  it("soma pontos concluídos DENTRO da janela; média móvel de 3; de primeira só situação primeira", () => {
    const mk = (sp: string, ref: string, pts: number, dia: string, situacao: "primeira" | "retrabalho" | null) => itemM({ item_id: ref, ref, pontos: pts, concluida_em: `${dia}T10:00:00.000Z`, situacao, participacoes: [part({ sprint_id: sp, item_id: ref })] });
    const itens = [
      mk("a", "1", 5, "2026-03-03", "primeira"), mk("a", "2", 3, "2026-03-04", "retrabalho"), mk("a", "x", 8, "2026-02-20", "primeira"), // x: concluída antes da janela
      mk("b", "3", 8, "2026-03-11", "primeira"), mk("c", "4", 2, "2026-03-18", "primeira"), mk("d", "5", 6, "2026-03-25", null),
    ];
    const v = calcularVelocidade([fech("d", "2026-03-23", "2026-03-27"), fech("a", "2026-03-02", "2026-03-06"), fech("c", "2026-03-16", "2026-03-20"), fech("b", "2026-03-09", "2026-03-13")], itens);
    expect(v.map((x) => [x.sprint_id, x.concluido, x.de_primeira, x.media_movel_3])).toEqual([["a", 8, 5, null], ["b", 8, 8, null], ["c", 2, 2, 6], ["d", 6, null, expect.closeTo(5.3333, 3)]]);
  });
  it("item removido da sprint não conta; sprint sem conclusão tem 0 e de_primeira null", () => {
    const i = itemM({ pontos: 5, concluida_em: "2026-03-03T10:00:00.000Z", participacoes: [part({ removido_em: "2026-03-03T00:00:00.000Z" })] });
    expect(calcularVelocidade([fech("s1", "2026-03-02", "2026-03-06")], [i])[0]).toMatchObject({ concluido: 0 });
  });
});

describe("fluxo: cycle, lead e throughput (T-18.30)", () => {
  it("cycle: amostra mínima 5, percentis lineares, rótulo duração observada", () => {
    const itens = [1, 2, 3, 4, 5].map((n) => itemM({ ref: `r${n}`, concluida_em: "2026-03-03T00:00:00.000Z", duracao_obs_ms: n * H }));
    expect(cycleTime(itens)).toMatchObject({ estado: "ok", n: 5, p50: 3 * H });
    expect(cycleTime(itens).p85).toBeCloseTo(4.4 * H, 3);
    expect(cycleTime(itens).p95).toBeCloseTo(4.8 * H, 3);
    expect(cycleTime(itens.slice(0, 4)).estado).toBe("poucos_dados");
    expect(cycleTime([...itens, itemM({ ref: "x", concluida_em: null, duracao_obs_ms: 99 * H })]).n).toBe(5); // não concluída não entra
  });
  it("lead: entrada na sprint > criado_em (não-espelho) > primeiro evento (espelho); nunca negativo", () => {
    const base = { concluida_em: "2026-03-05T00:00:00.000Z" };
    const naSprint = itemM({ ...base, origem: "metodo", participacoes: [part({ adicionado_em: "2026-03-03T00:00:00.000Z" })] });
    expect(inicioDoLead(naSprint)).toBe("2026-03-03T00:00:00.000Z");
    const ade = itemM({ ...base, origem: "ade", criado_em: "2026-03-01T00:00:00.000Z" });
    expect(inicioDoLead(ade)).toBe("2026-03-01T00:00:00.000Z");
    const espelho = itemM({ ...base, origem: "metodo", criado_em: "2026-03-09T00:00:00.000Z", primeiro_evento_em: "2026-03-02T00:00:00.000Z" });
    expect(inicioDoLead(espelho)).toBe("2026-03-02T00:00:00.000Z"); // o criado_em do espelho é a hora do sync: não vale
    expect(inicioDoLead(itemM({ origem: "metodo" }))).toBeNull();
    expect(amostrasLead([naSprint, ade, espelho, itemM({ ...base, origem: "ade", criado_em: "2026-03-09T00:00:00.000Z", ref: "futuro" })]).map((a) => a.ms / 86_400_000)).toEqual([2, 4, 3]);
    expect(leadTime([naSprint]).estado).toBe("poucos_dados");
  });
  it("throughput por dia (zeros conhecidos) e por semana (segunda-feira)", () => {
    const itens = ["2026-03-02", "2026-03-02", "2026-03-04", "2026-03-10"].map((d, i) => itemM({ ref: `t${i}`, concluida_em: `${d}T10:00:00.000Z` }));
    expect(throughput(itens, "2026-03-02", "2026-03-05").map((d) => d.valor)).toEqual([2, 0, 1, 0]);
    expect(throughput(itens, "2026-03-02", "2026-03-12", "semana")).toEqual([{ dia: "2026-03-02", valor: 3 }, { dia: "2026-03-09", valor: 1 }]);
    expect(segundaDa("2026-03-08")).toBe("2026-03-02"); // domingo
    expect(segundaDa("2026-03-09")).toBe("2026-03-09");
  });
});

describe("CFD e WIP (T-18.30)", () => {
  const it1 = itemM({ ref: "a", origem: "ade", criado_em: "2026-03-02T00:00:00Z", pronto_em: "2026-03-03T00:00:00Z", iniciada_em: "2026-03-04T00:00:00Z", concluida_em: "2026-03-05T10:00:00Z", validada_em: "2026-03-06T10:00:00Z" });
  const it2 = itemM({ ref: "b", origem: "ade", criado_em: "2026-03-03T00:00:00Z" });
  it("5 estados por dia e acumulado não-decrescente em cada banda (propriedade)", () => {
    const c = calcularCfd([it1, it2], "2026-03-02", "2026-03-06");
    expect(c.dias.map((d) => [d.backlog, d.pronto, d.em_andamento, d.concluida, d.validada])).toEqual([[1, 0, 0, 0, 0], [1, 1, 0, 0, 0], [1, 0, 1, 0, 0], [1, 0, 0, 1, 0], [1, 0, 0, 0, 1]]);
    const ac = c.acumulado;
    expect(ac.map((d) => d.backlog)).toEqual([1, 2, 2, 2, 2]);
    expect(ac.map((d) => d.concluida)).toEqual([0, 0, 0, 1, 1]);
    for (const k of ["backlog", "pronto", "em_andamento", "concluida", "validada"] as const) expect(ac.every((p, i) => i === 0 || p[k] >= (ac[i - 1] as typeof p)[k])).toBe(true);
    // por estado: soma = total existente em cada dia
    c.dias.forEach((d, i) => expect(d.backlog + d.pronto + d.em_andamento + d.concluida + d.validada).toBe((ac[i] as { backlog: number }).backlog));
  });
  it("datas incoerentes (concluída antes de iniciada) são ajustadas sem quebrar a monotonia; descartado e órfão ficam fora", () => {
    const ruim = itemM({ ref: "r", origem: "ade", criado_em: "2026-03-02T00:00:00Z", iniciada_em: "2026-03-05T00:00:00Z", concluida_em: "2026-03-03T00:00:00Z" });
    const c = calcularCfd([ruim, itemM({ ref: "d", descartado: true }), itemM({ ref: "o", orfao: true })], "2026-03-02", "2026-03-06");
    expect(c.acumulado.map((d) => d.backlog)).toEqual([1, 1, 1, 1, 1]);
    for (const k of ["pronto", "em_andamento", "concluida", "validada"] as const) expect(c.acumulado.every((p, i) => i === 0 || p[k] >= (c.acumulado[i - 1] as typeof p)[k])).toBe(true);
  });
  it("WIP reconstruído dos intervalos e idade do WIP só dos em andamento", () => {
    const agora = Date.parse("2026-03-05T12:00:00Z");
    const a = itemM({ ref: "a", estado_fluxo: "em_andamento", intervalos: [["2026-03-03T09:00:00.000Z", null]] });
    const b = itemM({ ref: "b", estado_fluxo: "concluida", intervalos: [["2026-03-03T09:00:00.000Z", "2026-03-04T09:00:00.000Z"]] });
    const w = calcularWip([a, b], "2026-03-02", "2026-03-05", agora, 3);
    expect(w.dias.map((d) => d.valor)).toEqual([0, 2, 1, 1]);
    expect(w.limite).toBe(3);
    expect(w.idade).toEqual([{ ref: "a", idade_ms: Date.parse("2026-03-05T12:00:00Z") - Date.parse("2026-03-03T09:00:00Z") }]);
  });
});

describe("planejado × entregue e defeitos escapados (T-18.31)", () => {
  it("separa compromisso, adicionado no meio, removido e carregado; sem estimativa à parte", () => {
    const s = sprint({ fim: "2026-03-06" });
    const itens = [
      itemM({ ref: "1", pontos: 5, concluida_em: "2026-03-04T10:00:00Z", participacoes: [part({ item_id: "1", pontos_compromisso: 5 })] }),
      itemM({ ref: "2", pontos: 3, participacoes: [part({ item_id: "2", pontos_compromisso: 3 })] }),
      itemM({ ref: "3", pontos: 2, concluida_em: "2026-03-05T10:00:00Z", participacoes: [part({ item_id: "3", no_compromisso_inicial: false })] }),
      itemM({ ref: "4", pontos: 4, participacoes: [part({ item_id: "4", no_compromisso_inicial: false })] }),
      itemM({ ref: "5", pontos: 8, participacoes: [part({ item_id: "5", pontos_compromisso: 8, removido_em: "2026-03-03T00:00:00Z" })] }),
      itemM({ ref: "6", pontos: null, participacoes: [part({ item_id: "6" })] }),
      itemM({ ref: "fora", pontos: 9, participacoes: [] }),
    ];
    expect(calcularPlanejado(s, itens)).toEqual({ compromisso_inicial: 16, entregue_do_compromisso: 5, adicionado_meio: 6, entregue_adicionado: 2, removido: 8, carregado: 7, sem_estimativa: 1 });
  });
  it("defeito escapado: bug aberto DEPOIS do fechamento, regressao_de num trabalho da sprint (ou ligação humana)", () => {
    const sp = sprint({ id: "s1", estado: "fechada", fechada_em: "2026-03-07T00:00:00Z" });
    const itens = [itemM({ ref: "a", trabalho_id: "tr1", participacoes: [part({ sprint_id: "s1" })] })];
    const oc = (id: string, o: object = {}) => ({ id, tipo: "bug", aberta_em: "2026-03-10T00:00:00Z", regressao_de: "tr1", categoria: "api", task_ref: null, arquivos: [] as string[], ...o });
    const r = calcularDefeitosEscapados([sp], itens, [oc("1"), oc("2", { aberta_em: "2026-03-05T00:00:00Z" }), oc("3", { tipo: "melhoria" }), oc("4", { regressao_de: "outro" }), oc("5", { regressao_de: null, categoria: null }), oc("6", { aberta_em: null })], new Map([["5", "s1"]]));
    expect(r).toEqual({ total: 2, por_sprint: [{ sprint_id: "s1", n: 2 }], por_categoria: [{ categoria: "api", n: 1 }, { categoria: "sem_categoria", n: 1 }] });
  });
});

describe("saúde da sprint (T-18.31): sem nota única, com o fato que sustenta", () => {
  const base: EntradaSaude = { burn: null, hoje: "2026-03-04", escopo_adicionado_pct: null, wip_atual: null, wip_limite: null, bloqueios_abertos: null, sem_estimativa: null, ftr_sprint: null, ftr_media_movel: null, atrasadas: null, qa_reprovado_pendente: null, compromisso: null, capacidade: null, risco_critico: null, limiares: C.limiares_saude };
  const burn = (restante: number) => ({ unidade: "pontos" as const, sprint_id: "s1", compromisso_inicial: 10, sem_estimativa: 0, dias: [{ dia: "2026-03-04", escopo: 10, concluido: 10 - restante, restante, ideal: 5 }] });
  it("entrada desconhecida => indicador omitido (nunca verde por omissão)", () => {
    expect(indicadoresSaude(base)).toEqual([]);
  });
  it("progresso: > 20 % atrás amarelo, > 35 % vermelho (tabela)", () => {
    const cor = (restante: number) => indicadoresSaude({ ...base, burn: burn(restante) })[0]?.cor;
    expect(cor(6)).toBe("verde"); // 10% atrás
    expect(cor(7)).toBe("verde"); // exatamente 20%: não passa do limiar
    expect(cor(8)).toBe("amarelo"); // 30%
    expect(cor(9)).toBe("vermelho"); // 40%
    expect(indicadoresSaude({ ...base, burn: burn(8) })[0]?.fato).toMatch(/restante 8 vs ideal 5/);
  });
  it("demais indicadores (tabela)", () => {
    const i = (o: Partial<EntradaSaude>) => indicadoresSaude({ ...base, ...o });
    expect(i({ escopo_adicionado_pct: 0.3 })[0]).toMatchObject({ id: "escopo", cor: "amarelo" });
    expect(i({ wip_atual: 5, wip_limite: 3 })[0]).toMatchObject({ id: "wip", cor: "vermelho" });
    expect(i({ wip_atual: 5, wip_limite: null })).toEqual([]);
    expect(i({ bloqueios_abertos: 2 })[0]).toMatchObject({ id: "bloqueios", cor: "amarelo" });
    expect(i({ bloqueios_abertos: 0 })[0]?.cor).toBe("verde");
    expect(i({ sem_estimativa: 3 })[0]).toMatchObject({ id: "sem_estimativa", cor: "amarelo" });
    expect(i({ ftr_sprint: 0.6, ftr_media_movel: 0.85 })[0]).toMatchObject({ id: "ftr", cor: "amarelo" });
    expect(i({ ftr_sprint: 0.8, ftr_media_movel: 0.85 })[0]?.cor).toBe("verde");
    expect(i({ atrasadas: 2 })[0]).toMatchObject({ id: "atrasadas", cor: "amarelo" });
    expect(i({ qa_reprovado_pendente: 1 })[0]).toMatchObject({ id: "qa", cor: "vermelho" });
    expect(i({ compromisso: 30, capacidade: 25 })[0]).toMatchObject({ id: "capacidade", cor: "amarelo" });
    expect(i({ compromisso: 20, capacidade: 25 })[0]?.cor).toBe("verde");
    expect(i({ risco_critico: 3 })[0]).toMatchObject({ id: "risco", cor: "amarelo" });
    for (const x of i({ atrasadas: 0, bloqueios_abertos: 0 })) expect(x.fato.length).toBeGreaterThan(0);
  });
  it("sprint em risco: vermelho por >= 1 dia útil seguido", () => {
    expect(sprintEmRisco(["verde", "amarelo", "vermelho"])).toBe(true);
    expect(sprintEmRisco(["vermelho", "verde"])).toBe(false);
    expect(sprintEmRisco(["vermelho", "vermelho"], 2)).toBe(true);
    expect(sprintEmRisco([])).toBe(false);
  });
});

describe("previsão Monte Carlo (T-18.31)", () => {
  const amostra = [0, 1, 2, 0, 1, 3, 0, 1, 2, 1, 0, 2];
  const e = { amostra, restante: 20, iteracoes: 4000, semente: 7, dias_uteis_restantes: 5, hoje: "2026-03-09", config: C };
  it("exige >= 10 dias e >= 5 conclusões, senão dados_insuficientes", () => {
    expect(preverTermino({ ...e, amostra: [1, 2, 3] })).toEqual({ estado: "dados_insuficientes" });
    expect(preverTermino({ ...e, amostra: Array(12).fill(0) })).toEqual({ estado: "dados_insuficientes" });
    expect(preverTermino({ ...e, amostra: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] }).estado).toBe("ok");
  });
  it("semente fixa reproduz; P50 <= P85 <= P95; datas em dias úteis; faixa nunca data única", () => {
    const a = preverTermino(e);
    expect(preverTermino(e)).toEqual(a);
    expect(a.estado).toBe("ok");
    if (a.estado !== "ok") return;
    expect(a.p50_dias).toBeLessThanOrEqual(a.p85_dias);
    expect(a.p85_dias).toBeLessThanOrEqual(a.p95_dias);
    expect(a.p85_dias).toBeGreaterThan(5); // média 1,08/dia: 20 itens levam bem mais que uma semana
    expect(a.prob_fechar_na_sprint).toBeLessThan(0.05);
    for (const d of [a.p50_data, a.p85_data, a.p95_data]) expect([0, 6]).not.toContain(new Date(`${d}T00:00:00Z`).getUTCDay());
  });
  it("tabela determinística: throughput constante 2/dia e 10 restantes => 5 dias em todos os percentis; restante 0 => já", () => {
    const r = preverTermino({ ...e, amostra: Array(10).fill(2), restante: 10, dias_uteis_restantes: 5 });
    expect(r).toMatchObject({ estado: "ok", p50_dias: 5, p85_dias: 5, p95_dias: 5, prob_fechar_na_sprint: 1, p50_data: "2026-03-16" });
    expect(preverTermino({ ...e, restante: 0 })).toMatchObject({ estado: "ok", p95_dias: 0, prob_fechar_na_sprint: 1 });
    expect(preverTermino({ ...e, dias_uteis_restantes: null }).estado === "ok" && (preverTermino({ ...e, dias_uteis_restantes: null }) as { prob_fechar_na_sprint: number | null }).prob_fechar_na_sprint).toBeNull();
  });
  it("amostra só de dias úteis", () => {
    expect(amostraDiasUteis([{ dia: "2026-03-06", valor: 2 }, { dia: "2026-03-07", valor: 0 }, { dia: "2026-03-09", valor: 1 }], C)).toEqual([2, 1]);
  });
});

describe("snapshots e painel com cache (T-18.34)", () => {
  it("snapshot do mesmo dia sobrescreve (idempotente); série ordenada; valor desconhecido continua null", () => {
    const a = novoAgil();
    const base = { workspace_id: "ws1", escopo: "sprint" as const, chave: "s1", metrica: "ftr" };
    gravarSnapshots(a.banco, [{ ...base, dia: "2026-03-02", valor: 0.5 }, { ...base, dia: "2026-03-01", valor: null }, { ...base, dia: "2026-03-02", valor: 0.7 }]);
    expect(serieSnapshots(a.banco, "ws1", "sprint", "s1", "ftr")).toEqual([{ dia: "2026-03-01", valor: null }, { dia: "2026-03-02", valor: 0.7 }]);
    const r = { compromisso_inicial: 10, concluido_pontos: null, concluidos: 3, carregados: 1, devolvidos: 0, descartados: 0, sem_estimativa: 0, first_time_right: null, destino_pendentes: "backlog" as const };
    expect(snapshotsDeFechamento("ws1", { id: "s1" }, r, "2026-03-06").map((s) => [s.metrica, s.valor])).toContainEqual(["concluido", null]);
  });
  it("painel: workspace vazio não lança, 16 séries presentes e previsão dados_insuficientes", () => {
    const a = novoAgil();
    const p = montarPainel({ banco: a.banco, config: C, relogio: a.relogio }, "ws1", FILTROS_VAZIOS);
    expect(Object.keys(p).sort()).toEqual(["base", "burndown", "burnup", "cfd", "cycle", "defeitos_escapados", "distribuicao", "erro_estimativa", "filtros", "gerado_em", "lead", "planejado_entregue", "previsao", "retrabalho", "saude", "throughput", "valor_esforco", "velocidade", "wip"]);
    expect(p.previsao).toEqual({ estado: "dados_insuficientes" });
    expect(p.burndown).toBeNull();
    expect(p.retrabalho).toMatchObject({ ir: null, avaliaveis: 0 });
    expect(snapshotsDoPainel("ws1", "2026-03-10", p).find((s) => s.metrica === "ftr")?.valor).toBeNull();
  });
  it("cache por versão: igual => do cache; muda um fato/estimativa => recomputa", () => {
    const a = novoAgil();
    const cache = criarPainelComCache({ banco: a.banco, config: C, relogio: a.relogio });
    expect(cache.obter("ws1").do_cache).toBe(false);
    expect(cache.obter("ws1").do_cache).toBe(true);
    const v = versaoDados(a.banco, "ws1");
    a.banco.estimativas.set("e1", { id: "e1", item_id: "i", versao: 1, pontos: 3, rotulo: "3", escala_id: "fibonacci", min_h: null, max_h: null, origem: "ia", motor: "heuristica", confianca: 0.4, fatores: [], estado: "sugerida", ativa: true, nota: null, criado_em: "" });
    expect(versaoDados(a.banco, "ws1")).not.toBe(v);
    expect(cache.obter("ws1").do_cache).toBe(false);
    expect(cache.obter("ws1", { ...FILTROS_VAZIOS, agente: "x" }).do_cache).toBe(false); // outro filtro, outra chave
    cache.invalidar();
    expect(cache.obter("ws1").do_cache).toBe(false);
  });
  it("filtros: por agente muda só o que deve (itens do agente)", () => {
    const itens = [itemM({ ref: "a", agente: "x", membro_id: "m1" }), itemM({ ref: "b", agente: "y", membro_id: "m2" }), itemM({ ref: "c", agente: "x", descartado: true })];
    expect(filtrarItens(itens, { ...FILTROS_VAZIOS, agente: "x" }).map((i) => i.ref)).toEqual(["a"]);
    expect(filtrarItens(itens, { ...FILTROS_VAZIOS, membro_id: "m2" }).map((i) => i.ref)).toEqual(["b"]);
    expect(filtrarItens(itens, FILTROS_VAZIOS).map((i) => i.ref)).toEqual(["a", "b"]);
  });
});
