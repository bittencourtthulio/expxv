// Portão da fase (parte núcleo): a fixture de 40 sprints bate com os valores calculados À MÃO (tests/fixtures/agil/historico-esperado.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { carregarHistorico, HOJE, SPRINTS, type Historico } from "../../../tests/fixtures/agil/gerar";
import * as E from "../../../tests/fixtures/agil/historico-esperado";
import { montarPainel } from "./metricas/painel";
import { montarItensMetrica } from "./metricas/dados";
import { calcularBurn } from "./metricas/burn";
import { throughput } from "./metricas/fluxo";
import { calcularPlanejado } from "./metricas/planejado";
import { calcularDefeitosEscapados } from "./metricas/defeitos";
import { ocorrencias } from "../../../tests/fixtures/agil/gerar";
import { metricasXp } from "./praticas/xp";
import { resumirRetrabalho } from "./retrabalho/agregar";
import type { PainelAgil } from "../../compartilhado/agil";

let h: Historico;
let painel: PainelAgil;
beforeAll(async () => {
  h = await carregarHistorico();
  painel = montarPainel({ banco: h.agil.banco, config: h.agil.config.ler("ws1"), relogio: () => Date.parse(HOJE), ocorrencias: ocorrencias() }, "ws1", { sprint_id: null, membro_id: null, agente: null, squad_id: null, de: null, ate: null });
});

describe("histórico de 40 sprints", () => {
  it("sincroniza 160 tasks e 150 concluídas, por task como esperado", () => {
    const fatos = h.agil.banco.fatos.valores();
    expect(fatos).toHaveLength(SPRINTS * 4);
    const concl = fatos.filter((f) => f.status_visto === "concluida");
    expect(concl).toHaveLength(E.CONCLUIDAS_TOTAL);
    E.CONCLUIDAS_POR_TASK.forEach((n, k) => expect(concl.filter((f) => f.task_ref === `T-01.0${k + 1}`)).toHaveLength(n));
  });

  it("velocidade por sprint = esperado; média móvel de 3", () => {
    expect(painel.velocidade).toHaveLength(SPRINTS);
    painel.velocidade.forEach((v, i) => expect(v.concluido).toBe(E.velocidadeEsperada(i + 1)));
    expect(painel.velocidade[0]?.media_movel_3).toBeNull();
    expect(painel.velocidade[3]?.media_movel_3).toBeCloseTo((18 + 18 + 10) / 3, 4); // sprints 2,3,4
  });

  it("cycle time P50/P85/P95 por interpolação linear", () => {
    expect(painel.cycle.estado).toBe("ok");
    expect(painel.cycle.n).toBe(E.CYCLE.n);
    expect([painel.cycle.p50, painel.cycle.p85, painel.cycle.p95]).toEqual([E.CYCLE.p50, E.CYCLE.p85, E.CYCLE.p95]);
  });

  it("índice de retrabalho, FTR e contadores batem; denominador exclui o que não é avaliável", () => {
    const r = painel.retrabalho;
    expect(r.avaliaveis).toBe(E.RETRABALHO.avaliaveis);
    expect(r.ir).toBe(E.RETRABALHO.ir);
    expect(r.ir_max).toBe(E.RETRABALHO.ir);
    expect(r.first_time_right).toBe(E.RETRABALHO.first_time_right);
    expect(r.em_observacao).toBe(E.RETRABALHO.em_observacao);
    expect(r.indeterminado).toBe(E.RETRABALHO.indeterminado);
    expect(r.escopo_eventos).toBe(E.RETRABALHO.escopo_eventos);
    expect(r.pontos_retrabalhados).toBe(E.RETRABALHO.pontos_retrabalhados);
    expect(r.horas_obs_retrabalho_min).toBe(E.RETRABALHO.horas_observadas_retrabalho_min);
  });

  it("retrabalho por sprint (casos escolhidos)", () => {
    for (const [n, ir] of Object.entries(E.IR_SPRINT)) {
      const r = painel.retrabalho.por_sprint.find((p) => p.sprint_id === h.sprintIds[Number(n) - 1]);
      expect(r?.resumo.ir, `sprint ${n}`).toBeCloseTo(ir, 3);
    }
  });

  it("erro de estimativa: viés e MdAPE por categoria", () => {
    const f = painel.erro_estimativa.por_categoria.find((c) => c.categoria === "feature");
    const b = painel.erro_estimativa.por_categoria.find((c) => c.categoria === "bug");
    expect(f?.n).toBe(E.ERRO_ESTIMATIVA.feature.n);
    expect(f?.vies).toBeCloseTo(E.ERRO_ESTIMATIVA.feature.vies, 6);
    expect(f?.mdape).toBeCloseTo(E.ERRO_ESTIMATIVA.feature.mdape, 3);
    expect(b?.n).toBe(E.ERRO_ESTIMATIVA.bug.n);
    expect(b?.vies).toBeCloseTo(1, 6);
    expect(b?.mdape).toBeCloseTo(0, 6);
  });

  it("burndown da sprint 1 dia a dia", () => {
    const it = montarItensMetrica(h.agil.banco, "ws1");
    const s = h.agil.banco.sprints.get(h.sprintIds[0] as string);
    expect(s).toBeDefined();
    if (!s) return;
    const b = calcularBurn({ sprint: s, itens: it, unidade: "pontos", config: h.agil.config.ler("ws1"), hoje: "2027-12-01" });
    expect(b.compromisso_inicial).toBe(18);
    expect(b.sem_estimativa).toBe(0);
    expect(b.dias.map((d) => ({ dia: d.dia, concluido: d.concluido, restante: d.restante, ideal: d.ideal }))).toEqual(E.BURNDOWN_SPRINT_1);
    expect(b.dias.every((d) => d.escopo === 18)).toBe(true);
    // burnup monotônico
    const conc = b.dias.map((d) => d.concluido as number);
    expect(conc.every((x, i) => i === 0 || x >= (conc[i - 1] as number))).toBe(true);
  });

  it("throughput da sprint 1 e dias vazios são zero conhecido", () => {
    const it = montarItensMetrica(h.agil.banco, "ws1");
    const t = throughput(it, "2026-01-05", "2026-01-16");
    for (const d of t) expect(d.valor).toBe(E.THROUGHPUT_SPRINT_1[d.dia] ?? 0);
  });

  it("planejado × entregue da sprint 4 e defeitos escapados", () => {
    const it = montarItensMetrica(h.agil.banco, "ws1");
    const s4 = h.agil.banco.sprints.get(h.sprintIds[3] as string);
    if (!s4) throw new Error("sprint 4");
    const p = calcularPlanejado(s4, it);
    expect(p).toMatchObject(E.PLANEJADO_SPRINT_4);
    const d = calcularDefeitosEscapados(h.agil.banco.sprints.valores(), it, ocorrencias());
    expect(d.total).toBe(E.DEFEITOS_ESCAPADOS.total);
    expect(d.por_sprint.map((x) => x.sprint_id).sort()).toEqual(E.DEFEITOS_ESCAPADOS.sprints.map((n) => h.sprintIds[n - 1] as string).sort());
    expect(d.por_categoria).toEqual([{ categoria: E.DEFEITOS_ESCAPADOS.categoria, n: 5 }]);
  });

  it("XP: tdd primeiro, vermelho antes do verde e commits", () => {
    const itens = montarItensMetrica(h.agil.banco, "ws1");
    const m = metricasXp({ fatos: h.agil.banco.fatos.valores(), itens, com_par: new Set(), ci_verde: new Map(), revisao_independente: new Map(), config: { commit_grande_linhas: 400 } });
    const v = (c: string): number | null => m.find((x) => x.codigo === c)?.valor ?? null;
    expect(v("tdd_primeiro")).toBeCloseTo(E.XP.tdd_primeiro, 3);
    expect(v("vermelho_antes_do_verde")).toBeCloseTo(E.XP.vermelho_antes_do_verde, 3);
    expect(v("commit_por_task")).toBe(1);
    expect(v("commits_pequenos")).toBe(E.XP.commits_pequenos_mediana);
    expect(m.find((x) => x.codigo === "ci_verde")?.estado).toBe("indeterminado");
  });

  it("agregação por categoria e por agente são consistentes com o total", () => {
    const itens = montarItensMetrica(h.agil.banco, "ws1");
    const linhas = itens.filter((i) => i.situacao !== null).map((i) => ({ chave: i.ref, situacao: i.situacao, eventos_pendentes: i.eventos_pendentes, pontos: i.pontos, categoria: i.categoria, sprint_id: null, membro_id: i.membro_id, agente: i.agente, squad_id: i.squad_id, retrabalho_ms: i.retrabalho_ms }));
    const geral = resumirRetrabalho(linhas);
    expect(geral.avaliaveis).toBe(150);
    // atribuição ao AUTOR ORIGINAL: o retrabalho de T2 (QA alta em n%5) é de `ana`, o de T1 (reabertura) de `impl-1`
    const ana = linhas.filter((l) => l.agente === "ana");
    expect(resumirRetrabalho(ana).avaliaveis).toBe(40);
    expect(resumirRetrabalho(ana).ir).toBeCloseTo(8 / 40, 4);
    const agente1 = linhas.filter((l) => l.agente === "impl-1");
    expect(resumirRetrabalho(agente1).ir).toBeCloseTo(4 / 40, 4);
  });

  it("painel não acusa vazio indevido: base, CFD monotônico e distribuição", () => {
    expect(painel.base.tasks).toBe(160);
    expect(painel.base.sem_estimativa).toBe(0);
    const ac = painel.cfd.acumulado;
    for (const k of ["backlog", "pronto", "em_andamento", "concluida", "validada"] as const) expect(ac.every((p, i) => i === 0 || p[k] >= (ac[i - 1] as typeof p)[k]), k).toBe(true);
    expect(painel.distribuicao.sem_classificacao).toBe(0);
    expect(painel.distribuicao.risco["alto"]).toBe(40); // T4 de cada sprint
  });
});
