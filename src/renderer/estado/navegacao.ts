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

// ---- foco de uma sessão na tela Terminais (painel de workspaces): a tela é lazy, então o pedido espera pouco pelo primeiro ouvinte.
export const VALIDADE_FOCO_SESSAO_MS = 4_000;
const ouvintesFoco = new Set<(sessaoId: string) => void>();
let focoPendente: { id: string; em: number } | null = null;

/** Mostra a tela Terminais e pede para focar o painel da sessão (a tela dona da grade decide onde ele está). */
export function pedirFocoSessao(sessaoId: string): void {
  pedirTela("terminais");
  if (ouvintesFoco.size === 0) { focoPendente = { id: sessaoId, em: Date.now() }; return; }
  focoPendente = null;
  [...ouvintesFoco].forEach((o) => o(sessaoId));
}
export function aoPedirFocoSessao(ouvinte: (sessaoId: string) => void): () => void {
  ouvintesFoco.add(ouvinte);
  if (focoPendente !== null) { const p = focoPendente; focoPendente = null; if (Date.now() - p.em <= VALIDADE_FOCO_SESSAO_MS) ouvinte(p.id); }
  return () => void ouvintesFoco.delete(ouvinte);
}

// ---- seção das Configurações: quem manda abrir Configurações pode pedir uma seção (ex.: o microfone leva a "Voz e captura").
// A tela carrega sob demanda e fica montada oculta depois de visitada: vale o pedido pendente (ao montar) e o ouvinte (já montada).

export type SecaoConfigPedida = "voz" | "memoria" | "modulos" | "limite" | "aprovacao_workers";

const ouvintesDeSecao = new Set<(s: SecaoConfigPedida) => void>();
let secaoPendente: { secao: SecaoConfigPedida; em: number } | null = null;

/** Abre Configurações já na seção pedida. */
export function pedirConfiguracoes(secao: SecaoConfigPedida): void {
  secaoPendente = { secao, em: Date.now() };
  ouvintesDeSecao.forEach((o) => o(secao));
  pedirTela("config");
}

/** Consome o pedido pendente (tela que acabou de montar). Expira como as ações. */
export function consumirSecaoConfigPedida(): SecaoConfigPedida | null {
  const p = secaoPendente;
  secaoPendente = null;
  return p !== null && Date.now() - p.em <= VALIDADE_PEDIDO_MS ? p.secao : null;
}

export function aoPedirSecaoConfig(ouvinte: (s: SecaoConfigPedida) => void): () => void {
  ouvintesDeSecao.add(ouvinte);
  return () => void ouvintesDeSecao.delete(ouvinte);
}
