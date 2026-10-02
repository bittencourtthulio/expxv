// Derivador (c): uma skill do método disparada SEM Maestro (o dono digitou `/expx:runx …` num terminal) -> `Progresso`. PURO.
// A lista de etapas é a sequência CONHECIDA da skill (catálogo do Maestro): `previsto: true` e o painel rotula "etapas previstas". O que é medido vem de duas fontes:
// o estágio que o rastro/disco acusa (`estagio`) e o sinal de atividade da sessão (`atividade`). Skill sem lista conhecida: um único item "Executando <skill>…".
import type { AtividadeTerminal } from "../../compartilhado/terminais";
import { cortarRotulo, type EstadoItemProgresso, type ItemProgresso, type Progresso, type ResultadoProgresso } from "../../compartilhado/progresso";
import { ETAPAS, type EtapaDef } from "../maestro/etapas/catalogo";

export interface SkillObservada {
  workspace_id: string;
  /** nome como digitado: `runx`, `sprintx-executar` (com ou sem o prefixo `/expx:`). */
  skill: string;
  /** distingue execuções da mesma skill (id do trabalho, do Pane…). */
  chave: string;
  iniciada_em: number;
  /** estágio que o rastro ou o disco acusam (`f3`, `e2`, `p25`…); `null` = ainda nenhum evento. */
  estagio?: string | null;
  /** último sinal de atividade da sessão (trabalhando/aguardando/pronto). */
  atividade?: AtividadeTerminal | null;
  /** a skill terminou (rastro indicou o fim, a sessão ficou pronta ou foi encerrada). */
  fim_em?: number | null;
  /** como terminou. */
  resultado?: "ok" | "falha" | null;
  sessao_id?: string | null;
}

/** `/expx:runx-causa`, `expx:runx-causa` e `runx-causa` viram `runx-causa`. */
export const nomeDaSkill = (texto: string): string => texto.trim().replace(/^\/?(?:expx:)?/, "").replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 41);

const FAMILIAS_SEM_LISTA = new Set(["consulta", "rapido"]);
const etapasDaFamilia = (familia: string): readonly EtapaDef[] => (FAMILIAS_SEM_LISTA.has(familia) ? [] : ETAPAS.filter((e) => e.skill === familia));

export interface ListaConhecida {
  familia: string;
  etapas: readonly EtapaDef[];
  /** `true` = skill-roteador (família inteira); `false` = uma etapa só (sub-skill). */
  completa: boolean;
}

/** A sequência conhecida de uma skill, ou `null` quando o catálogo não sabe. */
export function listaConhecida(skill: string): ListaConhecida | null {
  const nome = nomeDaSkill(skill);
  const familia = etapasDaFamilia(nome);
  if (familia.length >= 2) return { familia: nome, etapas: familia, completa: true };
  const etapa = ETAPAS.find((e) => e.comando === nome);
  return etapa === undefined ? null : { familia: etapa.skill, etapas: [etapa], completa: false };
}

const indiceDoEstagio = (lista: ListaConhecida, estagio: string | null | undefined): number => {
  if (estagio === null || estagio === undefined || estagio === "" || !lista.completa) return -1;
  const e = estagio.toLowerCase();
  const exato = lista.etapas.findIndex((x) => x.id === `${lista.familia}.${e}`);
  return exato !== -1 ? exato : lista.etapas.findIndex((x) => x.id.endsWith(`.${e}`));
};

export function derivarDaSkill(s: SkillObservada): Progresso {
  const nome = nomeDaSkill(s.skill);
  const lista = listaConhecida(nome);
  const terminou = s.fim_em !== null && s.fim_em !== undefined;
  const falhou = terminou && s.resultado === "falha";
  const aguardando = !terminou && s.atividade === "aguardando";
  let itens: ItemProgresso[];
  let previsto = false;
  if (lista === null) {
    itens = [{ id: nome, rotulo: cortarRotulo(`Executando ${nome}…`), estado: "em_andamento" }];
  } else {
    previsto = lista.completa;
    const marcado = indiceDoEstagio(lista, s.estagio);
    const atual = marcado === -1 ? 0 : marcado;
    itens = lista.etapas.map((e, i): ItemProgresso => {
      let estado: EstadoItemProgresso;
      if (terminou) estado = falhou ? (i < atual ? "concluido" : i === atual ? "falhou" : "pendente") : "concluido";
      else estado = i < atual ? "concluido" : i === atual ? (aguardando ? "aguardando" : "em_andamento") : "pendente";
      const item: ItemProgresso = { id: e.id, rotulo: cortarRotulo(e.nome), estado };
      if (i === atual && !terminou && estado === "em_andamento") {
        item.desde = s.iniciada_em;
        if (marcado === -1 && lista.completa) item.detalhe = "prevista";
      } else if (i === atual && estado === "aguardando") item.detalhe = e.humano ? "aguardando você" : "responda no terminal";
      if (s.sessao_id !== undefined && s.sessao_id !== null && i === atual) item.sessao_id = s.sessao_id;
      return item;
    });
  }
  if (lista === null && terminou) itens = itens.map((i) => ({ ...i, estado: falhou ? "falhou" : "concluido", rotulo: cortarRotulo(`Executou ${nome}`) }));
  else if (lista === null && aguardando) itens = itens.map((i) => ({ ...i, estado: "aguardando", detalhe: "responda no terminal" }));
  if (lista === null && s.sessao_id !== undefined && s.sessao_id !== null) itens = itens.map((i) => ({ ...i, sessao_id: s.sessao_id ?? null }));
  const resultado: ResultadoProgresso = terminou ? (falhou ? "falhou" : "concluido") : aguardando ? "aguardando" : "em_andamento";
  return {
    id: `sk:${nome}:${s.chave}`,
    origem: "skill",
    titulo: `/expx:${nome}`,
    itens,
    concluido: resultado === "concluido",
    workspace_id: s.workspace_id,
    resultado,
    previsto,
    iniciado_em: s.iniciada_em,
    fim_em: terminou ? (s.fim_em ?? null) : null,
  };
}
