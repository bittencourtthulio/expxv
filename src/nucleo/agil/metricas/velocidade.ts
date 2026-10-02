// T-18.30: velocidade = Σ pontos de itens concluídos DENTRO da janela da sprint; média móvel de 3 sprints; "de primeira" = só situacao 'primeira'.
import type { PontoVelocidade, SprintAgil } from "../../../compartilhado/agil";
import { arredondar, diaDe, media } from "../util";
import type { ItemMetrica } from "./dados";

export function pontosConcluidosNaSprint(sprint: Pick<SprintAgil, "id" | "inicio" | "fim">, itens: readonly ItemMetrica[]): { concluido: number; de_primeira: number | null; itens: ItemMetrica[] } {
  let concluido = 0; let primeira = 0; let conhecidas = 0;
  const feitos: ItemMetrica[] = [];
  for (const i of itens) {
    const p = i.participacoes.find((x) => x.sprint_id === sprint.id && !x.removido_em);
    if (!p || i.pontos === null || !i.concluida_em) continue;
    const d = diaDe(i.concluida_em);
    if (d < sprint.inicio || d > sprint.fim) continue;
    concluido += i.pontos;
    feitos.push(i);
    if (i.situacao === "primeira") { primeira += i.pontos; conhecidas++; } else if (i.situacao === "retrabalho") conhecidas++;
  }
  return { concluido, de_primeira: feitos.length > 0 && conhecidas === 0 ? null : primeira, itens: feitos };
}

export function calcularVelocidade(sprintsFechadas: readonly SprintAgil[], itens: readonly ItemMetrica[]): PontoVelocidade[] {
  const ord = [...sprintsFechadas].sort((a, b) => a.fim.localeCompare(b.fim) || a.id.localeCompare(b.id));
  const vs: number[] = [];
  return ord.map((s, idx) => {
    const r = pontosConcluidosNaSprint(s, itens);
    vs.push(r.concluido);
    return { sprint_id: s.id, nome: s.nome, compromisso: s.compromisso_pontos, concluido: r.concluido, de_primeira: r.de_primeira, media_movel_3: idx >= 2 ? arredondar(media(vs.slice(-3)) as number) : null };
  });
}
