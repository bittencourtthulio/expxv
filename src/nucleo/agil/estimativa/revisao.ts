// T-18.17: revisão humana e versões. APPEND-ONLY. A IA (ou agente) só substitui estimativa/classificação ATIVA em estado `sugerida`;
// `aceita|ajustada|travada` (decisão humana) nunca são sobrescritas. Reestimar gera NOVA versão.
import type { Classificacao, ConfigAgil, CriticidadeAgil, Estimativa, EstadoSugestao, FatorEstimativa, FatorRisco, MotorAgil, OrigemAgil, RiscoAgil } from "../../../compartilhado/agil";
import { invalido, naoEncontrado } from "../erros";
import type { BancoAgil } from "../repos";
import { isoDe, type GeradorId, type Relogio } from "../util";
import { ajustarAEscala, escalaDe, valorDoRotulo } from "./escala";

export interface DepsRevisao { banco: BancoAgil; relogio: Relogio; id: GeradorId; config: ConfigAgil }
const DECISAO_HUMANA: ReadonlySet<EstadoSugestao> = new Set(["aceita", "ajustada", "travada"]);

export const estimativaAtiva = (banco: BancoAgil, itemId: string): Estimativa | null => banco.estimativas.valores().filter((e) => e.item_id === itemId && e.ativa).sort((a, b) => b.versao - a.versao)[0] ?? null;
export const classificacaoAtiva = (banco: BancoAgil, itemId: string): Classificacao | null => banco.classificacoes.valores().filter((e) => e.item_id === itemId && e.ativa).sort((a, b) => b.versao - a.versao)[0] ?? null;
export const historicoEstimativas = (banco: BancoAgil, itemId: string): Estimativa[] => banco.estimativas.valores().filter((e) => e.item_id === itemId).sort((a, b) => a.versao - b.versao);

export interface SugestaoEstimativa {
  item_id: string; pontos: number; origem: OrigemAgil; motor: MotorAgil; confianca: number | null; fatores: FatorEstimativa[]; min_h: number | null; max_h: number | null; nota: string | null;
}
export interface SugestaoClassificacao {
  item_id: string; categoria: string; risco: RiscoAgil; criticidade: CriticidadeAgil; tipo_task: string | null; risco_fatores: FatorRisco[]; motor: MotorAgil; confianca: number | null;
}
type BaseEstimativa = Omit<Estimativa, "id" | "versao" | "ativa" | "criado_em">;

function novaEstimativa(d: DepsRevisao, base: BaseEstimativa): Estimativa {
  const antigas = historicoEstimativas(d.banco, base.item_id);
  for (const a of antigas) if (a.ativa) d.banco.estimativas.set(a.id, { ...a, ativa: false });
  const nova: Estimativa = { ...base, id: d.id("est"), versao: (antigas[antigas.length - 1]?.versao ?? 0) + 1, ativa: true, criado_em: isoDe(d.relogio()) };
  d.banco.estimativas.set(nova.id, nova);
  return nova;
}

/** IA/agente propõe: só entra se não houver decisão humana ativa. */
export function proporEstimativa(d: DepsRevisao, s: SugestaoEstimativa): { aplicada: boolean; estimativa: Estimativa | null; motivo: "humano_prevalece" | null } {
  if (!d.banco.itens.get(s.item_id)) throw naoEncontrado(`item ${s.item_id}`);
  const atual = estimativaAtiva(d.banco, s.item_id);
  if (atual && (atual.origem === "humano" || DECISAO_HUMANA.has(atual.estado))) return { aplicada: false, estimativa: atual, motivo: "humano_prevalece" };
  const escala = escalaDe(d.config);
  const aj = ajustarAEscala(s.pontos, escala);
  const est = d.banco.transacao(() => novaEstimativa(d, {
    item_id: s.item_id, pontos: aj.valor, rotulo: aj.rotulo, escala_id: escala.id, min_h: s.min_h, max_h: s.max_h, origem: "ia", motor: s.motor,
    confianca: s.confianca, fatores: s.fatores, estado: "sugerida", nota: s.nota,
  }));
  return { aplicada: true, estimativa: est, motivo: null };
}

function gravarClassificacao(d: DepsRevisao, s: SugestaoClassificacao & { origem: OrigemAgil; estado: EstadoSugestao }): Classificacao {
  const todas = d.banco.classificacoes.valores().filter((c) => c.item_id === s.item_id).sort((a, b) => a.versao - b.versao);
  for (const a of todas) if (a.ativa) d.banco.classificacoes.set(a.id, { ...a, ativa: false });
  const nova: Classificacao = {
    id: d.id("cls"), item_id: s.item_id, versao: (todas[todas.length - 1]?.versao ?? 0) + 1, categoria: s.categoria, risco: s.risco, criticidade: s.criticidade,
    tipo_task: s.tipo_task, risco_fatores: s.risco_fatores, origem: s.origem, motor: s.motor, confianca: s.confianca, estado: s.estado, ativa: true, criado_em: isoDe(d.relogio()),
  };
  d.banco.classificacoes.set(nova.id, nova);
  return nova;
}

export function proporClassificacao(d: DepsRevisao, s: SugestaoClassificacao): { aplicada: boolean; classificacao: Classificacao | null } {
  if (!d.banco.itens.get(s.item_id)) throw naoEncontrado(`item ${s.item_id}`);
  const atual = classificacaoAtiva(d.banco, s.item_id);
  if (atual && (atual.origem === "humano" || DECISAO_HUMANA.has(atual.estado))) return { aplicada: false, classificacao: atual };
  const c = d.banco.transacao(() => gravarClassificacao(d, { ...s, origem: "ia", estado: "sugerida" }));
  return { aplicada: true, classificacao: c };
}

const baseDe = (e: Estimativa, estado: EstadoSugestao, nota: string | null): BaseEstimativa => ({
  item_id: e.item_id, pontos: e.pontos, rotulo: e.rotulo, escala_id: e.escala_id, min_h: e.min_h, max_h: e.max_h, origem: e.origem, motor: e.motor,
  confianca: e.confianca, fatores: e.fatores, estado, nota,
});

export interface EdicaoHumanaEstimativa { item_id: string; pontos?: number; rotulo?: string; estado?: "aceita" | "ajustada" | "travada"; nota?: string | null }
/** ação humana (origem `humano`). Sem `pontos`/`rotulo` aceita o valor ativo (mantém a origem da sugestão). */
export function gravarEstimativaHumana(d: DepsRevisao, e: EdicaoHumanaEstimativa): { estimativa: Estimativa; ajustado_a_escala: boolean } {
  if (!d.banco.itens.get(e.item_id)) throw naoEncontrado(`item ${e.item_id}`);
  const atual = estimativaAtiva(d.banco, e.item_id);
  const escala = escalaDe(d.config);
  let pontos: number | null = e.pontos ?? null;
  if (pontos === null && e.rotulo !== undefined) {
    pontos = valorDoRotulo(e.rotulo, escala);
    if (pontos === null) throw invalido(`rótulo "${e.rotulo}" não existe na escala ${escala.id}`);
  }
  if (pontos === null) {
    if (!atual || atual.pontos === null) throw invalido("informe pontos ou rótulo");
    return { estimativa: d.banco.transacao(() => novaEstimativa(d, baseDe(atual, e.estado ?? "aceita", e.nota ?? atual.nota))), ajustado_a_escala: false };
  }
  const aj = ajustarAEscala(pontos, escala);
  const igual = atual?.pontos === aj.valor;
  const est = d.banco.transacao(() => novaEstimativa(d, {
    item_id: e.item_id, pontos: aj.valor, rotulo: aj.rotulo, escala_id: escala.id, min_h: null, max_h: null, origem: "humano", motor: "manual", confianca: 1,
    fatores: igual && atual ? atual.fatores : [], estado: e.estado ?? (igual ? "aceita" : "ajustada"), nota: e.nota ?? null,
  }));
  return { estimativa: est, ajustado_a_escala: aj.ajustado };
}

export interface EdicaoHumanaClassificacao { item_id: string; categoria?: string; risco?: RiscoAgil; criticidade?: CriticidadeAgil; estado?: "aceita" | "ajustada" | "travada" }
export function gravarClassificacaoHumana(d: DepsRevisao, e: EdicaoHumanaClassificacao): Classificacao {
  const atual = classificacaoAtiva(d.banco, e.item_id);
  if (!atual) throw naoEncontrado("classificação ativa");
  if (e.categoria !== undefined && !d.config.categorias.includes(e.categoria)) throw invalido(`categoria "${e.categoria}" fora da configuração`);
  const mudou = (e.categoria !== undefined && e.categoria !== atual.categoria) || (e.risco !== undefined && e.risco !== atual.risco) || (e.criticidade !== undefined && e.criticidade !== atual.criticidade);
  return d.banco.transacao(() => gravarClassificacao(d, {
    item_id: e.item_id, categoria: e.categoria ?? atual.categoria, risco: e.risco ?? atual.risco, criticidade: e.criticidade ?? atual.criticidade, tipo_task: atual.tipo_task,
    risco_fatores: atual.risco_fatores, motor: mudou ? "manual" : atual.motor, confianca: mudou ? 1 : atual.confianca, origem: mudou ? "humano" : atual.origem, estado: e.estado ?? (mudou ? "ajustada" : "aceita"),
  }));
}

/** aceita em lote as `sugerida` com confiança >= mínimo; devolve quantas sobraram para revisão. Nunca toca decisão humana. */
export function aceitarEmLote(d: DepsRevisao, itemIds: readonly string[], confiancaMin: number = d.config.confianca_aceite_lote): { aceitas: number; restantes: number; restantes_ids: string[] } {
  let aceitas = 0;
  const restantes_ids: string[] = [];
  d.banco.transacao(() => {
    for (const id of itemIds) {
      const a = estimativaAtiva(d.banco, id);
      if (!a || a.estado !== "sugerida") continue;
      if ((a.confianca ?? 0) >= confiancaMin) { novaEstimativa(d, baseDe(a, "aceita", a.nota)); aceitas++; }
      else restantes_ids.push(id);
    }
  });
  return { aceitas, restantes: restantes_ids.length, restantes_ids };
}
