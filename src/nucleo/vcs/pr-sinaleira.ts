// Sinaleira do PR (T-06.35): função PURA (sem Node), usada pelo main e pelo renderer.
// O disco (ENTREGA.md) é só SINALIZADO como desatualizado quando diverge do forge, nunca reescrito (D-04).

export interface PrDaEntrega {
  numero: number;
  estado: "aberto" | "fechado" | "mesclado" | null;
}

export interface PrDoForge {
  numero: number;
  estado: string;
  checks_falhando: number;
  checks_pendentes: number;
}

export interface SinaleiraPr {
  cor: "verde" | "amarela" | "neutra";
  /** Texto curto em PT-BR quando a cor não é verde/neutra. */
  motivo: string | null;
  /** ENTREGA.md diverge do forge (número ou estado): o disco é que está velho; o ADE não o reescreve. */
  entrega_desatualizada: boolean;
}

export function sinaleiraDoPr(pr: PrDoForge | null, entrega: PrDaEntrega | null): SinaleiraPr {
  if (pr === null) return { cor: "neutra", motivo: null, entrega_desatualizada: false };
  const desatualizada = entrega !== null && (entrega.numero !== pr.numero || (entrega.estado !== null && entrega.estado !== pr.estado));
  if (pr.checks_falhando > 0) {
    return { cor: "amarela", motivo: `${pr.checks_falhando} ${pr.checks_falhando === 1 ? "check falhando" : "checks falhando"} no PR #${pr.numero}`, entrega_desatualizada: desatualizada };
  }
  return { cor: pr.checks_pendentes > 0 ? "neutra" : "verde", motivo: null, entrega_desatualizada: desatualizada };
}
