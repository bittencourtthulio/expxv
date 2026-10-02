/**
 * Tipos e validadores comuns das tools. Cada tool valida a entrada campo a campo e devolve erros do
 * contrato; identidade (`mission_id`, `pane_id` do chamador, `role`) vem SEMPRE do token.
 */
import type { EstadoMissao, EstadoPane, ModoMissao, Papel, StatusHandoff } from "../../dominio";
import { argumentoInvalido } from "../erros";
import type { ClaimsToken } from "../tokens";
import type { PortaAlertasMcp, PortaAgilMcp, PortaCatalogo, PortaCustoMcp, PortaGateway, PortaHandoff, PortaHarness, PortaLimites, PortaLoja, PortaMaestroMcp, PortaMapaMcp, PortaMemoria, PortaMissoes, PortaPanes, PortaProvedores, PortaRag, PortaRelogio, PortaRota, PortaSquads, PortaTroca } from "../portas";

export interface DepsTools {
  panes: PortaPanes;
  missoes: PortaMissoes;
  provedores: PortaProvedores;
  handoff: PortaHandoff;
  relogio: PortaRelogio;
  /** Raiz onde o Pane trabalha (worktree da Missão ou raiz do workspace). Só o app conhece o caminho absoluto. */
  raiz(workspace_id: string, mission_id: string | null): Promise<string>;
  /** `max_parallel_panes` (padrão 8): teto de workers vivos por Missão. */
  maxPanesParalelos: number;
  /** Avisos de política (não bloqueiam): ex. revisor do mesmo provedor do executor. */
  avisar(mensagem: string): void;
  /** Fase 9: política, recomendação e decisões. Ausente = as tools `harness_*` respondem `unavailable`. */
  harness?: PortaHarness;
  /** Fase 9: cota por conta e escolha de conta (`headline_*`). */
  limites?: PortaLimites;
  /** Fase 9 (T-09.16): rota do `pane_spawn` sem provedor. Ausente = o provedor é obrigatório (como no MVP). */
  rota?: PortaRota;
  /** Fase 9 (T-09.20): `account_switch`. Ausente = a tool responde `unavailable`. */
  troca?: PortaTroca;
  /** Fase 14 (T-14.13): `agent_list` e `agent_invoke`. Ausente = as tools respondem `unavailable`. */
  squads?: PortaSquads;
  /** Fase 8: `memory_*` e o aviso `no_learning_recorded` do `mission_complete`. Ausente = as tools respondem `unavailable` e o aviso não existe. */
  memoria?: PortaMemoria;
  /** Fase 16: `maestro_request` e `maestro_status`. Ausente = as tools respondem `unavailable`. */
  maestro?: PortaMaestroMcp;
  /** Fase 18: `backlog_*`, `estimate_*`, `sprint_status`, `rework_list`, `metrics_get`. Ausente = as tools respondem `unavailable`. */
  agil?: PortaAgilMcp;
  /** Fase 10: `task_list`, `task_get`, `cost_report` (somente leitura). Ausente = as tools respondem `unavailable`. */
  custo?: PortaCustoMcp;
  /** Fase 20: `alert_raise`. Ausente = a tool responde `unavailable`. */
  alertas?: PortaAlertasMcp;
  /** Fase 15: `rag_*`. Ausente = as tools respondem `unavailable`. */
  rag?: PortaRag;
  /** Fase 17: `map_*` (somente leitura). Ausente = as tools respondem `unavailable/map_not_ready`. */
  mapa?: PortaMapaMcp;
  /** Fase 7: `catalog_list` real e validação de `pane_spawn.skills`. Ausente = `catalog_list` devolve vazio e `skills` do `pane_spawn` é recusado. */
  catalogo?: PortaCatalogo;
  /** Fase 7B: rota `POST /loja/segredos` do lançador `mcp-run`. Ausente = a rota responde 404. */
  loja?: PortaLoja;
  /** Fase 7C: rota `POST /gateway`. Ausente = a rota responde 404. */
  gateway?: PortaGateway;
}

export interface ContextoTool {
  claims: ClaimsToken;
  deps: DepsTools;
}

export type ImplTool = (args: Record<string, unknown>, ctx: ContextoTool) => Promise<unknown>;

export function comoObjeto(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) throw argumentoInvalido("Os argumentos devem ser um objeto.");
  return args as Record<string, unknown>;
}

const TEM_CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

export function texto(args: Record<string, unknown>, campo: string, opcoes: { max?: number; vazio?: boolean } = {}): string {
  const v = args[campo];
  if (typeof v !== "string") throw argumentoInvalido(`O campo "${campo}" é obrigatório e deve ser texto.`);
  if (!opcoes.vazio && v.trim() === "") throw argumentoInvalido(`O campo "${campo}" não pode ser vazio.`);
  if (opcoes.max !== undefined && [...v].length > opcoes.max) throw argumentoInvalido(`O campo "${campo}" excede ${opcoes.max} caracteres.`);
  return v;
}

export function textoOpcional(args: Record<string, unknown>, campo: string, max = 500): string | null {
  const v = args[campo];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw argumentoInvalido(`O campo "${campo}" deve ser texto.`);
  if (v.trim() === "") throw argumentoInvalido(`O campo "${campo}" não pode ser vazio.`);
  if ([...v].length > max) throw argumentoInvalido(`O campo "${campo}" excede ${max} caracteres.`);
  return v;
}

/** Identificador curto: sem caracteres de controle. */
export function identificador(args: Record<string, unknown>, campo: string): string {
  const v = texto(args, campo, { max: 200 });
  if (TEM_CONTROLE.test(v)) throw argumentoInvalido(`O campo "${campo}" tem caracteres inválidos.`);
  return v;
}

export function identificadorOpcional(args: Record<string, unknown>, campo: string): string | null {
  const v = textoOpcional(args, campo, 200);
  if (v !== null && TEM_CONTROLE.test(v)) throw argumentoInvalido(`O campo "${campo}" tem caracteres inválidos.`);
  return v;
}

export function inteiroOpcional(args: Record<string, unknown>, campo: string, min: number, max: number): number | null {
  const v = args[campo];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v)) throw argumentoInvalido(`O campo "${campo}" deve ser um inteiro.`);
  if (v < min || v > max) throw argumentoInvalido(`O campo "${campo}" deve estar entre ${min} e ${max}.`);
  return v;
}

export function booleanoOpcional(args: Record<string, unknown>, campo: string, padrao: boolean): boolean {
  const v = args[campo];
  if (v === undefined || v === null) return padrao;
  if (typeof v !== "boolean") throw argumentoInvalido(`O campo "${campo}" deve ser booleano.`);
  return v;
}

export function listaDeTextos(args: Record<string, unknown>, campo: string, maxItens = 50): string[] {
  const v = args[campo];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > maxItens || v.some((x) => typeof x !== "string" || x === "" || x.length > 500)) {
    throw argumentoInvalido(`O campo "${campo}" deve ser uma lista de até ${maxItens} textos.`);
  }
  return v as string[];
}

// Tradução domínio (PT) <-> contrato externo (EN).
export const ESTADO_PANE_EXTERNO: Readonly<Record<EstadoPane, string>> = {
  iniciando: "spawning",
  pronto: "idle",
  trabalhando: "working",
  aguardando: "awaiting_user",
  bloqueado: "blocked",
  encerrado: "closed",
};

export const PAPEL_EXTERNO: Readonly<Record<Papel, string>> = {
  piloto: "orchestrator",
  executor: "executor",
  explorador: "scout",
  revisor: "reviewer",
  nenhum: "none",
};

/** Papéis que o chamador pode pedir. `orchestrator` é aceito na validação para que a regra o recuse com `forbidden_role`. */
export const PAPEL_INTERNO: Readonly<Record<string, Papel>> = {
  executor: "executor",
  scout: "explorador",
  reviewer: "revisor",
  orchestrator: "piloto",
};

export const STATUS_HANDOFF_INTERNO: Readonly<Record<string, StatusHandoff>> = {
  ok: "ok",
  partial: "parcial",
  blocked: "bloqueado",
  failed: "falhou",
};

export const ESTADO_MISSAO_EXTERNO: Readonly<Record<EstadoMissao, string>> = {
  intake: "intake",
  planejando: "planning",
  executando: "running",
  revisando: "reviewing",
  concluida: "done",
  falhou: "failed",
  abortada: "aborted",
};

export const ESTADO_MISSAO_INTERNO: Readonly<Record<string, EstadoMissao>> = Object.fromEntries(
  Object.entries(ESTADO_MISSAO_EXTERNO).map(([pt, en]) => [en, pt as EstadoMissao]),
);

export const MODO_EXTERNO: Readonly<Record<ModoMissao, string>> = { livre: "free", squad: "squad", agentico: "agentic" };
