// Canais `sistema:*` (D-530…): validadores ESTRITOS e manipuladores que delegam ao serviço (src/nucleo/sistema). O renderer só envia
// booleanos; o que volta são inteiros e nomes-base de executável (nunca argumentos, caminhos nem variáveis).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import type { ServicoSistema } from "../../nucleo/sistema/servico";
import type { RegistroIpc } from "./registro";
import { vBooleano, vObjeto, type Validador } from "./validar";

type Entradas = { [K in keyof CanaisInvoke as K extends `sistema:${string}` ? K : never]: Validador<CanaisInvoke[K]["entrada"]> };

export const VALIDADORES_SISTEMA: Entradas = {
  "sistema:amostra_assinar": vObjeto({ ativo: vBooleano }),
  "sistema:detalhe": vObjeto({ aberto: vBooleano }),
} as unknown as Entradas;

export interface DependenciasIpcSistema {
  registro: RegistroIpc;
  /** o serviço nasce sob demanda (nada no boot). */
  servico: () => Promise<ServicoSistema>;
}

export function registrarIpcSistema(d: DependenciasIpcSistema): void {
  const { registro } = d;
  const V = VALIDADORES_SISTEMA;
  registro.invoke("sistema:amostra_assinar", V["sistema:amostra_assinar"], async ({ ativo }) => {
    (await d.servico()).definirAssinatura(ativo);
    return { ativo };
  });
  registro.invoke("sistema:detalhe", V["sistema:detalhe"], async ({ aberto }) => (await d.servico()).detalhe(aberto));
}
