import { describe, expect, it } from "vitest";
import { compararTarefas, pontuarTarefa, recomendar, rascunhoDePolitica, vencedorDaTarefa, type EntradaScore, type MetaAlvo } from "./score";
import { taskTypeDaAtividade, MAPA_ATIVIDADES } from "./mapa-atividades";
import { TASK_TYPES_EMBUTIDOS } from "../harness/task-types";

const e = (alvo: string, q: number | null, dur: number | null, custo: number | null, extra: Partial<EntradaScore> = {}): EntradaScore => ({ resultado_id: `r_${alvo}`, alvo, qualidade: q, duracao_s: dur, custo_usd: custo, critica_falhou: false, revisoes: null, ...extra });
const comp = (xs: EntradaScore[], alvo: string) => pontuarTarefa(xs).find((s) => s.alvo === alvo)!;

describe("pontuarTarefa", () => {
  it("fórmula: 100·(0,6·Q + 0,2·S + 0,2·C) com S e C normalizados pelo mínimo", () => {
    const xs = [e("a", 8, 10, 1), e("b", 10, 20, 2)];
    expect(comp(xs, "a").composite).toBeCloseTo(100 * (0.6 * 0.8 + 0.2 * 1 + 0.2 * 1), 6);
    expect(comp(xs, "b").composite).toBeCloseTo(100 * (0.6 * 1 + 0.2 * 0.5 + 0.2 * 0.5), 6);
  });
  it("portão: qualidade < 4 zera S e C (barato que quebra não pontua)", () => {
    const xs = [e("barato", 3.9, 1, 0.01), e("caro", 8, 100, 5)];
    expect(comp(xs, "barato").s).toBe(0);
    expect(comp(xs, "barato").c).toBe(0);
    expect(comp(xs, "barato").composite).toBeCloseTo(60 * 0.39, 5);
    expect(comp(xs, "caro").composite!).toBeGreaterThan(comp(xs, "barato").composite!);
    expect(vencedorDaTarefa(xs, pontuarTarefa(xs)).alvo).toBe("caro");
  });
  it("portão: checagem crítica falhada também zera S e C", () => {
    const xs = [e("a", 9, 1, 0.01, { critica_falhou: true }), e("b", 6, 50, 3)];
    expect([comp(xs, "a").s, comp(xs, "a").c]).toEqual([0, 0]);
    expect(comp(xs, "a").composite).toBeCloseTo(54, 6); // só a qualidade conta: o barato e rápido que quebrou não ganha bônus
    expect(comp(xs, "b").s).toBeGreaterThan(0);
  });
  it("custo desconhecido em QUALQUER alvo exclui o C e renormaliza os pesos, marcando sem_custo", () => {
    const xs = [e("a", 8, 10, null), e("b", 10, 20, 2)];
    const a = comp(xs, "a");
    expect(a.sem_custo).toBe(true);
    expect(a.composite).toBeCloseTo((100 * (0.6 * 0.8 + 0.2 * 1)) / 0.8, 6);
    expect(comp(xs, "b").composite).toBeCloseTo((100 * (0.6 * 1 + 0.2 * 0.5)) / 0.8, 6);
  });
  it("alvo único: S = C = 1 e marcado não comparável", () => {
    const s = comp([e("solo", 5, 7, 3)], "solo");
    expect([s.s, s.c, s.nao_comparavel]).toEqual([1, 1, true]);
  });
  it("sem nota (não julgado) fica sem composite", () => {
    expect(comp([e("a", null, 1, 1), e("b", 9, 1, 1)], "a").composite).toBeNull();
  });
  it("revisões penalizam 5% cada (null no MVP não penaliza)", () => {
    const xs = [e("a", 10, 10, 1, { revisoes: 2 }), e("b", 10, 10, 1)];
    expect(comp(xs, "a").composite).toBeCloseTo(100 * 0.9, 6);
    expect(comp(xs, "b").composite).toBe(100);
  });
  it("entrar um alvo novo muda S/C de todos SEM mexer nas entradas (recálculo por conjunto)", () => {
    const base = [e("a", 8, 10, 1), e("b", 8, 20, 2)];
    const antes = comp(base, "b").composite!;
    const depois = comp([...base, e("c", 8, 5, 0.5)], "b").composite!;
    expect(depois).toBeLessThan(antes);
    expect(base[1]).toEqual(e("b", 8, 20, 2));
  });
  it("pesos inválidos caem no padrão; pesos customizados valem", () => {
    const xs = [e("a", 10, 10, 1), e("b", 10, 10, 1)];
    expect(pontuarTarefa(xs, { q: -1, s: 0, c: 0 })[0]!.composite).toBe(100);
    expect(pontuarTarefa([e("a", 5, 10, 1), e("b", 10, 10, 1)], { q: 1, s: 0, c: 0 })[0]!.composite).toBe(50);
  });
});

describe("vencedor, empate e comparação", () => {
  it("empate (|Δ| < 1) resolve por menor custo, depois por menos revisões; empate real fica sem vencedor", () => {
    const xs = [e("a", 8, 10, 2), e("b", 8, 10, 1)];
    expect(vencedorDaTarefa(xs, pontuarTarefa(xs)).alvo).toBe("b");
    const ys = [e("a", 8, 10, 1, { revisoes: 1 }), e("b", 8, 10, 1, { revisoes: 0 })];
    expect(vencedorDaTarefa(ys, pontuarTarefa(ys, { q: 1, s: 0, c: 0 })).alvo).toBe("b");
    const zs = [e("a", 8, 10, 1), e("b", 8, 10, 1)];
    expect(vencedorDaTarefa(zs, pontuarTarefa(zs))).toEqual({ alvo: null, empate: true });
  });
  it("placar soma o número de tarefas (empates à parte) e o veredito é texto com números", () => {
    const t = (n: string, a: EntradaScore, b: EntradaScore) => ({ tarefa: n, versao: 1, atividade: "x", entradas: [a, b] });
    const c = compararTarefas(["a", "b"], [t("t1", e("a", 9, 10, 1), e("b", 5, 10, 1)), t("t2", e("a", 5, 10, 1), e("b", 9, 10, 1)), t("t3", e("a", 9, 10, 1), e("b", 4, 10, 1)), t("t4", e("a", 8, 10, 1), e("b", 8, 10, 1))]);
    expect(Object.values(c.placar.vitorias).reduce((x, y) => x + y, 0) + c.placar.empates).toBe(4);
    expect(c.placar.vitorias).toEqual({ a: 2, b: 1 });
    expect(c.placar.empates).toBe(1);
    expect(c.veredito).toMatch(/a venceu 2 de 4 tarefa\(s\) contra 1 de b, 1 empate\(s\)/);
    expect(c.selos).toEqual([]);
  });
  it("selo sem_custo quando há custo desconhecido e custo total do alvo some se faltar custo", () => {
    const c = compararTarefas(["a", "b"], [{ tarefa: "t", versao: 1, atividade: "x", entradas: [e("a", 9, 10, null), e("b", 9, 10, 1)] }]);
    expect(c.selos).toContain("sem_custo");
    expect(c.agregado.find((x) => x.alvo === "a")!.custo_total_usd).toBeNull();
    expect(c.agregado.find((x) => x.alvo === "b")!.custo_total_usd).toBe(1);
  });
});

describe("recomendar e política", () => {
  const meta = new Map<string, MetaAlvo>([["a", { provedor: "p1", modelo: "m1", esforco: null, cli: "claude" }], ["b", { provedor: "p2", modelo: "m2", esforco: "high", cli: "codex" }], ["c", { provedor: "p1", modelo: "m3", esforco: null, cli: "claude" }]]);
  const amostras = [{ atividade: "bug", tarefa: "t1", versao: 1, entradas: [e("a", 9, 10, 1), e("b", 6, 5, 0.1), e("c", 8, 12, 0.5)] }];
  it("sem dados → sem_dados (nunca extrapola); ordem por composite com desempate por slug", () => {
    expect(recomendar("outra", amostras, meta)).toEqual({ atividade: "outra", sem_dados: true, ranking: [] });
    const r = recomendar("bug", amostras, meta);
    expect(r.sem_dados).toBe(false);
    expect(r.ranking.map((x) => x.alvo)).toEqual([...r.ranking.map((x) => x.alvo)].sort((x, y) => r.ranking.find((i) => i.alvo === y)!.composite - r.ranking.find((i) => i.alvo === x)!.composite || x.localeCompare(y)));
    expect(r.ranking[0]!.evidencia).toEqual(["r_" + r.ranking[0]!.alvo]);
    expect(r.ranking[0]!.tentativas_esperadas).toBe(1);
  });
  it("restrições (custo, duração, provedores) e provedor habilitado filtram", () => {
    expect(recomendar("bug", amostras, meta, { restricoes: { custo_max_usd: 0.6, duracao_max_s: null, provedores: null } }).ranking.map((x) => x.alvo).sort()).toEqual(["b", "c"]);
    expect(recomendar("bug", amostras, meta, { restricoes: { custo_max_usd: null, duracao_max_s: null, provedores: ["p2"] } }).ranking.map((x) => x.alvo)).toEqual(["b"]);
    expect(recomendar("bug", amostras, meta, { provedores_habilitados: new Set(["codex"]) }).ranking.map((x) => x.alvo)).toEqual(["b"]);
    expect(recomendar("bug", amostras, meta, { provedores_habilitados: new Set() }).sem_dados).toBe(true);
  });
  it("estratégia mais_barato_aceitavel respeita min_q", () => {
    const r = recomendar("bug", amostras, meta, { estrategia: "mais_barato_aceitavel", min_q: 7 });
    expect(r.ranking.map((x) => x.alvo)).toEqual(["c", "a"]); // b (q 6) é mais barato, mas abaixo do mínimo
    const r2 = recomendar("bug", amostras, meta, { estrategia: "mais_rapido_aceitavel", min_q: 7 });
    expect(r2.ranking[0]!.alvo).toBe("a");
  });
  it("min_amostras exige mais de um dado antes de recomendar", () => {
    expect(recomendar("bug", amostras, meta, { min_amostras: 2 }).sem_dados).toBe(true);
  });
  it("rascunho de política: mapeia atividade → TaskType, traz alternativas e avisa o que não mapeia", () => {
    const r = recomendar("bug", amostras, meta);
    const p = rascunhoDePolitica([r, { atividade: "inventada", sem_dados: false, ranking: r.ranking }, { atividade: "css", sem_dados: true, ranking: [] }]);
    expect(p.rascunho).toHaveLength(1);
    expect(p.rascunho[0]!.task_type).toBe("bug-fix");
    expect(p.rascunho[0]!.alternativas.length).toBeLessThanOrEqual(2);
    expect(p.rascunho[0]!.executor).toMatchObject({ provider: expect.stringMatching(/^(claude|codex)$/), cli: expect.any(String), faixa: null });
    expect(p.avisos.join(" ")).toMatch(/inventada.*sem TaskType/);
    expect(p.avisos.join(" ")).toMatch(/css.*sem dados/);
  });
  it("todo TaskType do mapa existe no harness (reconciliado com a Fase 9)", () => {
    const slugs = new Set(TASK_TYPES_EMBUTIDOS.map((t) => t.slug));
    for (const [atividade, tt] of Object.entries(MAPA_ATIVIDADES)) expect(slugs.has(tt), `${atividade} → ${tt}`).toBe(true);
    expect(taskTypeDaAtividade("não-existe")).toBeNull();
  });
});
