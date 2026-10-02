// T-18.31: defeitos escapados = ocorrência tipo `bug` aberta DEPOIS do fechamento da sprint, com `regressao_de` apontando um trabalho da sprint (ou ligação humana).
import type { DefeitosEscapados, SprintAgil } from "../../../compartilhado/agil";
import type { OcorrenciaRunx } from "../portas";
import { ms } from "../util";
import type { ItemMetrica } from "./dados";

export function calcularDefeitosEscapados(sprints: readonly SprintAgil[], itens: readonly ItemMetrica[], ocorrencias: readonly OcorrenciaRunx[], ligacoesHumanas: ReadonlyMap<string, string> = new Map()): DefeitosEscapados {
  const trabalhosDaSprint = new Map<string, Set<string>>();
  for (const i of itens) {
    if (!i.trabalho_id) continue;
    for (const p of i.participacoes) if (!p.removido_em) (trabalhosDaSprint.get(p.sprint_id) ?? trabalhosDaSprint.set(p.sprint_id, new Set()).get(p.sprint_id))?.add(i.trabalho_id);
  }
  const porSprint = new Map<string, number>();
  const porCat = new Map<string, number>();
  let total = 0;
  for (const o of ocorrencias) {
    if (o.tipo !== "bug") continue;
    const aberta = ms(o.aberta_em);
    if (aberta === null) continue;
    const sprintLigada = ligacoesHumanas.get(o.id);
    for (const s of sprints) {
      if (s.estado !== "fechada" || !s.fechada_em || aberta <= (ms(s.fechada_em) as number)) continue;
      const doTrabalho = o.regressao_de !== null && (trabalhosDaSprint.get(s.id)?.has(o.regressao_de) ?? false);
      if (!doTrabalho && sprintLigada !== s.id) continue;
      porSprint.set(s.id, (porSprint.get(s.id) ?? 0) + 1);
      const cat = o.categoria ?? "sem_categoria";
      porCat.set(cat, (porCat.get(cat) ?? 0) + 1);
      total++;
      break;
    }
  }
  return {
    total,
    por_sprint: [...porSprint.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sprint_id, n]) => ({ sprint_id, n })),
    por_categoria: [...porCat.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([categoria, n]) => ({ categoria, n })),
  };
}
