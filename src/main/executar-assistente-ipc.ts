// Canais `executar:assistente_*` (D-582…): validadores ESTRITOS e manipuladores. O renderer NUNCA envia caminho: só o id do workspace, a CLI (lista fechada), o hash
// do dossiê consentido, o id da proposta e as configurações REVISADAS (revalidadas campo a campo; `origem` é carimbada pelo main). `executar:assistente_salvar` é
// sensível (comandos no payload): o log do registro nunca o imprime. Erros nominais atravessam como texto; qualquer outro vira texto genérico.
import type { CanaisInvoke } from "../compartilhado/ipc";
import { CLIS_ASSISTENTE } from "../compartilhado/executar-assistente";
import { LIMITES_IA } from "../nucleo/executar/assistente/validar-ia";
import { ErroExecutar } from "./executar";
import type { ServicoAssistente } from "./executar-assistente";
import { vConfigIpc, vHash, vIdConfig } from "./ipc/executar";
import { vIdWorkspace } from "./ipc/comum-dominio";
import type { RegistroIpc } from "./ipc/registro";
import { vBooleano, vEnum, vLista, vTexto, type Validador } from "./ipc/validar";
import { vNulavel, vObjetoOpc } from "./ipc/validar-harness";

type Entradas = { [K in keyof CanaisInvoke as K extends `executar:assistente_${string}` ? K : never]: Validador<CanaisInvoke[K]["entrada"]> };

const vCli = vEnum(CLIS_ASSISTENTE);
const vIdAssistente = vTexto({ min: 24, max: 24, padrao: /^ass_[a-f0-9]{20}$/ });

export const VALIDADORES_ASSISTENTE: Entradas = {
  "executar:assistente_previa": vObjetoOpc({ workspace_id: vIdWorkspace }, { cli: vCli }),
  "executar:assistente_propor": vObjetoOpc({ workspace_id: vIdWorkspace, cli: vCli, dossie_hash: vHash, consentimento: vBooleano }, {}),
  "executar:assistente_cancelar": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "executar:assistente_salvar": vObjetoOpc({ workspace_id: vIdWorkspace, assistente_id: vIdAssistente, configs: vLista(vConfigIpc, LIMITES_IA.configuracoes), padrao_id: vNulavel(vIdConfig) }, {}),
} as unknown as Entradas;

export function sanearErroAssistente(erro: unknown): Error {
  return erro instanceof ErroExecutar ? new Error(erro.message) : new Error("Não foi possível concluir a ação do assistente de execução.");
}

export interface DependenciasIpcAssistente {
  registro: RegistroIpc;
  /** o serviço nasce sob demanda (nada no boot) */
  servico: ServicoAssistente | (() => Promise<ServicoAssistente>);
}

export function registrarIpcAssistente(d: DependenciasIpcAssistente): void {
  const { registro } = d;
  const V = VALIDADORES_ASSISTENTE;
  const obter = async (): Promise<ServicoAssistente> => (typeof d.servico === "function" ? d.servico() : d.servico);
  const guardar = <T>(fn: (s: ServicoAssistente) => T | Promise<T>): Promise<T> => obter().then(fn).catch((e: unknown) => { throw sanearErroAssistente(e); });

  registro.invoke("executar:assistente_previa", V["executar:assistente_previa"], ({ workspace_id, cli }) => guardar((s) => s.previa(workspace_id, cli)));
  registro.invoke("executar:assistente_propor", V["executar:assistente_propor"], ({ workspace_id, cli, dossie_hash, consentimento }) => guardar((s) => s.propor(workspace_id, { cli, dossie_hash, consentimento })));
  registro.invoke("executar:assistente_cancelar", V["executar:assistente_cancelar"], ({ workspace_id }) => guardar(async (s) => ({ ok: await s.cancelar(workspace_id) })));
  registro.invoke("executar:assistente_salvar", V["executar:assistente_salvar"], ({ workspace_id, assistente_id, configs, padrao_id }) => guardar((s) => s.salvar(workspace_id, { assistente_id, configs, padrao_id })));
}
