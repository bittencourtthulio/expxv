import type { TelaId } from "../casca/telas";

type Ouvinte = (id: TelaId) => void;
const ouvintes = new Set<Ouvinte>();

/** Gancho mínimo de navegação: qualquer tela pede outra tela; a casca escuta (sem roteador). */
export function pedirTela(id: TelaId): void {
  ouvintes.forEach((o) => o(id));
}

export function aoPedirTela(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => void ouvintes.delete(ouvinte);
}

// ---- ações entre telas (paleta, menu): a tela dona da ação a escuta; sem botão por texto nem atalho simulado.

export type AcaoPedida = "nova-missao" | "novo-terminal";

/** Telas carregam sob demanda: um pedido sem ouvinte (tela ainda não montada) espera o primeiro ouvinte, por pouco tempo. */
export const VALIDADE_PEDIDO_MS = 4_000;

const ouvintesDeAcao = new Map<AcaoPedida, Set<() => void>>();
const pendentes = new Map<AcaoPedida, number>();

export function pedirAcao(acao: AcaoPedida): void {
  const ativos = ouvintesDeAcao.get(acao);
  if (ativos === undefined || ativos.size === 0) {
    pendentes.set(acao, Date.now());
    return;
  }
  pendentes.delete(acao);
  [...ativos].forEach((o) => o());
}

export function aoPedirAcao(acao: AcaoPedida, ouvinte: () => void): () => void {
  let conjunto = ouvintesDeAcao.get(acao);
  if (conjunto === undefined) { conjunto = new Set(); ouvintesDeAcao.set(acao, conjunto); }
  conjunto.add(ouvinte);
  const desde = pendentes.get(acao);
  if (desde !== undefined) {
    pendentes.delete(acao);
    if (Date.now() - desde <= VALIDADE_PEDIDO_MS) ouvinte();
  }
  return () => void conjunto.delete(ouvinte);
}

// ---- paleta de comandos: o menu nativo pede; o gatilho da paleta (dono do estado aberto/fechado) escuta.
const ouvintesPaleta = new Set<() => void>();
export function pedirPaleta(): void {
  ouvintesPaleta.forEach((o) => o());
}
export function aoPedirPaleta(ouvinte: () => void): () => void {
  ouvintesPaleta.add(ouvinte);
  return () => void ouvintesPaleta.delete(ouvinte);
}
