import { verificarConclusao } from "../../orquestracao/regras";
import { argumentoInvalido, indisponivel } from "../erros";
import { ESTADO_MISSAO_EXTERNO, ESTADO_MISSAO_INTERNO, MODO_EXTERNO, comoObjeto, textoOpcional, type ImplTool } from "./comum";

export const missionList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const filtro = textoOpcional(a, "status", 30);
  let estado;
  if (filtro !== null) {
    estado = ESTADO_MISSAO_INTERNO[filtro];
    if (estado === undefined) throw argumentoInvalido('O campo "status" é inválido.');
  }
  const missoes = await deps.missoes.listar({ workspace_id: claims.workspace_id, ...(estado === undefined ? {} : { estado }) });
  return missoes.map((m) => ({
    mission_id: m.mission_id,
    title: m.titulo,
    mode: MODO_EXTERNO[m.modo],
    status: ESTADO_MISSAO_EXTERNO[m.estado],
    pilot_pane_id: m.piloto_pane_id,
  }));
};

/** A Missão é a do token; qualquer `mission_id` no argumento é ignorado. */
export const missionComplete: ImplTool = async (args, { claims, deps }) => {
  comoObjeto(args);
  const missao = claims.mission_id === null ? null : await deps.missoes.obter(claims.mission_id);
  const revisorOk = missao === null ? false : await deps.handoff.temRevisorOk(missao.mission_id);
  verificarConclusao({ papel: claims.role, missao, revisor_ok: revisorOk });
  try {
    await deps.missoes.concluir((missao as { mission_id: string }).mission_id);
  } catch {
    throw indisponivel("Não foi possível concluir a Missão.");
  }
  return { ok: true };
};
