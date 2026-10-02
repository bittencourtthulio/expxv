// T-18.31: saúde da sprint. SEM NOTA ÚNICA: lista de indicadores (verde/amarelo/vermelho + frase + o fato que a sustenta). Entrada desconhecida (null) => indicador omitido.
import type { IndicadorSaude, LimiaresSaude, SerieBurn } from "../../../compartilhado/agil";

export interface EntradaSaude {
  burn: SerieBurn | null;
  hoje: string;
  escopo_adicionado_pct: number | null;
  wip_atual: number | null;
  wip_limite: number | null;
  bloqueios_abertos: number | null;
  sem_estimativa: number | null;
  ftr_sprint: number | null;
  ftr_media_movel: number | null;
  atrasadas: number | null;
  qa_reprovado_pendente: number | null;
  compromisso: number | null;
  capacidade: number | null;
  risco_critico: number | null;
  limiares: LimiaresSaude;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function indicadoresSaude(e: EntradaSaude): IndicadorSaude[] {
  const out: IndicadorSaude[] = [];
  const L = e.limiares;
  const add = (id: string, cor: IndicadorSaude["cor"], frase: string, fato: string): void => { out.push({ id, cor, frase, fato }); };
  if (e.burn && e.burn.compromisso_inicial > 0) {
    const p = e.burn.dias.find((d) => d.dia === e.hoje) ?? [...e.burn.dias].reverse().find((d) => d.restante !== null);
    if (p && p.restante !== null) {
      const atraso = (p.restante - p.ideal) / e.burn.compromisso_inicial;
      const cor = atraso > L.progresso_vermelho ? "vermelho" : atraso > L.progresso_amarelo ? "amarelo" : "verde";
      add("progresso", cor, cor === "verde" ? "Progresso dentro do ideal" : `Progresso ${pct(Math.max(0, atraso))} atrás do ideal`, `restante ${p.restante} vs ideal ${p.ideal} (compromisso ${e.burn.compromisso_inicial})`);
    }
  }
  if (e.escopo_adicionado_pct !== null) add("escopo", e.escopo_adicionado_pct > L.escopo_adicionado ? "amarelo" : "verde", e.escopo_adicionado_pct > L.escopo_adicionado ? `Escopo cresceu ${pct(e.escopo_adicionado_pct)}` : "Escopo estável", `escopo adicionado ${pct(e.escopo_adicionado_pct)} do compromisso`);
  if (e.wip_atual !== null && e.wip_limite !== null) add("wip", e.wip_atual > e.wip_limite ? "vermelho" : "verde", e.wip_atual > e.wip_limite ? "WIP acima do limite" : "WIP dentro do limite", `${e.wip_atual} em andamento, limite ${e.wip_limite}`);
  if (e.bloqueios_abertos !== null) add("bloqueios", e.bloqueios_abertos > 0 ? "amarelo" : "verde", e.bloqueios_abertos > 0 ? `${e.bloqueios_abertos} bloqueio(s) aberto(s)` : "Sem bloqueios abertos", `${e.bloqueios_abertos} bloqueios abertos`);
  if (e.sem_estimativa !== null) add("sem_estimativa", e.sem_estimativa > 0 ? "amarelo" : "verde", e.sem_estimativa > 0 ? `${e.sem_estimativa} item(ns) sem estimativa` : "Tudo estimado", `${e.sem_estimativa} sem estimativa`);
  if (e.ftr_sprint !== null && e.ftr_media_movel !== null) {
    const queda = e.ftr_media_movel - e.ftr_sprint;
    add("ftr", queda > L.ftr_queda_pontos ? "amarelo" : "verde", queda > L.ftr_queda_pontos ? "Feito de primeira abaixo da média" : "Feito de primeira na média", `FTR ${pct(e.ftr_sprint)} vs média móvel ${pct(e.ftr_media_movel)}`);
  }
  if (e.atrasadas !== null) add("atrasadas", e.atrasadas > 0 ? "amarelo" : "verde", e.atrasadas > 0 ? `${e.atrasadas} tarefa(s) atrasada(s)` : "Nenhuma tarefa atrasada", `${e.atrasadas} acima do P85 do ciclo`);
  if (e.qa_reprovado_pendente !== null) add("qa", e.qa_reprovado_pendente > 0 ? "vermelho" : "verde", e.qa_reprovado_pendente > 0 ? `${e.qa_reprovado_pendente} reprovação(ões) de QA pendente(s)` : "Sem reprovação de QA pendente", `${e.qa_reprovado_pendente} reprovações pendentes`);
  if (e.compromisso !== null && e.capacidade !== null && e.capacidade > 0) {
    const r = e.compromisso / e.capacidade;
    add("capacidade", r > L.compromisso_vs_capacidade ? "amarelo" : "verde", r > L.compromisso_vs_capacidade ? `Compromisso em ${pct(r)} da capacidade` : "Compromisso dentro da capacidade", `compromisso ${e.compromisso} vs capacidade ${e.capacidade}`);
  }
  if (e.risco_critico !== null) add("risco", e.risco_critico > L.risco_critico_max ? "amarelo" : "verde", e.risco_critico > L.risco_critico_max ? `${e.risco_critico} itens de risco crítico` : "Risco crítico sob controle", `${e.risco_critico} itens críticos (máx ${L.risco_critico_max})`);
  return out;
}

/** "em risco" = indicador de progresso vermelho por >= 1 dia útil seguido (o chamador passa a série de cores dos últimos dias úteis). */
export const sprintEmRisco = (coresProgressoPorDiaUtil: readonly string[], seguidos = 1): boolean => {
  let n = 0;
  for (let i = coresProgressoPorDiaUtil.length - 1; i >= 0 && coresProgressoPorDiaUtil[i] === "vermelho"; i--) n++;
  return n >= seguidos;
};
