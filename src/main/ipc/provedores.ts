// Canais `provedores:*` (T-02.04). Conta = rótulo + config dir isolado (referência, nunca segredo).
import type { ServicoContas } from "../../nucleo/provedores/contas";
import type { ServicoProvedores } from "../../nucleo/provedores/servico";
import { vBooleano, vEnum, vObjeto, vVazio } from "./validar";
import { vIdConta, vRotulo } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { CATALOGO_TERMINAIS } from "../../nucleo/terminais/catalogo";

const PROVEDORES = CATALOGO_TERMINAIS.filter((f) => f.id !== "terminal").map((f) => f.id);

export const VALIDADORES_PROVEDORES = {
  listar: vObjeto({ forcar: vBooleano }),
  contasCriar: vObjeto({ provedor: vEnum(PROVEDORES), rotulo: vRotulo(60) }),
  contasHabilitar: vObjeto({ conta_id: vIdConta, habilitada: vBooleano }),
  diagnostico: vVazio,
} as const;

export interface DependenciasIpcProvedores {
  registro: RegistroIpc;
  servico: Pick<ServicoProvedores, "listar" | "diagnostico">;
  contas: Pick<ServicoContas, "criar" | "habilitar">;
}

export function registrarIpcProvedores(d: DependenciasIpcProvedores): void {
  const { registro, servico, contas } = d;
  const V = VALIDADORES_PROVEDORES;
  registro.invoke("provedores:listar", V.listar, ({ forcar }) => servico.listar(forcar));
  registro.invoke("provedores:contas_criar", V.contasCriar, ({ provedor, rotulo }) => contas.criar(provedor, rotulo));
  registro.invoke("provedores:contas_habilitar", V.contasHabilitar, ({ conta_id, habilitada }) => contas.habilitar(conta_id, habilitada));
  registro.invoke("provedores:diagnostico", V.diagnostico, () => servico.diagnostico());
}
