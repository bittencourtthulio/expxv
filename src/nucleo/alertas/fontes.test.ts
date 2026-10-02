import { SK_ANT } from "../../../tests/fixtures/alertas/sentinelas";
import { describe, expect, it } from "vitest";
import { barramentoFalso, idSeq, relogioFalso, timersFalsos } from "../../../tests/fixtures/alertas/ajudas";
import type { AlertaVisao } from "../../compartilhado/alertas";
import { criarAgendadorVencimentos } from "./agendador";
import type { AmostraConcluida } from "./atraso";
import { criarEmissor } from "./emissor";
import { criarFontes, type DadoVencimento, type EventoTask } from "./fontes";
import { criarRepoAlertasMemoria } from "./memoria";
import type { PortaAgil, PortaCusto } from "./portas";
import { criarAcumuladorTempo, criarRepoTempoMemoria } from "./tempo";

const MIN = 60_000;
function montar(o: { sp?: number | null; tokens?: boolean; historico?: AmostraConcluida[]; aguardandoMin?: number } = {}) {
  const relogio = relogioFalso();
  const timers = timersFalsos(relogio);
  const repo = criarRepoAlertasMemoria();
  const barramento = barramentoFalso();
  const emissor = criarEmissor({ repo, barramento, relogio, novoId: idSeq("a"), floodPorMin: 1000 });
  const tempo = criarAcumuladorTempo({ repo: criarRepoTempoMemoria(), relogio });
  const custo: PortaCusto = { tokensDaTask: () => ({ entrada: 700, saida: 300, cache_escrita: 0, cache_leitura: 0, usd_conhecido: null, fonte: o.tokens === false ? "sem_fonte" : "medida" }) };
  const agil: PortaAgil = { pontos: () => (o.sp === undefined ? 3 : o.sp) };
  let fontes!: ReturnType<typeof criarFontes>;
  const agendador = criarAgendadorVencimentos<DadoVencimento>({ aoVencer: (v) => fontes.aoVencer(v.dado), timers, relogio });
  fontes = criarFontes({
    emissor, tempo, agendador, agora: () => relogio.agora(),
    metricas: { custo, agil, historico: () => o.historico ?? Array.from({ length: 5 }, () => ({ workspace_id: "w1", story_points: 3, tempo_trabalho_ms: 55 * MIN })) },
    config: () => ({ ligado: true, retencao_dias: 90, atraso: { fator: 1.5, folga_min: 10, tabela_pontos_min: { "3": 60 }, minimo_amostras: 5 }, pane_aguardando_min: o.aguardandoMin ?? 10, digest: { diario: { ligado: false, hora: "18:00" }, sprint: { ligado: true } } }),
  });
  const tipos = (): string[] => repo.listar({ limite: 100 }).itens.map((a) => a.tipo).reverse();
  const por = (t: string): AlertaVisao[] => repo.listar({ limite: 100 }).itens.filter((a) => a.tipo === t);
  return { relogio, timers, repo, tempo, fontes, agendador, tipos, por };
}
const task = (p: Partial<EventoTask> = {}): EventoTask => ({ workspace_id: "w1", trabalho_id: "tr1", task_id: "T-1", titulo: "Corrigir login", status: "em_andamento", pane_id: "p1", mission_id: "m1", missao: "Login", cli: "claude", ...p });

describe("fontes I (T-20.09)", () => {
  it("iniciada -> concluída: números certos (tempo, tokens, SP) e dedupe de transição repetida", () => {
    const m = montar();
    m.fontes.aoTask(task());
    m.fontes.aoTask(task()); // transição repetida
    expect(m.por("tarefa_iniciada")).toHaveLength(1);
    expect(m.por("tarefa_iniciada")[0]?.contagem).toBe(2);
    m.relogio.avancar(40 * MIN);
    m.fontes.aoTask(task({ status: "concluida" }));
    const c = m.por("tarefa_concluida")[0] as AlertaVisao;
    expect(c.dados).toMatchObject({ task_id: "T-1", tempo_trabalho_ms: 40 * MIN, tokens: 1000, story_points: 3, estimativa_ms: 55 * MIN, missao: "Login" });
    expect(c.entidade_id).toBe("T-1");
  });
  it("tokens sem fonte => null no alerta (nunca 0)", () => {
    const m = montar({ tokens: false, sp: null });
    m.fontes.aoTask(task());
    m.fontes.aoTask(task({ status: "concluida" }));
    expect(m.por("tarefa_concluida")[0]?.dados.tokens).toBeNull();
    expect(m.por("tarefa_concluida")[0]?.dados.story_points).toBeNull();
  });
  it("bloqueada carrega o motivo redigido", () => {
    const m = montar();
    m.fontes.aoTask(task());
    m.fontes.aoTask(task({ status: "bloqueada", motivo: "falta credencial " + SK_ANT }));
    expect(m.por("tarefa_bloqueada")[0]?.dados.motivo).not.toMatch(/sk-ant/);
  });
  it("atraso: 90 min de trabalho ativo => 1 alerta; 3 h => crítico; máximo 2; um único timer", () => {
    const m = montar();
    m.fontes.aoTask(task());
    expect(m.agendador.timersVivos()).toBe(1);
    m.timers.avancarAte(m.relogio.agora() + 83 * MIN);
    expect(m.por("tarefa_atrasada")).toHaveLength(1);
    expect(m.por("tarefa_atrasada")[0]?.severidade).toBe("aviso");
    expect(m.por("tarefa_atrasada")[0]?.dados).toMatchObject({ limite_ms: 82.5 * MIN, motivo: "esforco" });
    m.timers.avancarAte(m.relogio.agora() + 4 * 60 * MIN);
    const todas = m.por("tarefa_atrasada");
    expect(todas).toHaveLength(2);
    expect(todas.some((a) => a.severidade === "critico")).toBe(true);
    m.timers.avancarAte(m.relogio.agora() + 24 * 60 * MIN);
    expect(m.por("tarefa_atrasada")).toHaveLength(2);
    expect(m.agendador.timersVivos()).toBe(0);
  });
  it("Pane aguardando não conta como atraso: o relógio da task só anda com o Pane trabalhando", () => {
    const m = montar();
    m.fontes.aoTask(task());
    m.relogio.avancar(30 * MIN);
    m.fontes.aoPane({ pane_id: "p1", estado: "aguardando" });
    m.timers.avancarAte(m.relogio.agora() + 5 * 60 * MIN);
    m.relogio.avancar(300 * MIN); // esperando você por 5 h
    m.fontes.aoPane({ pane_id: "p1", estado: "trabalhando" });
    expect(m.por("tarefa_atrasada")).toHaveLength(0);
    expect(m.tempo.leitura({ workspace_id: "w1", trabalho_id: "tr1", task_id: "T-1" })?.ativo_ms).toBe(30 * MIN);
    m.timers.avancarAte(m.relogio.agora() + 60 * MIN); // 30 + 60 = 90 > 82,5
    expect(m.por("tarefa_atrasada")).toHaveLength(1);
  });
  it("sem base de estimativa nunca é atrasada", () => {
    const m = montar({ sp: null, historico: [] });
    m.fontes.aoTask(task());
    expect(m.agendador.timersVivos()).toBe(0);
    m.timers.avancarAte(m.relogio.agora() + 2000 * MIN);
    expect(m.por("tarefa_atrasada")).toHaveLength(0);
  });
  it("prazo da sprint vencido => atrasada por prazo", () => {
    const m = montar({ sp: null, historico: [] });
    m.fontes.aoTask(task({ prazo_sprint: new Date(m.relogio.agora() + 10 * MIN).toISOString() }));
    m.timers.avancarAte(m.relogio.agora() + 11 * MIN);
    expect(m.por("tarefa_atrasada")[0]?.dados.motivo).toBe("prazo");
  });
  it("pane_aguardando só após o limiar e cancelado se o Pane volta a trabalhar antes", () => {
    const m = montar();
    m.fontes.aoTask(task());
    m.fontes.aoPane({ pane_id: "p1", estado: "aguardando", cli: "claude", mission_id: "m1", missao: "Login", workspace_id: "w1" });
    m.timers.avancarAte(m.relogio.agora() + 9 * MIN);
    expect(m.por("pane_aguardando")).toHaveLength(0);
    m.fontes.aoPane({ pane_id: "p1", estado: "trabalhando" });
    m.timers.avancarAte(m.relogio.agora() + 30 * MIN);
    expect(m.por("pane_aguardando")).toHaveLength(0);
    m.fontes.aoPane({ pane_id: "p1", estado: "aguardando", cli: "claude", pergunta: "posso apagar?" });
    m.timers.avancarAte(m.relogio.agora() + 11 * MIN);
    const a = m.por("pane_aguardando")[0] as AlertaVisao;
    expect(a).toBeDefined();
    expect(a.dados.espera_ms).toBe(10 * MIN);
  });
  it("limiar 0 => imediato", () => {
    const m = montar({ aguardandoMin: 0 });
    m.fontes.aoPane({ pane_id: "p9", estado: "aguardando", cli: "codex" });
    expect(m.por("pane_aguardando")).toHaveLength(1);
  });
  it("Missão: tasks feitas/total, tempo de trabalho TOTAL, tokens e SP entregues; falhou é crítico", () => {
    const m = montar();
    for (const [i, min] of [[1, 20], [2, 30]] as const) {
      m.fontes.aoTask(task({ task_id: `T-${i}`, pane_id: `p${i}` }));
      m.relogio.avancar(min * MIN);
      m.fontes.aoTask(task({ task_id: `T-${i}`, pane_id: `p${i}`, status: "concluida" }));
    }
    m.fontes.aoMissaoFechada({ workspace_id: "w1", mission_id: "m1", titulo: "Login", resultado: "concluida", tarefas_total: 3 });
    const a = m.por("missao_concluida")[0] as AlertaVisao;
    expect(a.dados).toMatchObject({ tarefas_feitas: 2, tarefas_total: 3, tempo_trabalho_ms: 50 * MIN, tokens: 2000, story_points: 6 });
    m.fontes.aoMissaoFechada({ workspace_id: "w1", mission_id: "m2", titulo: "Outra", resultado: "falhou", tarefas_total: 1, motivo: "erro" });
    expect(m.por("missao_falhou")[0]?.severidade).toBe("critico");
    expect(m.por("missao_falhou")[0]?.dados.tokens).toBeNull();
  });
  it("QA aprovado/reprovado e erro do sistema (1 por componente/hora, sem stack)", () => {
    const m = montar();
    m.fontes.aoQa({ workspace_id: "w1", trabalho_id: "tr1", task_id: "T-1", veredito: "reprovado", achados: 3, rodada: 1 });
    m.fontes.aoQa({ workspace_id: "w1", trabalho_id: "tr1", task_id: "T-1", veredito: "aprovado", achados: 0, rodada: 2 });
    expect(m.por("qa_reprovado")[0]?.dados).toMatchObject({ achados: 3, rodada: 1 });
    expect(m.por("qa_aprovado")).toHaveLength(1);
    m.fontes.aoErroSistema("daemon", "falha_isolada");
    m.fontes.aoErroSistema("daemon", "falha_isolada");
    expect(m.por("erro_sistema")).toHaveLength(1);
    m.relogio.avancar(3_700_000);
    m.fontes.aoErroSistema("daemon", "falha_isolada");
    expect(m.por("erro_sistema")).toHaveLength(2);
  });
});
