// Tools `agent_list` e `agent_invoke` (Fase 14, T-14.13). Só traduzem o contrato externo (inglês, snake_case) para a porta `PortaSquads`,
// implementada no main (`squads/invocacao.ts`). A identidade (Missão, Pane, papel, modo) vem SEMPRE do token. Quem decide gate, papel,
// limites e provedor é o motor no main; aqui só se barra o que o token já diz (não é piloto, sem Missão) e o formato da entrada.
// Resposta ≤ 4 KB e nunca texto de prompt.
import { ErroMcp, argumentoInvalido, indisponivel, violacaoDeRegra } from "../erros";
import type { AgenteListado, ClaimsDeSquad, PedidoInvocarAgente, PortaSquads } from "../portas";
import { caberEm4Kb } from "./harness";
import { comoObjeto, identificador, identificadorOpcional, textoOpcional, type ContextoTool, type DepsTools, type ImplTool } from "./comum";

/** `prompt` de `agent_invoke` (≤ 4000 caracteres; igual a `PROMPT_INVOCAR_MAX` do motor). */
export const PROMPT_INVOCAR_MAX_MCP = 4000;

function exigirSquads(deps: DepsTools): PortaSquads {
  if (deps.squads === undefined) throw indisponivel("Os squads não estão disponíveis.");
  return deps.squads;
}

/** Só o piloto, e só em Missão de squad ou agêntica (o modo livre nunca tem squad). A Missão do token é a única que vale. */
function exigirPiloto(claims: ContextoTool["claims"]): string {
  if (claims.role !== "piloto" || claims.mode === "livre") throw violacaoDeRegra("forbidden_role", "Só o piloto de uma Missão com squad usa os agentes.");
  if (claims.mission_id === null) throw violacaoDeRegra("not_in_mission", "O Pane não pertence a uma Missão.");
  return claims.mission_id;
}

/** Erro nominal da porta passa intacto (`code`/`subcode`); o resto vira `unavailable` sem detalhe interno. */
async function daPorta<T>(chamada: () => Promise<T>, mensagem: string): Promise<T> {
  try {
    return await chamada();
  } catch (e) {
    if (e instanceof ErroMcp) throw e;
    throw indisponivel(mensagem);
  }
}

const listado = (a: AgenteListado): AgenteListado => ({ agent_id: a.agent_id, role: a.role, label: a.label, description: a.description, tier: a.tier, max_instances: a.max_instances, in_flight: a.in_flight });

export const agentList: ImplTool = async (args, { claims, deps }) => {
  comoObjeto(args);
  const missionId = exigirPiloto(claims);
  const r = await daPorta(() => exigirSquads(deps).listar(missionId), "Não foi possível listar os agentes.");
  // copia campo a campo: nada além do contrato (jamais o prompt) atravessa, mesmo que a porta entregue mais
  return caberEm4Kb(r.agents.map(listado), (itens, extra) => ({ agents: itens, ...extra }));
};

export const agentInvoke: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const agentId = identificador(a, "agent_id");
  identificadorOpcional(a, "task_id"); // aceito e ignorado: cada invocação cria o seu card
  const briefing = textoOpcional(a, "briefing_path", 500);
  const prompt = textoOpcional(a, "prompt", PROMPT_INVOCAR_MAX_MCP);
  if (prompt !== null && briefing !== null) throw argumentoInvalido('Informe "briefing_path" OU "prompt", não os dois.');
  const missionId = exigirPiloto(claims);
  const identidade: ClaimsDeSquad = { workspace_id: claims.workspace_id, mission_id: missionId, pane_id: claims.pane_id, role: claims.role, mode: claims.mode };
  const pedido: PedidoInvocarAgente = { agent_id: agentId, ...(briefing === null ? {} : { briefing_path: briefing }), ...(prompt === null ? {} : { prompt }) };
  const r = await daPorta(() => exigirSquads(deps).invocar(identidade, pedido), "Não foi possível invocar o agente.");
  return { pane_id: r.pane_id, invocation_id: r.invocation_id };
};
