/**
 * Catálogo das tools do MVP e matriz de exposição por modo/papel (05-CONTRATOS §3).
 * Nomes e campos são contrato externo (inglês snake_case).
 */
import type { ModoMissao, Papel } from "../dominio";

export const TOOLS_MVP = [
  "provider_list",
  "model_list",
  "pane_spawn",
  "pane_list",
  "pane_read",
  "pane_send",
  "pane_close",
  "handoff_submit",
  "mission_list",
  "mission_complete",
  "catalog_list",
] as const;
export type NomeTool = (typeof TOOLS_MVP)[number];

const LIVRE: readonly NomeTool[] = ["provider_list", "model_list", "pane_spawn", "pane_list", "pane_read", "pane_send", "pane_close", "handoff_submit"];
const SQUAD: readonly NomeTool[] = [...LIVRE, "mission_complete"];
const AGENTICO: readonly NomeTool[] = [...TOOLS_MVP];

const MATRIZ: Readonly<Record<ModoMissao, readonly NomeTool[]>> = { livre: LIVRE, squad: SQUAD, agentico: AGENTICO };

/** Workers (executor/explorador/revisor) só entregam: a única tool deles é `handoff_submit`. */
const SO_ENTREGA: readonly NomeTool[] = ["handoff_submit"];
const PAPEIS_WORKER: readonly Papel[] = ["executor", "explorador", "revisor"];

export function ferramentasPermitidas(modo: ModoMissao, papel: Papel): readonly NomeTool[] {
  if (PAPEIS_WORKER.includes(papel)) return SO_ENTREGA;
  return MATRIZ[modo];
}

export function matrizPorModo(modo: ModoMissao): readonly NomeTool[] {
  return MATRIZ[modo];
}

interface DefinicaoTool {
  name: NomeTool;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: boolean };
}

const str = (description: string): Record<string, unknown> => ({ type: "string", description });

/** Schemas anunciados em `tools/list`. `additionalProperties: true`: campos de identidade extras são ignorados, não recusados. */
export const DEFINICOES: Readonly<Record<NomeTool, DefinicaoTool>> = {
  provider_list: {
    name: "provider_list",
    description: "Lista os provedores (CLIs) habilitados e suas contas.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  },
  model_list: {
    name: "model_list",
    description: "Lista os modelos e níveis de esforço de um provedor habilitado.",
    inputSchema: { type: "object", properties: { provider: str("id do provedor") }, required: ["provider"], additionalProperties: true },
  },
  pane_spawn: {
    name: "pane_spawn",
    description: "Abre um Pane visível com um worker. Devolve só { pane_id }.",
    inputSchema: {
      type: "object",
      properties: {
        provider: str("id do provedor habilitado"),
        model: str("modelo"),
        account_id: str("conta"),
        role: { type: "string", enum: ["executor", "scout", "reviewer"], description: "papel do worker" },
        agent_id: str("agente do squad"),
        briefing_path: str("briefing .md do card"),
        cwd: str("subpasta do workspace"),
      },
      required: ["provider"],
      additionalProperties: true,
    },
  },
  pane_list: {
    name: "pane_list",
    description: "Lista os Panes da Missão (sem conteúdo de tela).",
    inputSchema: { type: "object", properties: { mission_id: str("ignorado além da checagem de escopo") }, additionalProperties: true },
  },
  pane_read: {
    name: "pane_read",
    description: "Lê as últimas linhas da tela de um Pane (padrão 200, teto 2000).",
    inputSchema: {
      type: "object",
      properties: { pane_id: str("Pane alvo"), last_n: { type: "integer", minimum: 1, maximum: 2000 }, max_n: { type: "integer", minimum: 1, maximum: 2000 } },
      required: ["pane_id"],
      additionalProperties: true,
    },
  },
  pane_send: {
    name: "pane_send",
    description: "Envia texto a um Pane (Enter por padrão). Textos acima de 20 KB viram arquivo e o caminho é enviado.",
    inputSchema: {
      type: "object",
      properties: { pane_id: str("Pane alvo"), text: str("texto"), submit: { type: "boolean", description: "padrão true" } },
      required: ["pane_id", "text"],
      additionalProperties: true,
    },
  },
  pane_close: {
    name: "pane_close",
    description: "Fecha um Pane de worker.",
    inputSchema: { type: "object", properties: { pane_id: str("Pane alvo") }, required: ["pane_id"], additionalProperties: true },
  },
  handoff_submit: {
    name: "handoff_submit",
    description: "Entrega o trabalho do card: resumo (até 400 caracteres) e relatório gravado em disco.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: str("card"),
        summary: { type: "string", maxLength: 400, description: "resumo, até 400 caracteres" },
        report_path: str("relatório .md, relativo à raiz do workspace"),
        artifacts: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["ok", "partial", "blocked", "failed"] },
      },
      required: ["task_id", "summary", "report_path", "status"],
      additionalProperties: true,
    },
  },
  mission_list: {
    name: "mission_list",
    description: "Lista as Missões do workspace.",
    inputSchema: { type: "object", properties: { status: str("filtro de estado") }, additionalProperties: true },
  },
  mission_complete: {
    name: "mission_complete",
    description: "Conclui a Missão do token; exige handoff ok de um revisor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
  },
  catalog_list: {
    name: "catalog_list",
    description: "Lista itens do catálogo permitidos ao token (por ora vazio).",
    inputSchema: { type: "object", properties: { kind: str("tipo do item"), query: str("busca") }, required: ["kind"], additionalProperties: true },
  },
};
