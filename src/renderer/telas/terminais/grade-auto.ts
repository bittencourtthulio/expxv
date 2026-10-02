// Grade automática (D-420): lógica PURA da partição equilibrada dos painéis de um agente que orquestra (o painel que pediu + seus workers).
// Sem DOM e sem estado: a Tela mede o corpo e o reducer usa estas funções para refazer a árvore do grupo.
import { PAINEIS_MAXIMOS_NA_GRADE, PAINEL_MINIMO_PX } from "../../../compartilhado/painel-livre";
import type { NoPainel, Orientacao } from "./layout";

/** Colunas por linha para n painéis (1..8, mais o 9º = pedinte + 8 workers); acima do teto vale a do teto. */
const DISTRIBUICAO: Readonly<Record<number, readonly number[]>> = {
  1: [1], 2: [2], 3: [2, 1], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4],
  // o pedinte + 8 workers (teto do contrato)
  9: [3, 3, 3],
};

export function distribuicaoDaGrade(n: number): readonly number[] {
  const k = Math.min(PAINEIS_MAXIMOS_NA_GRADE, Math.max(1, Math.floor(n)));
  return DISTRIBUICAO[k] ?? [1];
}

function balanceada(nos: readonly NoPainel[], orientacao: Orientacao): NoPainel {
  if (nos.length === 1) return nos[0] as NoPainel;
  const meio = Math.ceil(nos.length / 2);
  return { tipo: "divisao", orientacao, primeiro: balanceada(nos.slice(0, meio), orientacao), segundo: balanceada(nos.slice(meio), orientacao) };
}

/**
 * Árvore binária equilibrada: as linhas empilham (divisão `horizontal`) e cada linha lado a lado (divisão `vertical`). As folhas, lidas da
 * esquerda para a direita e de cima para baixo, seguem a ordem de `ids` (o pedinte primeiro, depois os workers na ordem de chegada).
 * `ids` vazio não tem árvore (`null`); repetidos contam uma vez.
 */
export function arvoreEmGrade(ids: readonly string[], orientacaoDasLinhas: Orientacao = "horizontal"): NoPainel | null {
  const unicos = [...new Set(ids)].slice(0, PAINEIS_MAXIMOS_NA_GRADE);
  if (unicos.length === 0) return null;
  const colunas = distribuicaoDaGrade(unicos.length);
  const colunaOrientacao: Orientacao = orientacaoDasLinhas === "horizontal" ? "vertical" : "horizontal";
  const linhas: NoPainel[] = [];
  let i = 0;
  for (const c of colunas) {
    const grupo = unicos.slice(i, i + c);
    i += c;
    if (grupo.length > 0) linhas.push(balanceada(grupo.map((sessao_id) => ({ tipo: "terminal" as const, sessao_id })), colunaOrientacao));
  }
  return balanceada(linhas, orientacaoDasLinhas);
}

/** Quantos painéis legíveis cabem na área (px): mínimo 2 e teto de PAINEIS_MAXIMOS_NA_GRADE. Medida inválida = o teto. */
export function maximoLegivel(larguraPx: number, alturaPx: number): number {
  if (!Number.isFinite(larguraPx) || !Number.isFinite(alturaPx) || larguraPx <= 0 || alturaPx <= 0) return PAINEIS_MAXIMOS_NA_GRADE;
  const cabe = Math.floor(larguraPx / PAINEL_MINIMO_PX.largura) * Math.floor(alturaPx / PAINEL_MINIMO_PX.altura);
  return Math.min(PAINEIS_MAXIMOS_NA_GRADE, Math.max(2, cabe));
}

/** O grupo (já com o painel novo) cabe numa grade só? Senão o novo vai para outra aba. */
export const caberNaGrade = (tamanhoDoGrupo: number, maximo: number): boolean => tamanhoDoGrupo <= Math.min(maximo, PAINEIS_MAXIMOS_NA_GRADE);
