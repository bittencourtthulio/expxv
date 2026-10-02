// Canais `suite:*` (D-470…): validadores ESTRITOS e manipuladores que delegam ao serviço (src/main/suite.ts). O renderer NUNCA envia caminho, versão,
// registro nem argumento: só o id do workspace (que precisa existir), o modo (lista fechada) e o booleano de "Agora não". Quem decide pasta, versão
// fixada e comando é o main. Não há MCP para iniciar instalação: só estes canais, e só por clique. Erros nominais atravessam como texto; o resto, texto genérico.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { MODULOS } from "../../nucleo/suite/modulos";
import { ErroSuite, type ServicoSuite } from "../suite";
import type { ServicoModulos } from "../suite-modulos";
import { vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, type Resultado, type Validador } from "./validar";
import { vObjetoOpc } from "./validar-harness";

type Entradas = { [K in keyof CanaisInvoke as K extends `suite:${string}` ? K : never]: Validador<CanaisInvoke[K]["entrada"]> };

export const MODOS_SUITE = ["instalar", "reparar", "atualizar"] as const;

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

/** `{ modulos: { <os nove>: boolean } }`: exatamente os nove módulos, todos booleanos (nenhuma chave a mais ou a menos). */
const vPadraoModulos: Validador<{ modulos: Record<string, boolean> }> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  const chaves = Object.keys(v);
  if (chaves.length !== 1 || chaves[0] !== "modulos") return falha("campo desconhecido ou ausente");
  const m = (v as { modulos: unknown }).modulos;
  if (typeof m !== "object" || m === null || Array.isArray(m)) return falha("modulos: esperado objeto");
  const nomes = Object.keys(m);
  if (nomes.length !== MODULOS.length || nomes.some((n) => !(MODULOS as readonly string[]).includes(n))) return falha("modulos: precisa ter exatamente os nove módulos");
  const saida: Record<string, boolean> = {};
  for (const n of MODULOS) {
    const x = (m as Record<string, unknown>)[n];
    if (typeof x !== "boolean") return falha(`modulos.${n}: esperado booleano`);
    saida[n] = x;
  }
  return ok({ modulos: saida });
};

const vSemPayload: Validador<Record<string, never>> = (v) => (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0 ? ok({}) : falha("esperado objeto vazio"));

export const VALIDADORES_SUITE: Entradas = {
  "suite:modulos_estado": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "suite:modulos_definir": vObjetoOpc({ workspace_id: vIdWorkspace, modulo: vEnum(MODULOS), ligado: vBooleano, confirmar_cascata: vBooleano }, {}),
  "suite:modulos_restaurar": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "suite:modulos_padrao": vSemPayload,
  "suite:modulos_padrao_definir": vPadraoModulos,
  "suite:estado": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "suite:requisitos": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "suite:instalar": vObjetoOpc({ workspace_id: vIdWorkspace, modo: vEnum(MODOS_SUITE) }, {}),
  "suite:cancelar": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "suite:dispensar": vObjetoOpc({ workspace_id: vIdWorkspace, dispensar: vBooleano }, {}),
} as unknown as Entradas;

export function sanearErroSuite(erro: unknown): Error {
  return erro instanceof ErroSuite ? new Error(erro.message) : new Error("Não foi possível concluir a ação da suíte ExpxDev.");
}

export interface DependenciasIpcSuite {
  registro: RegistroIpc;
  /** o serviço nasce sob demanda (nada no boot): função assíncrona na primeira chamada */
  servico: ServicoSuite | (() => Promise<ServicoSuite>);
  /** módulos da suíte: leve (um arquivo pequeno); pode ser criado na hora do uso */
  modulos: ServicoModulos | (() => ServicoModulos);
}

export function registrarIpcSuite(d: DependenciasIpcSuite): void {
  const { registro } = d;
  const V = VALIDADORES_SUITE;
  const obter = async (): Promise<ServicoSuite> => (typeof d.servico === "function" ? d.servico() : d.servico);
  const guardar = <T>(fn: (s: ServicoSuite) => T | Promise<T>): Promise<T> => obter().then(fn).catch((e: unknown) => { throw sanearErroSuite(e); });
  registro.invoke("suite:estado", V["suite:estado"], ({ workspace_id }) => guardar((s) => s.estado(workspace_id)));
  registro.invoke("suite:requisitos", V["suite:requisitos"], ({ workspace_id }) => guardar((s) => s.requisitos(workspace_id)));
  registro.invoke("suite:instalar", V["suite:instalar"], ({ workspace_id, modo }) => guardar((s) => s.instalar(workspace_id, modo)));
  registro.invoke("suite:cancelar", V["suite:cancelar"], ({ workspace_id }) => guardar(async (s) => ({ ok: await s.cancelar(workspace_id) })));
  const mods = (): ServicoModulos => (typeof d.modulos === "function" ? d.modulos() : d.modulos);
  const guardarMod = <T>(fn: (m: ServicoModulos) => T | Promise<T>): Promise<T> => Promise.resolve().then(() => fn(mods())).catch((e: unknown) => { throw sanearErroSuite(e); });
  registro.invoke("suite:modulos_estado", V["suite:modulos_estado"], ({ workspace_id }) => guardarMod((m) => m.estado(workspace_id)));
  registro.invoke("suite:modulos_definir", V["suite:modulos_definir"], ({ workspace_id, modulo, ligado, confirmar_cascata }) => guardarMod((m) => m.definir(workspace_id, modulo, ligado, confirmar_cascata)));
  registro.invoke("suite:modulos_restaurar", V["suite:modulos_restaurar"], ({ workspace_id }) => guardarMod((m) => m.restaurar(workspace_id)));
  registro.invoke("suite:modulos_padrao", V["suite:modulos_padrao"], () => guardarMod((m) => m.padrao()));
  registro.invoke("suite:modulos_padrao_definir", V["suite:modulos_padrao_definir"], ({ modulos }) => guardarMod((m) => m.definirPadrao(modulos)));
  registro.invoke("suite:dispensar", V["suite:dispensar"], ({ workspace_id, dispensar }) => guardar((s) => s.dispensar(workspace_id, dispensar)));
}
