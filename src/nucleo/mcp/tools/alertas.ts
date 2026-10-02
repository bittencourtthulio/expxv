// Tool `alert_raise` (Fase 20, T-20.15). Só traduz o contrato externo (inglês, snake_case) para a `PortaAlertasMcp`, implementada no main sobre o emissor de alertas. A identidade (Missão, Pane,
// papel) vem SEMPRE do token. Só o piloto (e workers se o workspace habilitar: decisão do main ao emitir o token); classe `escrita_leve`: só gera `agente_mensagem` no app, que NÃO vai a canal
// externo por padrão (AB-12). Texto redigido no main; resposta mínima (<= 4 KB).
import { argumentoInvalido, indisponivel } from "../erros";
import { comoObjeto, textoOpcional, texto, type ImplTool } from "./comum";

export const TITULO_ALERTA_MAX = 80;
export const DETALHE_ALERTA_MAX = 280;
const KINDS = ["info", "attention", "blocked", "done"] as const;

export const alertRaise: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const kind = a["kind"];
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) throw argumentoInvalido('O campo "kind" deve ser info, attention, blocked ou done.');
  const title = texto(a, "title", { max: TITULO_ALERTA_MAX }).trim();
  const detail = textoOpcional(a, "detail", DETALHE_ALERTA_MAX);
  const task = textoOpcional(a, "task_id", 40);
  if (task !== null && !/^[A-Za-z0-9._-]{1,40}$/.test(task)) throw argumentoInvalido('O campo "task_id" é inválido.');
  if (deps.alertas === undefined) throw indisponivel("Os alertas não estão disponíveis.");
  const porta = deps.alertas;
  try {
    return await porta.levantar(
      { workspace_id: claims.workspace_id, mission_id: claims.mission_id, pane_id: claims.pane_id, role: claims.role, mode: claims.mode },
      { kind: kind as (typeof KINDS)[number], title, ...(detail === null ? {} : { detail }), ...(task === null ? {} : { task_id: task }) },
    );
  } catch (e) {
    // erro nominal da porta passa intacto; o resto vira `unavailable` sem detalhe interno
    if (e instanceof Error && e.name === "ErroMcp") throw e;
    throw indisponivel("Não foi possível registrar o alerta.");
  }
};
