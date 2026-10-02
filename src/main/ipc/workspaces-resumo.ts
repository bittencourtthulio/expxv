// Canais do painel de workspaces (D-450…): leitura agregada + ativar/desativar a assinatura + encerrar um agente + revelar a pasta.
// O renderer só envia ids (workspace_id, sessao_id) e um booleano: nunca caminho, cwd nem pid. Quem prova que a sessão pertence ao
// workspace é o serviço (src/main/workspaces-resumo.ts), ANTES de encerrar qualquer coisa.
import { vIdSessao } from "../../nucleo/terminais/ipc-validadores";
import type { ServicoResumoWorkspaces } from "../workspaces-resumo";
import { vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vObjeto, vVazio } from "./validar";

export const VALIDADORES_RESUMO_WORKSPACES = {
  resumo: vVazio,
  ativar: vObjeto({ ativo: vBooleano }),
  encerrarAgente: vObjeto({ workspace_id: vIdWorkspace, sessao_id: vIdSessao }),
  revelar: vObjeto({ workspace_id: vIdWorkspace }),
  copiarCaminho: vObjeto({ workspace_id: vIdWorkspace }),
} as const;

export interface DependenciasIpcResumoWorkspaces {
  registro: RegistroIpc;
  /** nasce sob demanda (nada no boot). */
  servico: ServicoResumoWorkspaces | (() => Promise<ServicoResumoWorkspaces>);
}

export function registrarIpcResumoWorkspaces(d: DependenciasIpcResumoWorkspaces): void {
  const V = VALIDADORES_RESUMO_WORKSPACES;
  const obter = async (): Promise<ServicoResumoWorkspaces> => (typeof d.servico === "function" ? d.servico() : d.servico);
  d.registro.invoke("workspaces:resumo", V.resumo, async () => (await obter()).resumo());
  d.registro.invoke("workspaces:resumo_ativar", V.ativar, async ({ ativo }) => (await obter()).ativar(ativo));
  d.registro.invoke("workspaces:encerrar_agente", V.encerrarAgente, async ({ workspace_id, sessao_id }) => (await obter()).encerrarAgente({ workspace_id, sessao_id }));
  d.registro.invoke("workspaces:revelar", V.revelar, async ({ workspace_id }) => (await obter()).revelar(workspace_id));
  d.registro.invoke("workspaces:copiar_caminho", V.copiarCaminho, async ({ workspace_id }) => (await obter()).copiarCaminho(workspace_id));
}
