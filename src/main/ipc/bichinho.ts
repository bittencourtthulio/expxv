// Canais `bichinho:*` (D-460…): validadores ESTRITOS e manipuladores que delegam ao serviço (src/nucleo/bichinho/servico.ts). O renderer envia só ids,
// uma espécie do catálogo fechado e o apelido (1 a 24 caracteres, sem controle). Erros nominais atravessam como texto; o resto vira texto genérico.
import { ESPECIES, TAMANHO_MAX_APELIDO, type EspecieId } from "../../compartilhado/bichinho";
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { ErroBichinho, type ServicoBichinho } from "../../nucleo/bichinho/servico";
import { vIdWorkspace, vOuNulo } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vEnum, vLista, vTexto, vVazio, type Validador } from "./validar";
import { vObjetoOpc } from "./validar-harness";

type Entradas = { [K in keyof CanaisInvoke as K extends `bichinho:${string}` ? K : never]: Validador<CanaisInvoke[K]["entrada"]> };

const vEspecie: Validador<EspecieId> = vEnum(ESPECIES);
const vApelido = vTexto({ min: 1, max: TAMANHO_MAX_APELIDO });

export const VALIDADORES_BICHINHO: Entradas = {
  "bichinho:listar": vObjetoOpc({ workspace_ids: vLista(vIdWorkspace, 64) }, {}),
  "bichinho:obter": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "bichinho:trocar_especie": vObjetoOpc({ workspace_id: vIdWorkspace, especie: vOuNulo(vEspecie) }, {}),
  "bichinho:renomear": vObjetoOpc({ workspace_id: vIdWorkspace, apelido: vOuNulo(vApelido) }, {}),
  "bichinho:atencao": vObjetoOpc({ workspace_id: vIdWorkspace }, {}),
  "bichinho:usos": vVazio,
} as unknown as Entradas;

export function sanearErroBichinho(erro: unknown): Error {
  return erro instanceof ErroBichinho ? new Error(erro.message) : new Error("Não foi possível concluir a ação do bichinho.");
}

export interface DependenciasIpcBichinho {
  registro: RegistroIpc;
  /** o serviço nasce sob demanda (nada no boot): função assíncrona na primeira chamada. */
  servico: ServicoBichinho | (() => Promise<ServicoBichinho>);
}

export function registrarIpcBichinho(d: DependenciasIpcBichinho): void {
  const { registro } = d;
  const V = VALIDADORES_BICHINHO;
  const obter = async (): Promise<ServicoBichinho> => (typeof d.servico === "function" ? d.servico() : d.servico);
  const guardar = <T>(fn: (s: ServicoBichinho) => T | Promise<T>): Promise<T> => obter().then(fn).catch((e: unknown) => { throw sanearErroBichinho(e); });
  registro.invoke("bichinho:listar", V["bichinho:listar"], ({ workspace_ids }) => guardar((s) => s.listar(workspace_ids)));
  registro.invoke("bichinho:obter", V["bichinho:obter"], ({ workspace_id }) => guardar((s) => s.obter(workspace_id)));
  registro.invoke("bichinho:trocar_especie", V["bichinho:trocar_especie"], ({ workspace_id, especie }) => guardar((s) => s.trocarEspecie(workspace_id, especie)));
  registro.invoke("bichinho:renomear", V["bichinho:renomear"], ({ workspace_id, apelido }) => guardar((s) => s.renomear(workspace_id, apelido)));
  registro.invoke("bichinho:usos", V["bichinho:usos"], () => guardar((s) => s.usos()));
  registro.invoke("bichinho:atencao", V["bichinho:atencao"], ({ workspace_id }) => guardar((s) => s.atencao(workspace_id)));
}
