// T-18.24: ciclo de vida da sprint ágil (D-181): planejada -> ativa -> fechada/cancelada. Compromisso inicial CONGELADO ao iniciar; remover item mantém o histórico;
// no máximo uma sprint ativa por workspace; adicionar/remover com sprint ativa exige motivo.
import type { SprintAgil, SprintItemAgil } from "../../../compartilhado/agil";
import { apenasHumano, invalido, naoEncontrado, regraViolada } from "../erros";
import { novoEvento, publicadorNulo, type Publicador } from "../eventos";
import { estimativaAtiva } from "../estimativa/revisao";
import { chaveSprintItem, type BancoAgil } from "../repos";
import { isoDe, type GeradorId, type Relogio } from "../util";

export interface DepsSprint { banco: BancoAgil; relogio: Relogio; id: GeradorId; pub?: Publicador }
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function criarSprint(d: DepsSprint, n: { workspace_id: string; nome: string; meta?: string | null; inicio: string; fim: string; capacidade_pontos?: number | null }): SprintAgil {
  if (!n.nome.trim()) throw invalido("nome da sprint obrigatório");
  if (!DATA.test(n.inicio) || !DATA.test(n.fim) || n.inicio > n.fim) throw invalido("datas inválidas (AAAA-MM-DD, início <= fim)");
  const agora = isoDe(d.relogio());
  const s: SprintAgil = {
    id: d.id("spr"), workspace_id: n.workspace_id, nome: n.nome.trim(), meta: n.meta ?? null, inicio: n.inicio, fim: n.fim, estado: "planejada",
    capacidade_pontos: n.capacidade_pontos ?? null, compromisso_pontos: null, iniciada_em: null, fechada_em: null, versao_lancamento: null, resumo_fechamento: null, criado_em: agora, atualizado_em: agora,
  };
  d.banco.sprints.set(s.id, s);
  return s;
}

const obter = (d: DepsSprint, id: string): SprintAgil => {
  const s = d.banco.sprints.get(id);
  if (!s) throw naoEncontrado(`sprint ${id}`);
  return s;
};

export function atualizarSprint(d: DepsSprint, id: string, e: Partial<Pick<SprintAgil, "nome" | "meta" | "inicio" | "fim" | "capacidade_pontos">>): SprintAgil {
  const s = obter(d, id);
  if (s.estado === "fechada" || s.estado === "cancelada") throw regraViolada("sprint encerrada não pode ser alterada");
  if (s.estado === "ativa" && e.inicio !== undefined && e.inicio !== s.inicio) throw regraViolada("início de sprint ativa é imutável");
  const novo = { ...s, ...e, atualizado_em: isoDe(d.relogio()) };
  if (!DATA.test(novo.inicio) || !DATA.test(novo.fim) || novo.inicio > novo.fim) throw invalido("datas inválidas");
  d.banco.sprints.set(id, novo);
  return novo;
}

export const itensDaSprint = (banco: BancoAgil, sprintId: string): SprintItemAgil[] => banco.sprintItens.valores().filter((x) => x.sprint_id === sprintId);

export function adicionarItem(d: DepsSprint, sprintId: string, itemId: string, motivo: string | null = null): SprintItemAgil {
  const s = obter(d, sprintId);
  const it = d.banco.itens.get(itemId);
  if (!it) throw naoEncontrado(`item ${itemId}`);
  if (s.estado === "fechada" || s.estado === "cancelada") throw regraViolada("sprint encerrada não aceita itens");
  if (it.estado_ade === "descartado") throw regraViolada("item descartado");
  if (s.estado === "ativa" && (!motivo || motivo.trim().length < 3)) throw invalido("adicionar a uma sprint ativa exige motivo");
  for (const x of d.banco.sprintItens.valores()) {
    if (x.item_id !== itemId || x.removido_em || x.sprint_id === sprintId) continue;
    const outra = d.banco.sprints.get(x.sprint_id);
    if (outra && (outra.estado === "planejada" || outra.estado === "ativa")) throw regraViolada(`item já está na sprint ${outra.nome}`);
  }
  const k = chaveSprintItem(sprintId, itemId);
  const ant = d.banco.sprintItens.get(k);
  if (ant && !ant.removido_em) return ant;
  const e = estimativaAtiva(d.banco, itemId);
  const si: SprintItemAgil = { sprint_id: sprintId, item_id: itemId, adicionado_em: isoDe(d.relogio()), removido_em: null, pontos_compromisso: e?.pontos ?? null, no_compromisso_inicial: s.estado === "planejada", motivo: motivo?.trim() ?? null, resultado: null };
  d.banco.sprintItens.set(k, si);
  return si;
}

export function removerItem(d: DepsSprint, sprintId: string, itemId: string, motivo: string | null = null): SprintItemAgil {
  const s = obter(d, sprintId);
  const k = chaveSprintItem(sprintId, itemId);
  const si = d.banco.sprintItens.get(k);
  if (!si || si.removido_em) throw naoEncontrado("item não está na sprint");
  if (s.estado === "fechada" || s.estado === "cancelada") throw regraViolada("sprint encerrada");
  if (s.estado === "ativa" && (!motivo || motivo.trim().length < 3)) throw invalido("remover de uma sprint ativa exige motivo");
  const novo = { ...si, removido_em: isoDe(d.relogio()), motivo: motivo?.trim() ?? si.motivo };
  d.banco.sprintItens.set(k, novo);
  return novo;
}

/** inicia: congela o compromisso inicial (Σ pontos_compromisso dos itens do planejamento). Ação humana. */
export function iniciarSprint(d: DepsSprint, sprintId: string, ator: "humano" | "agente" = "humano"): SprintAgil {
  if (ator !== "humano") throw apenasHumano("sprint.iniciar");
  const s = obter(d, sprintId);
  if (s.estado !== "planejada") throw regraViolada(`sprint ${s.estado} não pode ser iniciada`);
  if (d.banco.sprints.valores().some((x) => x.workspace_id === s.workspace_id && x.estado === "ativa")) throw regraViolada("já existe uma sprint ativa neste workspace");
  const novo = d.banco.transacao(() => {
    const itens = itensDaSprint(d.banco, sprintId).filter((x) => !x.removido_em);
    const total = itens.reduce((a, x) => a + (x.pontos_compromisso ?? 0), 0);
    for (const x of itens) d.banco.sprintItens.set(chaveSprintItem(sprintId, x.item_id), { ...x, no_compromisso_inicial: true });
    const n: SprintAgil = { ...s, estado: "ativa", iniciada_em: isoDe(d.relogio()), compromisso_pontos: total, atualizado_em: isoDe(d.relogio()) };
    d.banco.sprints.set(sprintId, n);
    return n;
  });
  (d.pub ?? publicadorNulo).publicar(novoEvento("sprint.iniciada", s.workspace_id, d.relogio, { sprint_id: sprintId, pontos: novo.compromisso_pontos }));
  return novo;
}

export function cancelarSprint(d: DepsSprint, sprintId: string, ator: "humano" | "agente" = "humano"): SprintAgil {
  if (ator !== "humano") throw apenasHumano("sprint.cancelar");
  const s = obter(d, sprintId);
  if (s.estado === "fechada" || s.estado === "cancelada") throw regraViolada(`sprint já ${s.estado}`);
  const n = { ...s, estado: "cancelada" as const, atualizado_em: isoDe(d.relogio()) };
  d.banco.sprints.set(sprintId, n);
  return n;
}
