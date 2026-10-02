import { describe, expect, it } from "vitest";
import { relogioFalso } from "../../../tests/fixtures/alertas/ajudas";
import { montarDadosTarefa } from "./metricas";
import type { PortaAgil, PortaCusto } from "./portas";
import { criarAcumuladorTempo, criarRepoTempoMemoria } from "./tempo";

const MIN = 60_000;
const ref = { workspace_id: "w1", trabalho_id: "tr1", task_id: "T-1" };
const montar = () => {
  const relogio = relogioFalso();
  const repo = criarRepoTempoMemoria();
  return { relogio, repo, tempo: criarAcumuladorTempo({ repo, relogio }) };
};

describe("acumulador de tempo (T-20.07)", () => {
  it("trabalhando 10, aguardando 5, trabalhando 5 => ativo 15 min, aguardando 5 min", () => {
    const { tempo, relogio } = montar();
    tempo.iniciarTask(ref, "p1", "trabalhando");
    relogio.avancar(10 * MIN);
    tempo.transicaoPane("p1", "aguardando");
    relogio.avancar(5 * MIN);
    tempo.transicaoPane("p1", "trabalhando");
    relogio.avancar(5 * MIN);
    const l = tempo.leitura(ref);
    expect(l?.ativo_ms).toBe(15 * MIN);
    expect(l?.aguardando_ms).toBe(5 * MIN);
    expect(l?.decorrido_ms).toBe(20 * MIN);
    const fim = tempo.fecharTask(ref);
    expect(fim?.ativo_ms).toBe(15 * MIN);
    expect(tempo.leitura(ref)).toBeNull();
  });
  it("duas tasks no mesmo Pane não somam o mesmo tempo", () => {
    const { tempo, relogio } = montar();
    const b = { ...ref, task_id: "T-2" };
    tempo.iniciarTask(ref, "p1", "trabalhando");
    relogio.avancar(10 * MIN);
    tempo.iniciarTask(b, "p1", "trabalhando");
    relogio.avancar(10 * MIN);
    expect(tempo.leitura(ref)?.ativo_ms).toBe(10 * MIN);
    expect(tempo.leitura(b)?.ativo_ms).toBe(10 * MIN);
  });
  it("reinício no meio mantém o acumulado e NÃO conta o tempo com o app fechado", () => {
    const { tempo, relogio, repo } = montar();
    tempo.iniciarTask(ref, "p1", "trabalhando");
    relogio.avancar(10 * MIN);
    tempo.transicaoPane("p1", "trabalhando"); // sem mudança
    tempo.transicaoPane("p1", "aguardando");
    tempo.transicaoPane("p1", "trabalhando"); // grava 10 min
    relogio.avancar(60 * MIN); // app fechado
    const novo = criarAcumuladorTempo({ repo, relogio });
    novo.reconstituir(new Set(["p1"]));
    relogio.avancar(5 * MIN);
    expect(novo.leitura(ref)?.ativo_ms).toBe(15 * MIN);
  });
  it("Pane que morreu enquanto o app estava fechado fecha a janela", () => {
    const { tempo, repo, relogio } = montar();
    tempo.iniciarTask(ref, "p1", "trabalhando");
    relogio.avancar(MIN);
    const novo = criarAcumuladorTempo({ repo, relogio });
    novo.reconstituir(new Set());
    expect(novo.leitura(ref)).toBeNull();
    expect(repo.concluidas("w1", 10)).toHaveLength(1);
  });
  it("Pane encerrado fecha a janela da task dele", () => {
    const { tempo, relogio } = montar();
    tempo.iniciarTask(ref, "p1", "trabalhando");
    relogio.avancar(3 * MIN);
    expect(tempo.paneEncerrado("p1")?.ativo_ms).toBe(3 * MIN);
  });
  it("escreve no máximo 1 vez por transição", () => {
    const { relogio } = montar();
    let gravacoes = 0;
    const base = criarRepoTempoMemoria();
    const tempo = criarAcumuladorTempo({ repo: { ...base, gravar: (r) => (gravacoes++, base.gravar(r)) }, relogio });
    tempo.iniciarTask(ref, "p1", "trabalhando");
    const g0 = gravacoes;
    tempo.transicaoPane("p1", "aguardando");
    tempo.transicaoPane("p1", "aguardando");
    expect(gravacoes - g0).toBe(1);
  });
});

describe("montarDadosTarefa", () => {
  const custo = (fonte: "medida" | "sem_fonte"): PortaCusto => ({ tokensDaTask: () => ({ entrada: 1000, saida: 234, cache_escrita: 5, cache_leitura: 6, usd_conhecido: 0.5, fonte }) });
  const agil = (sp: number | null): PortaAgil => ({ pontos: () => sp });
  it("tokens somam entrada+saída; sem fonte => null (nunca zero); SP ausente => null", () => {
    const { tempo, relogio } = montar();
    tempo.iniciarTask(ref, "p1", "trabalhando");
    relogio.avancar(40 * MIN);
    const base = { tempo, historico: () => [], agora: () => relogio.agora() };
    const com = montarDadosTarefa({ ...base, custo: custo("medida"), agil: agil(3) }, ref);
    expect(com.tokens).toBe(1234);
    expect(com.story_points).toBe(3);
    expect(com.tempo_trabalho_ms).toBe(40 * MIN);
    expect(com.estimativa_ms).toBe(60 * MIN);
    const sem = montarDadosTarefa({ ...base, custo: custo("sem_fonte"), agil: agil(null) }, ref);
    expect(sem.tokens).toBeNull();
    expect(sem.tokens_entrada).toBeNull();
    expect(sem.story_points).toBeNull();
    expect(sem.estimativa_ms).toBeNull(); // sem SP e sem histórico: sem base
    const semPortas = montarDadosTarefa(base, ref);
    expect(semPortas.tokens).toBeNull();
  });
  it("task feita à mão (sem Pane): sem medição de trabalho; porta que lança vira 'sem fonte'", () => {
    const { tempo, relogio } = montar();
    tempo.iniciarTask(ref, null);
    relogio.avancar(MIN);
    const d = montarDadosTarefa({ tempo, historico: () => [], agora: () => relogio.agora(), custo: { tokensDaTask: () => { throw new Error("x"); } } }, ref);
    expect(d.tempo_trabalho_ms).toBeNull();
    expect(d.decorrido_ms).toBe(MIN);
    expect(d.tokens).toBeNull();
  });
});
