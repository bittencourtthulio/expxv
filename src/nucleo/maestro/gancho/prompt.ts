// T-16.28 · Decisão do hook `UserPromptSubmit` do Maestro (PURO: o serviço entra por porta). Roda no main (rota `/hooks/maestro-prompt` do loopback).
// Regras: só painel LIVRE (o settings só existe nele), nunca Pane de etapa nem Missão do Maestro; ignora slash command, `@direto`, marcador `[maestro]`, eco do ADE e intenções
// que não abrem pipeline (dúvida/histórico/controle…); só confiança ALTA (>= hook_confianca_min); o decisor externo NÃO é consultado (usar_no_hook=false
// é imposto pelo serviço: `via:"hook"`). Falha aberta: qualquer erro ⇒ o prompt segue. Modo `notificar` grava o plano (banner na UI) e NÃO bloqueia.
import { INTENCOES_ACIONAVEIS, type ContextoPedido, type PedidoMaestro, type PlanoMaestro, type ResultadoClassificacao } from "../../../compartilhado/maestro";
import type { ConfigMaestro } from "../config";
import { ehDireto, ehMarcadorDoMaestro, ehSlashCommand } from "../guardas";
import { LIMITE_ALTA } from "../intencao/classificar";

export interface ContextoDoGancho {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
}
/** Saída do gancho (a mesma forma de `RespostaGancho` do MCP). */
export interface SaidaDoGancho {
  saida: Record<string, unknown> | null;
}
export interface PortaDoGanchoMaestro {
  classificar(texto: string, ctx: { workspace_id: string; contexto: ContextoPedido | null }): Promise<ResultadoClassificacao>;
  pedir(p: PedidoMaestro): Promise<{ plano: PlanoMaestro }>;
  ehPaneDoMaestro(pane_id: string): boolean;
  /** a Missão foi criada pelo Maestro (pipeline)? Ausente = nenhuma é. */
  missaoDoMaestro?(mission_id: string): boolean;
  config(workspace_id: string): ConfigMaestro | Promise<ConfigMaestro>;
  evento?(e: { tipo: string; pipeline_id: string | null; detalhe?: string }): void;
  /** D-662: o dono digitou `/expx:<skill>` num painel livre: o painel de progresso a acompanha. Nunca altera a decisão (o prompt segue). */
  skillDetectada?(e: { workspace_id: string; pane_id: string; skill: string }): void;
}

export const TEXTO_HOOK_MAX = 4000;
const vazio: SaidaDoGancho = { saida: null };

export const razaoDoBloqueio = (intencao: string, confianca: number, pipeline: string): string =>
  `Maestro: encaminhado como ${intencao} (confiança ${confianca.toFixed(2).replace(".", ",")}) → ${pipeline}. Confirme o plano na barra do painel. Para tratar neste painel, reenvie com @direto.`;

/** Extrai o texto do prompt do payload do hook (`{prompt: string}`); qualquer outra forma = sem texto. */
export function promptDoPayload(corpo: unknown): string | null {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return null;
  const p = (corpo as Record<string, unknown>)["prompt"];
  if (typeof p !== "string") return null;
  const t = p.trim();
  return t === "" || t.length > TEXTO_HOOK_MAX ? null : t;
}

/** `/expx:runx-causa algo` -> `runx-causa`; qualquer outro slash command (ou nome fora do padrão) -> `null`. */
export function skillDoSlash(texto: string): string | null {
  const m = /^\/expx:([a-z][a-z0-9-]{0,40})(?:\s|$)/i.exec(texto.trim());
  return m?.[1] === undefined ? null : m[1].toLowerCase();
}

export function criarGanchoMaestroPrompt(porta: PortaDoGanchoMaestro): (c: ContextoDoGancho, corpo: unknown) => Promise<SaidaDoGancho> {
  return async (c, corpo) => {
    try {
      // Panes do Maestro (etapas) e Missões do Maestro nunca são interceptados (as respostas da entrevista não podem ser); a elegibilidade
      // do painel (livre, Claude) já foi decidida ao gerar o settings por Pane (`painelElegivel`): piloto/workers/squads nem têm o hook
      if (porta.ehPaneDoMaestro(c.pane_id) || (c.mission_id !== null && porta.missaoDoMaestro?.(c.mission_id) === true)) return vazio;
      const texto = promptDoPayload(corpo);
      if (texto !== null && ehSlashCommand(texto)) {
        const skill = skillDoSlash(texto);
        if (skill !== null) { try { porta.skillDetectada?.({ workspace_id: c.workspace_id, pane_id: c.pane_id, skill }); } catch { /* o painel nunca derruba o prompt */ } }
        return vazio;
      }
      if (texto === null || ehDireto(texto) || ehMarcadorDoMaestro(texto)) return vazio;
      const cfg = await porta.config(c.workspace_id);
      if (cfg.hook_modo === "desligado") return vazio;
      const contexto: ContextoPedido = { pane_id: c.pane_id, mission_id: c.mission_id, trabalho_id: null, arquivos: [], trecho: null };
      const r = await porta.classificar(texto, { workspace_id: c.workspace_id, contexto });
      if (r.fonte === "comando" || !INTENCOES_ACIONAVEIS.includes(r.intencao) || r.confianca < Math.max(cfg.hook_confianca_min, LIMITE_ALTA)) return vazio;
      // o serviço aplica eco/idempotência/taxa/loop e NUNCA consulta o decisor no hook (`via:"hook"`)
      const { plano } = await porta.pedir({ workspace_id: c.workspace_id, texto, contexto, via: "hook", nivel_pedido: null, executar_direto: null });
      const bloqueia = cfg.hook_modo === "encaminhar";
      porta.evento?.({ tipo: "maestro.hook_intercepted", pipeline_id: plano.id, detalhe: bloqueia ? "encaminhado" : "notificado" });
      return bloqueia ? { saida: { decision: "block", reason: razaoDoBloqueio(plano.intencao, plano.confianca, plano.pipeline_id) } } : vazio;
    } catch {
      return vazio; // falha aberta
    }
  };
}
