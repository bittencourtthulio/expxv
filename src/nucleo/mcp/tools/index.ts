import type { NomeTool } from "../catalogo";
import type { ImplTool } from "./comum";
import { agentInvoke, agentList } from "./agente";
import { alertRaise } from "./alertas";
import { backlogGet, backlogList, backlogPropose, estimateGet, estimatePropose, metricsGet, reworkList, sprintStatus } from "./agil";
import { accountSwitch } from "./conta";
import { handoffSubmit } from "./handoff";
import { decisionsList, harnessList, harnessRecommend, harnessSet } from "./harness";
import { headlineLimits, headlinePick } from "./limites";
import { memoryBrief, memoryCheckpoint, memoryForget, memorySearch, memoryWrite } from "./memoria";
import { mcpStoreList } from "./mcp-store";
import { maestroRequest, maestroStatus } from "./maestro";
import { missionComplete, missionList } from "./mission";
import { mapEvidence, mapImpact, mapQuery, mapStatus } from "./mapa";
import { ragContext, ragFeedback, ragLearn, ragSearch } from "./rag";
import { handoffRead, paneClose, paneList, paneRead, paneSend, paneSpawn } from "./pane";
import { costReport } from "./cost-report";
import { taskGet, taskList } from "./task";
import { catalogList, modelList, providerList } from "./provider";

export const IMPLEMENTACOES: Readonly<Record<NomeTool, ImplTool>> = {
  provider_list: providerList,
  model_list: modelList,
  pane_spawn: paneSpawn,
  pane_list: paneList,
  pane_read: paneRead,
  pane_send: paneSend,
  pane_close: paneClose,
  handoff_submit: handoffSubmit,
  handoff_read: handoffRead,
  mission_list: missionList,
  mission_complete: missionComplete,
  catalog_list: catalogList,
  harness_list: harnessList,
  harness_recommend: harnessRecommend,
  harness_set: harnessSet,
  decisions_list: decisionsList,
  headline_limits: headlineLimits,
  headline_pick: headlinePick,
  account_switch: accountSwitch,
  agent_list: agentList,
  agent_invoke: agentInvoke,
  memory_write: memoryWrite,
  memory_search: memorySearch,
  memory_checkpoint: memoryCheckpoint,
  memory_brief: memoryBrief,
  memory_forget: memoryForget,
  mcp_store_list: mcpStoreList,
  maestro_request: maestroRequest,
  maestro_status: maestroStatus,
  alert_raise: alertRaise,
  backlog_list: backlogList,
  backlog_get: backlogGet,
  backlog_propose: backlogPropose,
  estimate_get: estimateGet,
  estimate_propose: estimatePropose,
  sprint_status: sprintStatus,
  rework_list: reworkList,
  metrics_get: metricsGet,
  task_list: taskList,
  task_get: taskGet,
  cost_report: costReport,
  rag_search: ragSearch,
  rag_context: ragContext,
  rag_learn: ragLearn,
  rag_feedback: ragFeedback,
  map_status: mapStatus,
  map_query: mapQuery,
  map_impact: mapImpact,
  map_evidence: mapEvidence,
};
