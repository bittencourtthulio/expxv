// Tool `account_switch` (Fase 9, T-09.20): move um Pane de worker para outra conta (ou modelo equivalente) com brief de retomada.
// Não decide nada: delega, pela porta `PortaTroca`, ao MESMO caminho do botão "mover" do app (`executor.mover`). Erros nominais
// (`not_at_limit`, `provider_mismatch`, `no_capacity`, `limit_reached`) já chegam como `ErroMcp` da porta.
import { ErroMcp, argumentoInvalido, indisponivel, naoAutorizado, naoEncontrado, violacaoDeRegra } from "../erros";
import type { ResultadoTrocaDeConta } from "../portas";
import { booleanoOpcional, comoObjeto, identificador, identificadorOpcional, textoOpcional, type ImplTool } from "./comum";

const lado = (l: ResultadoTrocaDeConta["from"]): Record<string, unknown> => ({ account_id: l.conta_id, provider: l.provedor, model: l.modelo });

export const accountSwitch: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const paneId = identificador(a, "pane_id");
  const alvo = identificadorOpcional(a, "target_account_id");
  const motivo = textoOpcional(a, "reason", 300);
  const force = booleanoOpcional(a, "force", false);
  // só o piloto agêntico troca; a matriz já esconde a tool dos demais, mas a regra mora aqui também (token antigo, chamada direta)
  if (claims.role !== "piloto" || claims.mode !== "agentico") throw violacaoDeRegra("forbidden_role", "Só o piloto de uma Missão agêntica troca a conta de um Pane.");
  if (paneId === claims.pane_id) throw violacaoDeRegra("forbidden_role", "O piloto não troca a própria conta por esta tool.");
  const troca = deps.troca;
  if (troca === undefined) throw indisponivel("A troca de conta não está disponível.");
  const pane = await deps.panes.obter(paneId);
  if (pane === null) throw naoEncontrado(`Pane não encontrado: ${paneId}.`);
  if (pane.workspace_id !== claims.workspace_id || pane.mission_id !== claims.mission_id) throw naoAutorizado("O Pane não pertence ao escopo deste token.");
  if (pane.eh_piloto) throw violacaoDeRegra("forbidden_role", "O Pane do piloto não é movido por esta tool.");
  if (pane.estado === "encerrado") throw argumentoInvalido("O Pane já foi encerrado.");
  try {
    const r = await troca.mover({ pane_id: paneId, target_account_id: alvo, reason: motivo, force });
    return { new_pane_id: r.new_pane_id, from: lado(r.from), to: lado(r.to) };
  } catch (e) {
    if (e instanceof ErroMcp) throw e;
    throw indisponivel("Não foi possível trocar a conta do Pane.");
  }
};
