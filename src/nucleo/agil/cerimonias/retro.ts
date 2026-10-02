// T-18.28: retrospectiva. Formatos começar/parar/continuar (padrão) e 4Ls; itens com votos; ações com dono/prazo/estado; ação vira item `origem='retro'` no backlog;
// ação vencida publica `acao_retro.vencida` UMA vez.
import type { ItemAgil } from "../../../compartilhado/agil";
import { criarItem } from "../backlog/itens";
import { invalido, naoEncontrado, regraViolada } from "../erros";
import { novoEvento, type Publicador } from "../eventos";
import type { BancoAgil, CerimoniaRegistro, RetroAcao, RetroItem } from "../repos";
import { isoDe, truncar, type GeradorId, type Relogio } from "../util";
import type { Insights } from "./insights";

export type FormatoRetro = "comecar_parar_continuar" | "4ls";
export const COLUNAS: Record<FormatoRetro, string[]> = { comecar_parar_continuar: ["comecar", "parar", "continuar"], "4ls": ["gostei", "aprendi", "faltou", "desejei"] };
export interface DepsRetro { banco: BancoAgil; relogio: Relogio; id: GeradorId; pub?: Publicador }

export function criarRetro(d: DepsRetro, p: { workspace_id: string; sprint_id: string | null; formato?: FormatoRetro; insights: Insights | null; data: string }): CerimoniaRegistro {
  const formato = p.formato ?? "comecar_parar_continuar";
  if (!(formato in COLUNAS)) throw invalido("formato de retro inválido");
  const agora = isoDe(d.relogio());
  const c: CerimoniaRegistro = { id: d.id("cer"), workspace_id: p.workspace_id, sprint_id: p.sprint_id, tipo: "retro", data: p.data, formato, conteudo: { colunas: COLUNAS[formato], insights: p.insights }, gerada_de_fatos_em: agora, editada: false, criado_em: agora, atualizado_em: agora };
  d.banco.cerimonias.set(c.id, c);
  return c;
}

export function adicionarItemRetro(d: DepsRetro, cerimoniaId: string, coluna: string, texto: string, dado: unknown = null, autor: string | null = null): RetroItem {
  const c = d.banco.cerimonias.get(cerimoniaId);
  if (!c || c.tipo !== "retro") throw naoEncontrado(`retro ${cerimoniaId}`);
  const colunas = (c.conteudo as { colunas: string[] }).colunas;
  if (!colunas.includes(coluna)) throw invalido(`coluna inválida: ${coluna}`);
  if (!texto.trim()) throw invalido("texto obrigatório");
  const it: RetroItem = { id: d.id("rti"), cerimonia_id: cerimoniaId, coluna, texto: truncar(texto.trim(), 400), votos: 0, dado, autor_membro_id: autor, criado_em: isoDe(d.relogio()) };
  d.banco.retroItens.set(it.id, it);
  d.banco.cerimonias.set(c.id, { ...c, editada: true, atualizado_em: it.criado_em });
  return it;
}

export function votarRetro(d: DepsRetro, itemId: string, delta: 1 | -1 = 1): RetroItem {
  const it = d.banco.retroItens.get(itemId);
  if (!it) throw naoEncontrado(`item de retro ${itemId}`);
  const n = { ...it, votos: Math.max(0, it.votos + delta) };
  d.banco.retroItens.set(itemId, n);
  return n;
}

export function criarAcao(d: DepsRetro, cerimoniaId: string, texto: string, donoMembroId: string | null, prazo: string | null): RetroAcao {
  if (!d.banco.cerimonias.get(cerimoniaId)) throw naoEncontrado(`retro ${cerimoniaId}`);
  if (!texto.trim()) throw invalido("texto da ação obrigatório");
  if (prazo !== null && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) throw invalido("prazo deve ser AAAA-MM-DD");
  const a: RetroAcao = { id: d.id("rta"), cerimonia_id: cerimoniaId, texto: truncar(texto.trim(), 400), dono_membro_id: donoMembroId, prazo, estado: "aberta", item_id: null, concluida_em: null, criado_em: isoDe(d.relogio()), vencida_notificada: false };
  d.banco.retroAcoes.set(a.id, a);
  return a;
}

export function atualizarAcao(d: DepsRetro, id: string, estado: RetroAcao["estado"]): RetroAcao {
  const a = d.banco.retroAcoes.get(id);
  if (!a) throw naoEncontrado(`ação ${id}`);
  const n = { ...a, estado, concluida_em: estado === "feita" ? isoDe(d.relogio()) : null };
  d.banco.retroAcoes.set(id, n);
  return n;
}

/** cria o item no backlog (origem `retro`) a partir da ação; só uma vez por ação. */
export function acaoParaItem(d: DepsRetro, acaoId: string): ItemAgil {
  const a = d.banco.retroAcoes.get(acaoId);
  if (!a) throw naoEncontrado(`ação ${acaoId}`);
  if (a.item_id) throw regraViolada("ação já virou item");
  const c = d.banco.cerimonias.get(a.cerimonia_id);
  const item = criarItem(d, { workspace_id: c?.workspace_id ?? "", origem: "retro", titulo: a.texto });
  d.banco.retroAcoes.set(a.id, { ...a, item_id: item.id });
  return item;
}

/** publica `acao_retro.vencida` para ações abertas com prazo < hoje, uma vez cada. */
export function publicarAcoesVencidas(d: DepsRetro, workspaceId: string, hoje: string): RetroAcao[] {
  const novas: RetroAcao[] = [];
  for (const a of d.banco.retroAcoes.valores()) {
    const c = d.banco.cerimonias.get(a.cerimonia_id);
    if (!c || c.workspace_id !== workspaceId || a.estado !== "aberta" || a.vencida_notificada || a.prazo === null || a.prazo >= hoje) continue;
    d.banco.retroAcoes.set(a.id, { ...a, vencida_notificada: true });
    d.pub?.publicar(novoEvento("acao_retro.vencida", workspaceId, d.relogio, { sprint_id: c.sprint_id, dados: { acao_id: a.id, prazo: a.prazo } }));
    novas.push(a);
  }
  return novas;
}
