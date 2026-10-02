import type { FonteResultado } from "../../../compartilhado/conhecimento";
import type { HitBusca } from "../busca/buscador";

export function fonteDoHit(h: HitBusca): FonteResultado {
  const c = h.chunk;
  return { documento_id: c.documento_id, tipo: c.tipo, titulo: c.titulo, origem: c.origem, mission_id: c.mission_id, task_ref: c.task_ref, pane_id: c.pane_id, ocorrido_em: c.ocorrido_em };
}
