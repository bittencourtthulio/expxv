// T-18.27: review (demo). Só itens CONCLUÍDOS da sprint; resultado por item `aceito|ajustar|rejeitado`; `ajustar/rejeitar` pode devolver item ao backlog (ação humana).
import type { ConfigAgil } from "../../../compartilhado/agil";
import { avaliarDoD, type ResultadoCriterio } from "../backlog/dod";
import { invalido, naoEncontrado, regraViolada } from "../erros";
import type { ItemMetrica } from "../metricas/dados";
import type { BancoAgil, DemoRegistro } from "../repos";
import { itensDaSprint } from "../sprint/ciclo";
import { isoDe, type GeradorId, type Relogio } from "../util";

export interface ItemReview { item_id: string; titulo: string; pontos: number | null; criterios: string[]; commits: number; dod: ResultadoCriterio[]; demo: DemoRegistro | null }

export function montarReview(banco: BancoAgil, config: Pick<ConfigAgil, "dod">, sprintId: string, itens: readonly ItemMetrica[], contexto: (i: ItemMetrica) => { qa_aprovado: boolean | null; regras_violadas_abertas: number | null }): ItemReview[] {
  const s = banco.sprints.get(sprintId);
  if (!s) throw naoEncontrado(`sprint ${sprintId}`);
  const porId = new Map(itens.map((i) => [i.item_id, i]));
  const out: ItemReview[] = [];
  for (const x of itensDaSprint(banco, sprintId)) {
    if (x.removido_em) continue;
    const i = porId.get(x.item_id);
    const it = banco.itens.get(x.item_id);
    if (!i || !it || !i.concluida_em) continue;
    const fato = i.trabalho_id && i.task_ref ? banco.fatos.get(`${s.workspace_id}|${i.trabalho_id}|${i.task_ref}`) ?? null : null;
    const manuais = new Map(banco.dodResultados.valores().filter((r) => r.item_id === i.item_id).map((r) => [r.criterio, r]));
    out.push({ item_id: i.item_id, titulo: i.titulo, pontos: i.pontos, criterios: it.criterios, commits: fato?.commits.length ?? 0, dod: avaliarDoD({ fato, categoria: i.categoria, ...contexto(i) }, config, manuais), demo: banco.demos.get(`${sprintId}|${i.item_id}`) ?? null });
  }
  return out;
}

export function registrarDemo(d: { banco: BancoAgil; relogio: Relogio }, sprintId: string, itemId: string, resultado: DemoRegistro["resultado"], nota: string | null, ator: "humano" | "agente" = "humano"): DemoRegistro {
  if (ator !== "humano") throw regraViolada("resultado da demo é decisão humana", "human_only");
  if (!["aceito", "ajustar", "rejeitado"].includes(resultado)) throw invalido("resultado inválido");
  const x = itensDaSprint(d.banco, sprintId).find((s) => s.item_id === itemId && !s.removido_em);
  if (!x) throw naoEncontrado("item não está na sprint");
  const r: DemoRegistro = { sprint_id: sprintId, item_id: itemId, resultado, nota, em: isoDe(d.relogio()) };
  d.banco.demos.set(`${sprintId}|${itemId}`, r);
  return r;
}

/** `ajustar|rejeitado` pode virar item novo no backlog (ação humana); o original fica como está (sem apagar histórico). */
export function devolverAoBacklog(d: { banco: BancoAgil; relogio: Relogio; id: GeradorId }, sprintId: string, itemId: string): string {
  const demo = d.banco.demos.get(`${sprintId}|${itemId}`);
  const it = d.banco.itens.get(itemId);
  if (!demo || demo.resultado === "aceito" || !it) throw regraViolada("só itens com demo `ajustar` ou `rejeitado` voltam ao backlog");
  const agora = isoDe(d.relogio());
  const novo = { ...it, id: d.id("it"), origem: "ade" as const, trabalho_id: null, task_ref: null, titulo: `Ajustar: ${it.titulo}`.slice(0, 300), estado_ade: "backlog" as const, ordem: d.banco.itens.valores().reduce((m, x) => Math.max(m, x.ordem), 0) + 1024, orfao: false, criado_em: agora, atualizado_em: agora, descartado_motivo: null };
  d.banco.itens.set(novo.id, novo);
  return novo.id;
}
