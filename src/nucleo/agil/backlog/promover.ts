// T-18.11: promoção para o método. O ADE só GERA o comando (para `metodo:disparar`) — nunca dispara sozinho (D-20/D-21). O vínculo com o trabalho que apareceu
// é SUGERIDO por similaridade de título e só vale por ação humana (desfazível sem perder histórico).
import type { ItemAgil } from "../../../compartilhado/agil";
import { invalido, naoEncontrado } from "../erros";
import type { BancoAgil } from "../repos";
import { isoDe, jaccard, truncar, type Relogio } from "../util";

export type DestinoPromocao = "prodx" | "sprintx" | "runx";
const COMANDO: Record<DestinoPromocao, string> = { prodx: "/expx:prodx-triar", sprintx: "/expx:sprintx", runx: "/expx:runx" };

/** argumento numa linha, sem controle nem crases/$, até 500 caracteres: é digitado num terminal real. */
export function argumentoSeguro(t: string): string {
  return truncar(t.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[`$\\]/g, "").replace(/\s+/g, " ").trim(), 500);
}

export function comandoDePromocao(item: Pick<ItemAgil, "titulo" | "descricao" | "origem">, destino: DestinoPromocao): string {
  if (!(destino in COMANDO)) throw invalido(`destino inválido: ${destino}`);
  if (item.origem === "metodo") throw invalido("item já vem do método");
  const arg = argumentoSeguro(item.descricao ? `${item.titulo}: ${item.descricao}` : item.titulo);
  if (!arg) throw invalido("item sem texto para promover");
  return `${COMANDO[destino]} ${arg}`;
}

export interface TrabalhoCandidato { id: string; titulo: string }
export function sugerirVinculos(item: Pick<ItemAgil, "titulo" | "trabalho_id">, trabalhos: readonly TrabalhoCandidato[], jaVinculados: ReadonlySet<string>, limiar = 0.5): { trabalho_id: string; titulo: string; similaridade: number }[] {
  if (item.trabalho_id) return [];
  return trabalhos
    .filter((t) => !jaVinculados.has(t.id))
    .map((t) => ({ trabalho_id: t.id, titulo: t.titulo, similaridade: Math.round(jaccard(item.titulo, t.titulo) * 1000) / 1000 }))
    .filter((s) => s.similaridade >= limiar)
    .sort((a, b) => b.similaridade - a.similaridade || a.trabalho_id.localeCompare(b.trabalho_id));
}

/** vínculo humano; `trabalho_id = null` desfaz (o histórico de estimativa/retrabalho do item permanece). */
export function vincularItem(d: { banco: BancoAgil; relogio: Relogio }, itemId: string, trabalhoId: string | null, taskRef: string | null = null): ItemAgil {
  const it = d.banco.itens.get(itemId);
  if (!it) throw naoEncontrado(`item ${itemId}`);
  if (it.origem === "metodo") throw invalido("item espelho já tem vínculo fixo com a task");
  const novo = { ...it, trabalho_id: trabalhoId, task_ref: trabalhoId ? taskRef : null, atualizado_em: isoDe(d.relogio()) };
  d.banco.itens.set(itemId, novo);
  return novo;
}
