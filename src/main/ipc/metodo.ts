// Canais `metodo:*` (Fase 4). Somente leitura do disco + digitar comandos no Pane. O renderer manda o
// gesto e o argumento; o texto do comando, o harness e o cwd saem do main (D-20). Ações sempre humanas
// voltam com `somente_humano` e nunca disparam (D-21).
import type { GestoMetodo } from "../../compartilhado/dominio";
import type { EventoRastro, IndiceProjeto, ResumoMudancaMetodo } from "../../compartilhado/dominio";
import type { ServicoMetodoMissao } from "../../nucleo/metodo/missao";
import { vIdTrabalho, vIdWorkspace, vOuNulo, vIdPane, vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vEnum, vInteiro, vObjeto } from "./validar";

const TABELA_GESTOS: Record<GestoMetodo, true> = {
  nova_feature: true,
  nova_ocorrencia: true,
  pedido_cru: true,
  projeto: true,
  retomar: true,
  auditar: true,
  qa: true,
  entrega_check: true,
  entrega_atencao: true,
  entrega_qa: true,
  entrega_pr: true,
  gerar_convencoes: true,
  gerar_produto: true,
  gerar_memoria: true,
  gerar_design_system: true,
  gerar_perfil_legado: true,
};
export const GESTOS_METODO = Object.keys(TABELA_GESTOS) as GestoMetodo[];

export const VALIDADORES_METODO = {
  estado: vObjeto({ workspace_id: vIdWorkspace }),
  rastro: vObjeto({ workspace_id: vIdWorkspace, trabalho_id: vIdTrabalho, depois: vInteiro({ min: 0, max: 10_000_000 }) }),
  comandoSugerido: vObjeto({ workspace_id: vIdWorkspace, trabalho_id: vOuNulo(vIdTrabalho), gesto: vEnum(GESTOS_METODO), argumento: vOuNulo(vTextoLivre(4_000)) }),
  disparar: vObjeto({ workspace_id: vIdWorkspace, trabalho_id: vOuNulo(vIdTrabalho), gesto: vEnum(GESTOS_METODO), argumento: vOuNulo(vTextoLivre(4_000)), pane_id: vOuNulo(vIdPane) }),
} as const;

/** O que os canais usam do gerenciador do método (índices por workspace e rastro). */
export interface MetodoLeitura {
  estado(workspaceId: string): Promise<IndiceProjeto | null>;
  rastro(workspaceId: string, trabalhoId: string, depois: number): Promise<{ eventos: EventoRastro[]; proximo: number }>;
}

export interface DependenciasIpcMetodo {
  registro: RegistroIpc;
  leitura: MetodoLeitura;
  missao: Pick<ServicoMetodoMissao, "comandoSugeridoPara" | "disparar">;
}

export type { ResumoMudancaMetodo };

export function registrarIpcMetodo(d: DependenciasIpcMetodo): void {
  const { registro, leitura, missao } = d;
  const V = VALIDADORES_METODO;
  registro.invoke("metodo:estado", V.estado, ({ workspace_id }) => leitura.estado(workspace_id));
  registro.invoke("metodo:rastro", V.rastro, ({ workspace_id, trabalho_id, depois }) => leitura.rastro(workspace_id, trabalho_id, depois));
  registro.invoke("metodo:comando_sugerido", V.comandoSugerido, (p) => missao.comandoSugeridoPara(p));
  registro.invoke("metodo:disparar", V.disparar, (p) => missao.disparar(p));
}
