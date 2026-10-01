import { RESUMO_MAX } from "../../orquestracao/regras";
import { argumentoInvalido } from "../erros";
import { STATUS_HANDOFF_INTERNO, comoObjeto, identificador, listaDeTextos, texto, type ImplTool } from "./comum";

/**
 * Valida a entrada e delega ao serviço de handoff (relatório → banco → wake). Identidade (Pane, Missão)
 * vem do token; `pane_id`/`mission_id`/`role` no argumento são ignorados.
 */
export const handoffSubmit: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const taskId = identificador(a, "task_id");
  const resumo = texto(a, "summary", { vazio: false });
  if ([...resumo].length > RESUMO_MAX) throw argumentoInvalido(`O resumo tem mais de ${RESUMO_MAX} caracteres.`, "summary_too_long");
  const relatorio = texto(a, "report_path", { max: 500 });
  const artefatos = listaDeTextos(a, "artifacts");
  const statusBruto = texto(a, "status", { max: 20 });
  const status = STATUS_HANDOFF_INTERNO[statusBruto];
  if (status === undefined) throw argumentoInvalido('O campo "status" deve ser ok, partial, blocked ou failed.');
  const { handoff_id } = await deps.handoff.registrar({
    workspace_id: claims.workspace_id,
    mission_id: claims.mission_id,
    pane_id: claims.pane_id,
    papel: claims.role,
    task_id: taskId,
    resumo,
    relatorio_path: relatorio,
    artefatos,
    status,
  });
  return { handoff_id };
};
