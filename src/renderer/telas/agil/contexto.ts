import type { ApiAgil, EstadoAgilApp, FiltrosAgil, MembroAgil, PainelAgil, SprintComResumoAgil } from "../../../compartilhado/agil";

/** O que a casca entrega a cada aba. `recarregar` refaz estado/sprints/membros/painel (coalescido). */
export interface CtxAgil {
  api: ApiAgil;
  ws: string;
  estado: EstadoAgilApp | null;
  sprints: SprintComResumoAgil[];
  membros: MembroAgil[];
  painel: PainelAgil | null;
  filtros: FiltrosAgil;
  busca: string;
  recarregar: () => void;
  /** troca de aba pedida por uma aba (ex.: Sprint -> Retro). */
  irPara: (aba: import("./logica").AbaAgil) => void;
}
