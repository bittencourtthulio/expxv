// T-18.38: eventos de domínio da gestão ágil (D-188) para as Fases 19 e 20. O publicador PERSISTE (barramento) e avisa a PortaAlertas; porta ausente ou que lança
// nunca quebra nada. "Atrasada" = em andamento com idade acima do P85 do ciclo de tasks COMPARÁVEIS (>= 8 amostras; senão "sem base" e NÃO dispara).
import type { EventoAgil, TipoEventoAgil } from "../../compartilhado/agil";
import type { ItemMetrica } from "./metricas/dados";
import type { PortaAlertas } from "./portas";
import type { BancoAgil } from "./repos";
import { isoDe, ordenar, percentilOrdenado, type Relogio } from "./util";

export interface Publicador { publicar(ev: EventoAgil): void }

export function criarPublicador(banco: BancoAgil, alertas: PortaAlertas): Publicador {
  return {
    publicar(ev) {
      const seq = banco.eventos.valores().length + 1;
      banco.eventos.set(String(seq), { ...ev, seq });
      try {
        const r = alertas.publicar(ev);
        if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => undefined);
      } catch { /* alerta nunca derruba o fluxo */ }
    },
  };
}
export const publicadorNulo: Publicador = { publicar: () => undefined };

export function novoEvento(tipo: TipoEventoAgil, ws: string, relogio: Relogio, p: Partial<Omit<EventoAgil, "tipo" | "workspace_id" | "quando">> = {}): EventoAgil {
  return {
    tipo, workspace_id: ws, sprint_id: p.sprint_id ?? null, trabalho_id: p.trabalho_id ?? null, task_ref: p.task_ref ?? null, pontos: p.pontos ?? null,
    duracao_observada_ms: p.duracao_observada_ms ?? null, tokens: p.tokens ?? null, quando: isoDe(relogio()), dados: p.dados ?? {},
  };
}

export const jaPublicado = (banco: BancoAgil, tipo: TipoEventoAgil, sprintId: string): boolean => banco.eventos.valores().some((e) => e.tipo === tipo && e.sprint_id === sprintId);

/** episódios: devolve só o que ABRIU agora (novos) e o que FECHOU; o chamador guarda `atuais` para a próxima rodada. */
export function atualizarEpisodios(antes: ReadonlySet<string>, atuais: ReadonlySet<string>): { novos: string[]; fechados: string[] } {
  return { novos: [...atuais].filter((k) => !antes.has(k)).sort(), fechados: [...antes].filter((k) => !atuais.has(k)).sort() };
}

export interface ResultadoAtrasos { sem_base: boolean; limite_ms: number | null; atrasadas: { item: ItemMetrica; idade_ms: number }[] }
export function detectarAtrasadas(itens: readonly ItemMetrica[], agora: number, minimo = 8): ResultadoAtrasos {
  const concl = itens.filter((i) => i.concluida_em && i.duracao_obs_ms !== null && i.duracao_obs_ms > 0);
  const abertas = itens.filter((i) => i.estado_fluxo === "em_andamento");
  const porCategoria = new Map<string | null, number[]>();
  for (const i of concl) (porCategoria.get(i.categoria) ?? porCategoria.set(i.categoria, []).get(i.categoria))?.push(i.duracao_obs_ms as number);
  const todos = concl.map((i) => i.duracao_obs_ms as number);
  const cache = new Map<string | null, number | null>();
  const limitePara = (cat: string | null): number | null => {
    if (cache.has(cat)) return cache.get(cat) ?? null;
    const mesma = cat !== null ? porCategoria.get(cat) ?? [] : [];
    const base = mesma.length >= minimo ? mesma : todos.length >= minimo ? todos : null;
    const v = base ? percentilOrdenado(ordenar(base), 85) : null;
    cache.set(cat, v);
    return v;
  };
  const res: ResultadoAtrasos = { sem_base: concl.length < minimo, limite_ms: limitePara(null), atrasadas: [] };
  for (const i of abertas) {
    const lim = limitePara(i.categoria);
    const aberto = i.intervalos.find(([, b]) => b === null);
    const ini = Date.parse(aberto?.[0] ?? i.iniciada_em ?? "");
    if (lim === null || Number.isNaN(ini)) continue;
    const idade = agora - ini;
    if (idade > lim) res.atrasadas.push({ item: i, idade_ms: idade });
  }
  return res;
}

export function eventosDeAtraso(ws: string, relogio: Relogio, r: ResultadoAtrasos, abertosAntes: ReadonlySet<string>): { eventos: EventoAgil[]; abertos: Set<string> } {
  const atuais = new Set(r.atrasadas.map((a) => a.item.ref));
  const { novos } = atualizarEpisodios(abertosAntes, atuais);
  const eventos = r.atrasadas.filter((a) => novos.includes(a.item.ref)).map((a) => novoEvento("tarefa.atrasada", ws, relogio, {
    trabalho_id: a.item.trabalho_id, task_ref: a.item.task_ref, pontos: a.item.pontos, duracao_observada_ms: a.idade_ms, tokens: null, dados: { limite_p85_ms: r.limite_ms },
  }));
  return { eventos, abertos: atuais };
}
