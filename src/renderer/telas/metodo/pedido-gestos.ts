// Gestos que criam trabalho a partir do PEDIDO (tela Método). Funções e tabelas puras: o rótulo do botão, a linha que explica o que acontece e a skill
// que vai rodar vêm daqui. O comando exato (CLI, contexto prévio, bloqueios) é montado pelo main; isto é só a leitura honesta para a pessoa.
import type { GestoMetodo } from "../../../compartilhado/dominio";

export interface DefGestoPedido {
  gesto: GestoMetodo;
  /** nome na lista de escolha */
  rotulo: string;
  /** rótulo do botão primário */
  acao: string;
  /** o que acontece, em uma linha */
  explica: string;
  /** skill que roda (sem prefixo) */
  skill: string;
  /** o gesto usa o pedido digitado? (os `gerar_*` não) */
  comPedido: boolean;
}

export const GESTOS_PRINCIPAIS: readonly DefGestoPedido[] = [
  { gesto: "nova_feature", rotulo: "Nova feature", acao: "Criar feature", explica: "Planeja e implementa uma funcionalidade nova, com testes, em sprints.", skill: "sprintx", comPedido: true },
  { gesto: "nova_ocorrencia", rotulo: "Corrigir um bug", acao: "Corrigir bug", explica: "Investiga a causa, planeja a correção e valida com um teste de regressão.", skill: "runx", comPedido: true },
  { gesto: "pedido_cru", rotulo: "Pedido livre", acao: "Triar pedido", explica: "Decide primeiro se vale fazer: confere se já existe e dá um veredito para você assinar.", skill: "prodx-triar", comPedido: true },
  { gesto: "projeto", rotulo: "Novo projeto", acao: "Criar projeto", explica: "Mapeia o escopo de um sistema inteiro e conduz feature a feature até o fim.", skill: "buildx", comPedido: true },
];

export const GESTOS_MAIS: readonly DefGestoPedido[] = [
  { gesto: "gerar_convencoes", rotulo: "Gerar convenções", acao: "Gerar convenções", explica: "Lê o código e grava como o projeto escreve testes e organiza camadas.", skill: "stackx-detectar", comPedido: false },
  { gesto: "gerar_produto", rotulo: "Gerar contexto de produto", acao: "Gerar produto", explica: "Descreve o produto, o público e as regras que sustentam os vereditos.", skill: "prodx-produto", comPedido: false },
  { gesto: "gerar_memoria", rotulo: "Indexar a memória", acao: "Indexar memória", explica: "Cria o índice de memória do projeto para as próximas sessões.", skill: "memox-indexar", comPedido: false },
  { gesto: "gerar_design_system", rotulo: "Mapear o design system", acao: "Mapear design", explica: "Cartografa componentes e tokens de design já existentes.", skill: "designx-cartography", comPedido: false },
  { gesto: "gerar_perfil_legado", rotulo: "Perfil do legado", acao: "Gerar perfil", explica: "Caracteriza o código legado e seus pontos de risco.", skill: "legadox-perfil", comPedido: false },
];

export const TODOS_GESTOS_PEDIDO: readonly DefGestoPedido[] = [...GESTOS_PRINCIPAIS, ...GESTOS_MAIS];
export const defDoGestoPedido = (g: string): DefGestoPedido => TODOS_GESTOS_PEDIDO.find((d) => d.gesto === g) ?? (GESTOS_PRINCIPAIS[0] as DefGestoPedido);

/** Exemplos clicáveis: preenchem o campo e escolhem o gesto que combina. */
export const EXEMPLOS_PEDIDO: readonly { gesto: GestoMetodo; rotulo: string; texto: string }[] = [
  { gesto: "nova_feature", rotulo: "Exportar relatório em PDF", texto: "Exportar o relatório mensal em PDF, com filtro por período" },
  { gesto: "nova_ocorrencia", rotulo: "Botão Salvar não responde", texto: "O botão Salvar não responde quando o formulário tem um campo vazio" },
  { gesto: "pedido_cru", rotulo: "Convidar a equipe por e-mail", texto: "Os clientes pediram um jeito de convidar a equipe por e-mail" },
];

export const LIMITE_PEDIDO = 1_500;

/** O que será digitado no terminal, com o argumento que a pessoa escreveu (ou o marcador, enquanto vazio). Só para mostrar; o main monta o real. */
export function modeloDoComando(def: DefGestoPedido, pedido: string): string {
  if (!def.comPedido) return `/expx:${def.skill}`;
  const t = pedido.replace(/\s+/g, " ").trim();
  return `/expx:${def.skill} ${t === "" ? "<seu pedido>" : t.length > 120 ? `${t.slice(0, 119)}…` : t}`;
}

export type AvisoPedido =
  | { tipo: "modulo"; modulo: string; texto: string }
  | { tipo: "suite"; texto: string }
  | { tipo: "cli"; texto: string }
  | { tipo: "outro"; texto: string };

/** Classifica a recusa do main numa ação que a pessoa consegue fazer (módulo desligado → ligar; sem CLI → Provedores). */
export function avisoDaRecusa(motivo: string | null | undefined, moduloDoGesto: string | null): AvisoPedido | null {
  const m = (motivo ?? "").trim();
  if (m === "") return null;
  if (/módulo|desligad/i.test(m) && moduloDoGesto !== null) return { tipo: "modulo", modulo: moduloDoGesto, texto: m };
  if (/CLI|Claude Code|OpenCode/i.test(m)) return { tipo: "cli", texto: m };
  return { tipo: "outro", texto: m };
}
