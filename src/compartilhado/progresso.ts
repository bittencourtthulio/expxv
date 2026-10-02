// Painel de progresso da pipeline (D-660…): contrato compartilhado entre núcleo, main e renderer. Tipos puros; nenhum conteúdo de conversa:
// rótulos vêm do catálogo do Maestro, do plano em disco ou da skill; o único texto livre é o título curto do pedido JÁ redigido pelo scrubber.

export const ORIGENS_PROGRESSO = ["maestro", "sprintx", "skill"] as const;
export type OrigemProgresso = (typeof ORIGENS_PROGRESSO)[number];

export const ESTADOS_ITEM_PROGRESSO = ["pendente", "em_andamento", "aguardando", "concluido", "falhou", "pulado"] as const;
export type EstadoItemProgresso = (typeof ESTADOS_ITEM_PROGRESSO)[number];

/** Resultado do progresso como um todo: `concluido` e `falhou` são finais; `cancelado` fecha em silêncio. */
export const RESULTADOS_PROGRESSO = ["em_andamento", "aguardando", "concluido", "falhou", "cancelado"] as const;
export type ResultadoProgresso = (typeof RESULTADOS_PROGRESSO)[number];

export interface ItemProgresso {
  id: string;
  /** curto (≤ 60): vem do catálogo, do plano em disco ou da skill. */
  rotulo: string;
  estado: EstadoItemProgresso;
  /** nota discreta ("só você", "tentativa 2", "3/12 tasks"); nunca texto digitado pelo usuário. */
  detalhe?: string;
  /** início da etapa (ms desde a época), quando medido. */
  desde?: number;
  /** fim da etapa (ms desde a época), quando medido. */
  fim_em?: number;
  /** cabeçalho curto do grupo (fase do sprintx); itens consecutivos com o mesmo grupo formam uma seção. */
  grupo?: string;
  /** sessão do terminal desta etapa, quando já existe (o clique foca o painel). */
  sessao_id?: string | null;
}

export interface Progresso {
  /** estável durante a vida do progresso: `pl:<pipeline>`, `sx:<trabalho>` ou `sk:<skill>:<chave>`. */
  id: string;
  origem: OrigemProgresso;
  /** "Pipeline: nova feature", "Sprint: <trabalho>", "/expx:runx". */
  titulo: string;
  itens: ItemProgresso[];
  /** terminou COM sucesso (todas as etapas aplicáveis feitas). */
  concluido: boolean;
  workspace_id: string;
  resultado: ResultadoProgresso;
  /** true = a lista é a sequência CONHECIDA da skill (catálogo), não medida pelo plano; o painel rotula "etapas previstas". */
  previsto: boolean;
  iniciado_em: number;
  /** fim (ms) quando `resultado` é final. */
  fim_em: number | null;
  /** título curto do pedido, já redigido (≤ 60); só no Maestro. */
  pedido?: string;
  /** o dono fixou o painel aberto (estado do main, por progresso). */
  fixado?: boolean;
  /** o dono dispensou este progresso (estado do main, por progresso). */
  dispensado?: boolean;
}

export interface EstadoProgresso {
  progressos: Progresso[];
}
/** Payload do evento `progresso:mudou`: o estado agregado de todos os workspaces (minúsculo). */
export type EventoProgressoMudou = EstadoProgresso;

export interface ApiProgresso {
  estado(): Promise<EstadoProgresso>;
  dispensar(id: string): Promise<{ ok: true }>;
  fixar(id: string, fixado: boolean): Promise<{ ok: true }>;
  assinar(cb: (e: EventoProgressoMudou) => void): () => void;
}

// ---------------------------------------------------------------- limites e preferências
export const LIMITE_ITENS_PROGRESSO = 60;
export const LIMITE_ROTULO_PROGRESSO = 60;
export const LIMITE_PROGRESSOS = 12;
/** Preferência (app:config_*): "Mostrar painel de progresso na área de terminais" (padrão LIGADO). */
export const CHAVE_PROGRESSO_MOSTRAR = "progresso_painel_mostrar";
/** Coalescência mínima das publicações do main (ms). */
export const COALESCER_PROGRESSO_MS = 250;
/** Um progresso inferido (sprintx/skill) sem atividade há mais que isto deixa de ser "em execução" (ms). */
export const JANELA_ATIVIDADE_MS = 15 * 60_000;

// ---------------------------------------------------------------- tempos e medidas do painel (UI)
export const LARGURA_PROGRESSO_PADRAO = 248;
export const LARGURA_PROGRESSO_MIN = 200;
export const LARGURA_PROGRESSO_MAX = 320;
/** Faixa fina do painel recolhido. */
export const LARGURA_PROGRESSO_RECOLHIDO = 24;
/** Abaixo desta largura de JANELA o painel vira a barra fina que expande sobreposta. */
export const LARGURA_JANELA_PROGRESSO = 1000;
/** Quanto o resumo ("Concluído: 9/9 em 4 min") fica à vista antes de o painel fechar sozinho. */
export const RESUMO_MS = 2_000;
/** Duração da animação de fechar. */
export const ANIMACAO_FECHAR_MS = 200;
/** Quanto o painel reaberto por "Ver resumo" fica em modo leitura. */
export const LEITURA_MS = 10_000;
/** No máximo estes progressos ficam visíveis como abas; o resto vira "e mais N". */
export const MAX_ABAS_PROGRESSO = 3;

export const limitarLarguraProgresso = (n: number): number =>
  Number.isFinite(n) ? Math.min(LARGURA_PROGRESSO_MAX, Math.max(LARGURA_PROGRESSO_MIN, Math.round(n))) : LARGURA_PROGRESSO_PADRAO;

export const cortarRotulo = (t: string, max = LIMITE_ROTULO_PROGRESSO): string => {
  const limpo = t.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return limpo.length <= max ? limpo : `${limpo.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
};
