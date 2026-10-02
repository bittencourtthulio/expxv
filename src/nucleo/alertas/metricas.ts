// Montagem de `DadosTarefa` (T-20.07): tempo + tokens (PortaCusto) + story points (PortaAgil) + estimativa/atraso (atraso.ts).
// Honestidade (D-116): tokens sem fonte => `null` (nunca 0); SP ausente => `null`; sem base => não afirma atraso.
import type { ConfigAlertas, DadosAlerta } from "../../compartilhado/alertas";
import { CONFIG_ALERTAS_PADRAO } from "../../compartilhado/alertas";
import { decidirAtraso, type AmostraConcluida, type EstadoTaskAtraso } from "./atraso";
import type { PortaAgil, PortaCusto, ReferenciaTask } from "./portas";
import type { AcumuladorTempo } from "./tempo";

export interface DepsMetricas {
  tempo: AcumuladorTempo;
  custo?: PortaCusto;
  agil?: PortaAgil;
  historico: (workspace_id: string) => AmostraConcluida[];
  config?: () => ConfigAlertas["atraso"];
  agora: () => number;
}

export interface DadosTarefa extends DadosAlerta {
  tempo_trabalho_ms: number | null;
  decorrido_ms: number | null;
  tokens: number | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  usd_conhecido: number | null;
  story_points: number | null;
  estimativa_ms: number | null;
  limite_ms: number | null;
  atraso_ms: number | null;
}

export const SEM_DADOS: DadosTarefa = { tempo_trabalho_ms: null, decorrido_ms: null, tokens: null, tokens_entrada: null, tokens_saida: null, usd_conhecido: null, story_points: null, estimativa_ms: null, limite_ms: null, atraso_ms: null };

export function montarDadosTarefa(deps: DepsMetricas, ref: ReferenciaTask, estado: EstadoTaskAtraso = "em_andamento"): DadosTarefa {
  const cfg = deps.config?.() ?? CONFIG_ALERTAS_PADRAO.atraso;
  const leitura = deps.tempo.leitura(ref);
  let tokens: number | null = null;
  let entrada: number | null = null;
  let saida: number | null = null;
  let usd: number | null = null;
  try {
    const c = deps.custo?.tokensDaTask(ref);
    if (c !== undefined && c.fonte !== "sem_fonte") {
      entrada = c.entrada;
      saida = c.saida;
      tokens = c.entrada + c.saida;
      usd = c.usd_conhecido;
    }
  } catch {
    /* porta falhou: "sem fonte" */
  }
  let sp: number | null = null;
  try {
    sp = deps.agil?.pontos(ref) ?? null;
  } catch {
    sp = null;
  }
  // sem medição de Pane: não há tempo de trabalho (usa-se o decorrido quando existir)
  const medido = leitura !== null && leitura.pane_id !== null;
  const out: DadosTarefa = {
    ...SEM_DADOS,
    tokens,
    tokens_entrada: entrada,
    tokens_saida: saida,
    usd_conhecido: usd,
    story_points: sp,
    tempo_trabalho_ms: medido ? leitura.ativo_ms : null,
    decorrido_ms: leitura === null ? null : leitura.decorrido_ms,
  };
  if (leitura !== null) {
    const d = decidirAtraso({ task_id: ref.task_id, workspace_id: ref.workspace_id, story_points: sp, ativo_ms: leitura.ativo_ms, estado, alertou_atraso: leitura.alertou_atraso }, deps.historico(ref.workspace_id), cfg, deps.agora());
    out.estimativa_ms = d.estimativa_ms;
    out.limite_ms = d.limite_ms;
    out.atraso_ms = d.atraso_ms;
  }
  return out;
}
