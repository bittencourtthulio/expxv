// Construtores da troca por consumo (Fase 9, onda 4-C): Panes, mundo e execução. Só dados puros.
import type { ConfigHarness, Faixa } from "../../../src/compartilhado/harness";
import type { EstadoDoMundo, EntradaAvaliacao, PaneParaTroca } from "../../../src/nucleo/harness/troca";
import { AGORA, PADRAO, type ExtraConta } from "./construtores";
import { config, mundo as mundoDeContas, WS } from "./rotas";

export { AGORA, PADRAO, WS };

/** Pane de Claude/opus (faixa topo) na conta `c1`, `pronto`, sem nenhuma troca anterior. */
export function paneT(sobre: Partial<PaneParaTroca> = {}): PaneParaTroca {
  return {
    pane_id: "p1",
    workspace_id: WS,
    mission_id: null,
    task_ref: null,
    papel: "executor",
    task_type: "implementar",
    provedor: "claude",
    conta_id: "c1",
    modelo: "opus",
    faixa: "topo" as Faixa,
    estado: "pronto",
    limite_detectado: false,
    saltos: 0,
    ultima_troca_em: null,
    ignorar_sugestao_ate: null,
    ...sobre,
  };
}

export type SpecConta = [string, string, ExtraConta?];
/** Contas + usos + estado do mundo (por padrão: claude/codex/gemini viáveis, nenhum bloqueio). */
export function mundoT(spec: SpecConta[], sobre: Partial<EstadoDoMundo> = {}): { usos: ReturnType<typeof mundoDeContas>["usos"]; mundo: EstadoDoMundo } {
  const { contas, usos } = mundoDeContas(spec);
  return {
    usos,
    mundo: { contas, equivalencia: PADRAO, provedoresViaveis: ["claude", "codex", "gemini"], permissaoWorkspace: "seguro", ...sobre },
  };
}

export function entradaT(spec: SpecConta[], panes: PaneParaTroca[], cfg: Partial<ConfigHarness> = {}, sobre: Partial<EstadoDoMundo> = {}): EntradaAvaliacao {
  const { usos, mundo } = mundoT(spec, sobre);
  return { panes, usos, config: config(cfg), mundo };
}

/** Janela de 5 h reiniciando em 3 h. */
export const quente = (pct: number, h = 3): ExtraConta => ({ w: [["five_hour", pct, h]] });
export const AGORA_T = AGORA;
