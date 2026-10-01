import type { Banco } from "../banco";
import { criarRepoConfig } from "./config";
import { criarRepoConta } from "./conta";
import { criarRepoContaOpenRouter } from "./conta-openrouter";
import { criarRepoContaRoteamento } from "./conta-roteamento";
import { criarRepoDecisao } from "./decisao";
import { criarRepoHandoff } from "./handoff";
import { criarRepoHarnessWorkspace } from "./harness-workspace";
import { criarRepoLimiteAmostra } from "./limite-amostra";
import { criarRepoLimiteManual } from "./limite-manual";
import { criarRepoOpenRouterModelo } from "./openrouter-modelo";
import { criarRepoPaneRota } from "./pane-rota";
import { criarRepoPolitica } from "./politica";
import { criarRepoTaskType } from "./task-type";
import { criarRepoTrocaLog } from "./troca-log";
import { criarRepoInvocacaoAgente } from "./invocacao-agente";
import { criarRepoMission } from "./mission";
import { criarRepoMissionSquad } from "./mission-squad";
import { criarRepoSquadExecucao } from "./squad-execucao";
import { criarRepoPane } from "./pane";
import { criarRepoTask } from "./task";
import { criarRepoWorkspace } from "./workspace";

export * from "./config";
export * from "./conta";
export * from "./conta-openrouter";
export * from "./conta-roteamento";
export * from "./decisao";
export * from "./handoff";
export * from "./harness-workspace";
export * from "./limite-amostra";
export * from "./limite-manual";
export * from "./openrouter-modelo";
export * from "./pane-rota";
export * from "./politica";
export * from "./task-type";
export * from "./troca-log";
export * from "./invocacao-agente";
export * from "./mission";
export * from "./mission-squad";
export * from "./squad-execucao";
export * from "./pane";
export * from "./task";
export * from "./workspace";

/** Todos os repositórios sobre o mesmo banco. */
export function criarRepositorios(banco: Banco) {
  return {
    workspace: criarRepoWorkspace(banco),
    mission: criarRepoMission(banco),
    pane: criarRepoPane(banco),
    task: criarRepoTask(banco),
    handoff: criarRepoHandoff(banco),
    conta: criarRepoConta(banco),
    config: criarRepoConfig(banco),
    // Fase 9 (harness, limites, trocas, decisões, OpenRouter)
    taskType: criarRepoTaskType(banco),
    politica: criarRepoPolitica(banco),
    harnessWorkspace: criarRepoHarnessWorkspace(banco),
    contaRoteamento: criarRepoContaRoteamento(banco),
    paneRota: criarRepoPaneRota(banco),
    trocaLog: criarRepoTrocaLog(banco),
    decisao: criarRepoDecisao(banco),
    limiteManual: criarRepoLimiteManual(banco),
    limiteAmostra: criarRepoLimiteAmostra(banco),
    contaOpenrouter: criarRepoContaOpenRouter(banco),
    openrouterModelo: criarRepoOpenRouterModelo(banco),
    // Fase 14 (squads e agentes; as squads em si são arquivos)
    missionSquad: criarRepoMissionSquad(banco),
    invocacaoAgente: criarRepoInvocacaoAgente(banco),
    squadExecucao: criarRepoSquadExecucao(banco),
  };
}
export type Repositorios = ReturnType<typeof criarRepositorios>;
