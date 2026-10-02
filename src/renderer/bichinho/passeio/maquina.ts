// Máquina de estados PURA do passeio dos bichinhos (D-650): sem DOM, sem timer, testável por tabela. Quem aplica os eventos é `controle.ts`.
// no_posto → saindo → andando ⇄ fazendo_algo → deitando → dormindo → acordando → andando …; qualquer atividade/trabalho → voltando → no_posto.
import type { BichinhoVisao } from "../../../compartilhado/bichinho";

export const FASES = ["no_posto", "saindo", "andando", "fazendo_algo", "deitando", "dormindo", "acordando", "voltando"] as const;
export type Fase = (typeof FASES)[number];

export const EVENTOS = ["ocioso", "saiu", "chegou_acao", "chegou_cama", "fim_acao", "deitou", "acordar", "levantou", "atividade", "trabalho", "voltou"] as const;
export type Evento = (typeof EVENTOS)[number];

const VOLTAR: Partial<Record<Evento, Fase>> = { atividade: "voltando", trabalho: "voltando" };

/** A tabela inteira: o que cada evento faz em cada fase. Evento ausente = ignorado (a fase não muda). */
export const TABELA: Readonly<Record<Fase, Partial<Record<Evento, Fase>>>> = {
  no_posto: { ocioso: "saindo" },
  saindo: { saiu: "andando", ...VOLTAR },
  andando: { chegou_acao: "fazendo_algo", chegou_cama: "deitando", ...VOLTAR },
  fazendo_algo: { fim_acao: "andando", ...VOLTAR },
  deitando: { deitou: "dormindo", ...VOLTAR },
  dormindo: { acordar: "acordando", ...VOLTAR },
  acordando: { levantou: "andando", ...VOLTAR },
  voltando: { voltou: "no_posto" },
};

export const transicao = (fase: Fase, evento: Evento): Fase => TABELA[fase][evento] ?? fase;

/** Limite de bichinhos soltos ao mesmo tempo: passam os mais recentes (`em` maior). */
export const LIMITE_SOLTOS = 8;

export interface ContextoPasseio {
  /** preferência "Bichinhos passeiam quando ociosos". */
  ligado: boolean;
  /** preferência "Mostrar bichinhos". */
  mostrar: boolean;
  /** "Silenciar animações" ou prefers-reduced-motion: nada de passeio. */
  semMovimento: boolean;
  /** janela oculta/minimizada: pausa total. */
  oculta: boolean;
  /** o USUÁRIO está ocioso (sem mouse/teclado/foco por X minutos). */
  ocioso: boolean;
  /** segredo em curso: ignora ociosidade e trabalho (nunca o movimento reduzido). */
  forcado: boolean;
}

/** O workspace do bichinho tem agente trabalhando ou aguardando? Então ele fica no posto, reagindo ao esforço. */
export function trabalhando(v: Pick<BichinhoVisao, "humor" | "esforco"> | undefined): boolean {
  if (v === undefined) return false;
  return v.humor === "trabalhando" || v.humor === "pensando" || v.humor === "aguardando" || v.esforco.nivel > 0;
}

/** Regra de saída de UM bichinho. */
export function podePassear(c: ContextoPasseio, ocupado: boolean): boolean {
  if (c.oculta || c.semMovimento || !c.mostrar) return false;
  if (c.forcado) return true;
  return c.ligado && c.ocioso && !ocupado;
}

export interface Candidato { chave: string; em: number }

/** Só os `limite` mais recentes passeiam (desempate pela chave, estável). */
export function selecionarPasseantes(candidatos: readonly Candidato[], limite: number = LIMITE_SOLTOS): string[] {
  return [...candidatos].sort((a, b) => b.em - a.em || (a.chave < b.chave ? -1 : 1)).slice(0, limite).map((c) => c.chave);
}

// ---- ações curtas (fazendo_algo) ----
export const ACOES = ["cheirar", "olhar_em_volta", "pular", "espreguicar", "bolinha", "acenar", "borboleta", "cavar"] as const;
export type Acao = (typeof ACOES)[number] | "dancar" | "pegar" | "soltar" | "empurrar" | "cumprimentar";

/** Duração de cada ação em ms (mín, máx). */
export const DURACAO_ACAO: Readonly<Record<Acao, readonly [number, number]>> = {
  cheirar: [2_200, 3_600], olhar_em_volta: [2_200, 3_400], pular: [1_800, 2_800], espreguicar: [2_000, 3_000], bolinha: [3_200, 5_200], acenar: [1_800, 2_600],
  borboleta: [3_400, 5_400], cavar: [2_600, 4_000], dancar: [4_000, 4_000], pegar: [750, 750], soltar: [900, 900], empurrar: [900, 900], cumprimentar: [1_600, 1_600],
};

/** Humor do sprite durante cada ação (reaproveita as poses existentes: curioso, comemorando…). */
export const HUMOR_DA_ACAO: Readonly<Record<Acao, "ocioso" | "curioso" | "comemorando">> = {
  cheirar: "curioso", olhar_em_volta: "curioso", pular: "comemorando", espreguicar: "ocioso", bolinha: "ocioso", acenar: "ocioso", borboleta: "curioso", cavar: "ocioso",
  dancar: "comemorando", pegar: "ocioso", soltar: "ocioso", empurrar: "ocioso", cumprimentar: "ocioso",
};

/** Sorteia uma ação; o humor do workspace puxa a escolha (dormindo → espreguiçar; curioso → olhar/cheirar; comemorando → pular). Nunca repete a anterior. */
export function escolherAcao(sorteio: () => number, humor: BichinhoVisao["humor"] | undefined, anterior: Acao | null): (typeof ACOES)[number] {
  const pref: Partial<Record<BichinhoVisao["humor"], ReadonlyArray<(typeof ACOES)[number]>>> = {
    dormindo: ["espreguicar", "cavar"], curioso: ["olhar_em_volta", "cheirar", "borboleta"], comemorando: ["pular", "acenar", "bolinha"],
  };
  const base = humor !== undefined && sorteio() < 0.5 ? pref[humor] : undefined;
  const lista = (base ?? ACOES).filter((a) => a !== anterior);
  const usar = lista.length > 0 ? lista : ACOES;
  return usar[Math.min(usar.length - 1, Math.floor(sorteio() * usar.length))]!;
}
