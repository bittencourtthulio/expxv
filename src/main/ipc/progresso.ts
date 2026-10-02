// Canais `progresso:*` (D-660…): validadores ESTRITOS e manipuladores que delegam ao serviço (src/main/progresso.ts). O renderer só envia o id de um
// progresso e um booleano; o que volta é o estado agregado (rótulos do catálogo, nunca conversa). O serviço nasce na primeira chamada (nada no boot).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import type { ServicoProgresso } from "../progresso";
import type { RegistroIpc } from "./registro";
import { vBooleano, vObjeto, vTexto, vVazio, type Validador } from "./validar";

type Entradas = { [K in keyof CanaisInvoke as K extends `progresso:${string}` ? K : never]: Validador<CanaisInvoke[K]["entrada"]> };

/** `pl:<pipeline>`, `sx:<trabalho>`, `sk:<skill>:<chave>`: só letras, dígitos e `: _ . -`. */
export const vIdProgresso = vTexto({ min: 4, max: 160, padrao: /^(?:pl|sx|sk):[A-Za-z0-9][A-Za-z0-9:_.-]*$/ });

export const VALIDADORES_PROGRESSO: Entradas = {
  "progresso:estado": vVazio,
  "progresso:dispensar": vObjeto({ id: vIdProgresso }),
  "progresso:fixar": vObjeto({ id: vIdProgresso, fixado: vBooleano }),
} as unknown as Entradas;

export interface DependenciasIpcProgresso {
  registro: RegistroIpc;
  /** o serviço nasce sob demanda (nada no boot). */
  servico: () => Promise<ServicoProgresso>;
}

export function registrarIpcProgresso(d: DependenciasIpcProgresso): void {
  const { registro } = d;
  const V = VALIDADORES_PROGRESSO;
  const falha = (): Error => new Error("Não foi possível ler o progresso.");
  registro.invoke("progresso:estado", V["progresso:estado"], () => d.servico().then((s) => s.estado()).catch(() => { throw falha(); }));
  registro.invoke("progresso:dispensar", V["progresso:dispensar"], ({ id }) => d.servico().then((s) => { s.dispensar(id); return { ok: true as const }; }).catch(() => { throw falha(); }));
  registro.invoke("progresso:fixar", V["progresso:fixar"], ({ id, fixado }) => d.servico().then((s) => { s.fixar(id, fixado); return { ok: true as const }; }).catch(() => { throw falha(); }));
}
