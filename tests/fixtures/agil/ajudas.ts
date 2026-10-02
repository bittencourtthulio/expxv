// Construtores mínimos para os testes unitários do núcleo ágil (sem passar pela fixture grande).
import type { FatoTask, ItemAgil } from "../../../src/compartilhado/agil";
import type { ItemMetrica } from "../../../src/nucleo/agil/metricas/dados";
import { criarAgil } from "../../../src/nucleo/agil/agil";
import { configPadrao } from "../../../src/nucleo/agil/config/padroes";
import { criarBancoMemoria } from "../../../src/nucleo/agil/memoria";
import { criarGeradorId } from "../../../src/nucleo/agil/util";

export const T0 = Date.parse("2026-03-10T12:00:00.000Z");
export function relogioMutavel(inicio = T0): { agora: number; fn: () => number } {
  const r = { agora: inicio, fn: () => r.agora };
  return r;
}
export function novoAgil(inicio = T0): ReturnType<typeof criarAgil> & { rel: { agora: number } } {
  const rel = relogioMutavel(inicio);
  return Object.assign(criarAgil({ relogio: rel.fn }), { rel });
}
export const novoBanco = criarBancoMemoria;
export const gerarId = (rel: () => number = () => T0) => criarGeradorId(rel);
export const cfg = configPadrao;

export function fato(o: Partial<FatoTask> = {}): FatoTask {
  return {
    workspace_id: "ws1", trabalho_id: "tr1", task_ref: "T-01.01", titulo: "Task", fase: "F-01.1", depende_de: [], criterio_aceite: "ok", tipo_task: null, status_visto: "pendente",
    iniciada_em: null, concluida_em: null, concluida_ts_precisa: false, duracao_obs_ms: null, bloqueada_ms: null, reaberturas: 0, reabertas_em: [], retrabalho_ms: null, qa_reprovacoes: 0,
    suite_final: null, agente: null, membro_id: null, arquivos: [], tdd_primeiro: null, vermelho_antes: null, commits: [], validada_em: null, tem_rastro: false, intervalos: [],
    primeiro_evento_em: null, declarados: { integracao: true, funcional: true, regressao: false }, versao_origem: "v", atualizado_em: "2026-03-10T12:00:00.000Z", ...o,
  };
}

export function itemM(o: Partial<ItemMetrica> = {}): ItemMetrica {
  const ref = o.ref ?? `tr1/${o.task_ref ?? "T-01.01"}`;
  return {
    item_id: ref, ref, origem: "metodo", titulo: "Item", trabalho_id: "tr1", task_ref: "T-01.01", pontos: 3, estimativa_origem: "humano", categoria: "feature", risco: "baixo", criticidade: "media",
    tipo_task: null, valor: null, urgencia: null, reducao_risco: null, criado_em: "2026-03-01T00:00:00.000Z", iniciada_em: null, concluida_em: null, concluida_precisa: true, validada_em: null,
    pronto_em: null, primeiro_evento_em: null, duracao_obs_ms: null, retrabalho_ms: null, membro_id: null, agente: null, squad_id: null, situacao: null, eventos_pendentes: 0, estado_fluxo: "backlog",
    tem_rastro: false, orfao: false, descartado: false, depende_de: [], intervalos: [], bloqueada_ms: null, qa_reprovacoes: 0, participacoes: [], ...o,
  };
}

export function itemAgil(o: Partial<ItemAgil> = {}): ItemAgil {
  return {
    id: "it1", workspace_id: "ws1", origem: "ade", trabalho_id: null, task_ref: null, epico_id: null, titulo: "Item", descricao: null, criterios: ["ok"], estado_ade: "backlog", valor: null, urgencia: null,
    reducao_risco: null, moscow: null, ordem: 1024, dono_membro_id: null, par_membro_id: null, visibilidade_cliente: "auto", resumo_cliente: null, resumo_cliente_origem: null, changelog_tipo: null,
    origem_ref: null, descartado_motivo: null, orfao: false, criado_em: "2026-03-01T00:00:00.000Z", atualizado_em: "2026-03-01T00:00:00.000Z", ...o,
  };
}
