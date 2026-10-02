// Canais `executar:*` (D-430…): validadores ESTRITOS e manipuladores que delegam ao serviço (src/main/executar.ts). O renderer NUNCA envia cwd,
// caminho de executável nem URL: só ids, o hash de confirmação e a configuração (revalidada campo a campo, `origem` é carimbada pelo main).
// `executar:config_gravar` é sensível (comando e ambiente no payload): o log do registro nunca o imprime. Erros nominais do serviço atravessam
// como texto; qualquer outro vira texto genérico (nunca stack nem caminho de máquina).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { validarConfig } from "../../nucleo/executar/validacao";
import { ErroExecutar, type ServicoExecutar } from "../executar";
import { vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vTexto, type Resultado, type Validador } from "./validar";
import { vObjetoOpc } from "./validar-harness";

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

export const vIdConfig = vTexto({ min: 1, max: 40, padrao: /^[a-z0-9][a-z0-9-]{0,39}$/ });
export const vHash = vTexto({ min: 40, max: 40, padrao: /^[0-9a-f]{40}$/ });

type Entradas = { [K in keyof CanaisInvoke as K extends `executar:${string}` ? K : never]: Validador<CanaisInvoke[K]["entrada"]> };

export const vConfigIpc: Validador<CanaisInvoke["executar:config_gravar"]["entrada"]["config"]> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("configuração: esperado objeto");
  // `origem` nunca vem do renderer
  if ("origem" in (v as object)) return falha("campo desconhecido: origem");
  const r = validarConfig(v, "usuario");
  if (!r.ok) return falha(r.erro);
  const { origem, ...resto } = r.valor;
  void origem;
  return ok(resto);
};

export const VALIDADORES_EXECUTAR: Entradas = {
  "executar:listar": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "executar:estado": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "executar:iniciar": vObjetoOpc({ workspace_id: vIdWorkspace }, { config_id: vIdConfig, confirmar_hash: vHash }),
  "executar:parar": vObjetoOpc({ workspace_id: vIdWorkspace }, { config_id: vIdConfig }),
  "executar:reiniciar": vObjetoOpc({ workspace_id: vIdWorkspace }, { config_id: vIdConfig }),
  "executar:config_gravar": vObjetoOpc({ workspace_id: vIdWorkspace, config: vConfigIpc, confirmou_shell: vBooleano }, {}),
  "executar:config_remover": vObjetoOpc({ workspace_id: vIdWorkspace, config_id: vIdConfig }, {}),
  "executar:definir_padrao": vObjetoOpc({ workspace_id: vIdWorkspace, config_id: vIdConfig }, {}),
  "executar:revogar_confianca": vObjetoOpc({ workspace_id: vIdWorkspace }, { config_id: vIdConfig }),
  "executar:historico": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "executar:abrir_url": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
} as unknown as Entradas;

/** Erro nominal passa; o resto vira texto genérico. */
export function sanearErroExecutar(erro: unknown): Error {
  return erro instanceof ErroExecutar ? new Error(erro.message) : new Error("Não foi possível concluir a ação de execução.");
}

export interface DependenciasIpcExecutar {
  registro: RegistroIpc;
  /** o serviço pode nascer sob demanda (nada no boot): função assíncrona na primeira chamada */
  servico: ServicoExecutar | (() => Promise<ServicoExecutar>);
}

export function registrarIpcExecutar(d: DependenciasIpcExecutar): void {
  const { registro } = d;
  const V = VALIDADORES_EXECUTAR;
  const obter = async (): Promise<ServicoExecutar> => (typeof d.servico === "function" ? d.servico() : d.servico);
  const guardar = <T>(fn: (s: ServicoExecutar) => T | Promise<T>): Promise<T> => obter().then(fn).catch((e: unknown) => { throw sanearErroExecutar(e); });

  registro.invoke("executar:listar", V["executar:listar"], ({ workspace_id }) => guardar((s) => s.listar(workspace_id)));
  registro.invoke("executar:estado", V["executar:estado"], ({ workspace_id }) => guardar((s) => s.estado(workspace_id)));
  registro.invoke("executar:iniciar", V["executar:iniciar"], ({ workspace_id, config_id, confirmar_hash }) => guardar((s) => s.iniciar(workspace_id, { config_id, confirmar_hash })));
  registro.invoke("executar:parar", V["executar:parar"], ({ workspace_id, config_id }) => guardar(async (s) => ({ ok: await s.parar(workspace_id, config_id) })));
  registro.invoke("executar:reiniciar", V["executar:reiniciar"], ({ workspace_id, config_id }) => guardar((s) => s.reiniciar(workspace_id, config_id)));
  registro.invoke("executar:config_gravar", V["executar:config_gravar"], ({ workspace_id, config, confirmou_shell }) => guardar((s) => s.gravarConfig(workspace_id, { ...config, origem: "usuario" }, confirmou_shell)));
  registro.invoke("executar:config_remover", V["executar:config_remover"], ({ workspace_id, config_id }) => guardar((s) => s.removerConfig(workspace_id, config_id)));
  registro.invoke("executar:definir_padrao", V["executar:definir_padrao"], ({ workspace_id, config_id }) => guardar((s) => s.definirPadrao(workspace_id, config_id)));
  registro.invoke("executar:revogar_confianca", V["executar:revogar_confianca"], ({ workspace_id, config_id }) => guardar((s) => s.revogarConfianca(workspace_id, config_id)));
  registro.invoke("executar:historico", V["executar:historico"], ({ workspace_id }) => guardar((s) => s.historico(workspace_id)));
  registro.invoke("executar:abrir_url", V["executar:abrir_url"], ({ workspace_id }) => guardar(async (s) => ({ ok: await s.abrirUrl(workspace_id) })));
}
