// Tipos da Memória (Fase 8) trocados entre main e renderer. Só tipos e constantes puras (sem runtime além de listas).
// Ajustes da DECISOES-DAS-PENDENCIAS: P-21 (memória ligada em todos os modos), P-22 (retenção 365 d, 0 = sem limite),
// P-23 (anel 3 com até 50 itens), P-24 (squad com anel próprio: escopo "squad" e modo "squad").

export const TIPOS_MEMORIA = ["checkpoint", "decisao", "risco", "evento", "fato", "preferencia", "handoff", "aprendizado", "resumo"] as const;
export type TipoMemoria = (typeof TIPOS_MEMORIA)[number];

export const ESCOPOS_MEMORIA = ["pane", "missao", "squad", "workspace", "usuario"] as const;
export type EscopoMemoria = (typeof ESCOPOS_MEMORIA)[number];

export const FONTES_MEMORIA = ["sistema", "agente", "usuario"] as const;
export type FonteMemoria = (typeof FONTES_MEMORIA)[number];

export const ESTADOS_MEMORIA = ["ativa", "substituida", "resumida", "expirada"] as const;
export type EstadoMemoria = (typeof ESTADOS_MEMORIA)[number];

export type ModoMemoria = "off" | "solo" | "missao" | "squad";

export interface EntradaMemoria {
  id: string;
  escopo: EscopoMemoria;
  anel: 1 | 2 | 3;
  tipo: TipoMemoria;
  conteudo: string;
  fonte: FonteMemoria;
  importancia: 1 | 2 | 3 | 4 | 5;
  redigido: boolean;
  estado: EstadoMemoria;
  mission_id: string | null;
  pane_id: string | null;
  squad_slug: string | null;
  display_id: number | null;
  contagem: number;
  criado_em: string;
  atualizado_em: string;
}

export interface ConfigMemoria {
  workspace_id: string;
  ativa: boolean;
  solo: boolean;
  squad: boolean;
  orcamento_brief_chars: number;
  /** 0 = sem limite (P-22). */
  retencao_dias: number;
  teto_mb: number;
  pacote_workers: boolean;
  /** modelo de embedding escolhido para a busca semântica da memória; null = só lexical (padrão). */
  embedding_modelo: string | null;
  global_ativa: boolean;
}

export interface EstadoMemoriaApp {
  config: ConfigMemoria;
  /** chave por Missão deste workspace (só as que têm valor explícito; ausente = herda do workspace). */
  missoes?: Record<string, boolean>;
  contagens: Record<EscopoMemoria, number>;
  tamanho_bytes: number;
  aviso_teto: boolean;
  fts5: boolean;
  memox: { instalado: boolean; texto: string | null };
  /** contadores para o diagnóstico copiável (T-08.20): só números; nunca conteúdo. Preenchido pelo main. */
  metricas?: Record<string, number>;
}

export interface PreviaBrief {
  markdown: string;
  caracteres: number;
  truncado: boolean;
  modo: ModoMemoria;
}

export interface ResultadoRestaurar {
  pane_id: string;
  sessao_id: string;
  modo: "retomada" | "brief" | "sem_memoria";
  brief_injetado: boolean;
  truncado: boolean;
  ja_existia: boolean;
}

/** Tipo de evento de domínio emitido pela memória (nunca carrega `conteudo`). */
export const EVENTOS_MEMORIA = ["memory.entry_created", "memory.brief_built", "pane.restore_requested", "memory.forgotten", "memory.purged", "memory.compacted"] as const;
export type EventoMemoriaTipo = (typeof EVENTOS_MEMORIA)[number];

// ---------------------------------------------------------------- IPC `memoria:*` (Fase 8, onda 2)
export interface PaginaMemoria<T> {
  itens: T[];
  proximo: string | null;
}

export interface PedidoListarMemoria {
  workspace_id: string;
  escopo: EscopoMemoria | null;
  mission_id: string | null;
  pane_id: string | null;
  tipos: TipoMemoria[] | null;
  busca: string | null;
  depois: string | null;
  limite: number;
}

/** Ajuste do workspace; `global_ativa` (chave geral) pode vir junto, e a resposta é sempre a config do `workspace_id`. */
export interface PedidoConfigMemoria {
  workspace_id: string;
  global_ativa?: boolean;
  ativa?: boolean;
  solo?: boolean;
  squad?: boolean;
  orcamento_brief_chars?: number;
  /** 0 = sem limite. */
  retencao_dias?: number;
  teto_mb?: number;
  pacote_workers?: boolean;
  embedding_modelo?: string | null;
}

export interface PedidoPurgarMemoria {
  workspace_id: string;
  escopo: EscopoMemoria | "tudo";
  /** nome do workspace digitado na UI. */
  confirmacao: string;
}

/** "Editar" (texto) e "Fixar" (importância 5): ação humana; o texto passa pela mesma redação da escrita. */
export interface PedidoAtualizarMemoria {
  entrada_id: string;
  conteudo?: string;
  importancia?: 1 | 2 | 3 | 4 | 5;
}

export interface PedidoPreferenciaMemoria {
  id: string | null;
  conteudo: string;
  importancia: 1 | 2 | 3 | 4 | 5;
}

/** Payload de cada canal de evento main -> renderer (coalescidos; nunca carregam `conteudo`). Envelope `versao: 1` é do transporte. */
export interface PayloadsEventoMemoria {
  "memoria:entrada_criada": { entrada_id: string; escopo: EscopoMemoria; tipo: TipoMemoria };
  "memoria:brief_montado": { pane_id: string; caracteres: number; truncado: boolean };
  "memoria:restauracao_pedida": { pane_id: string };
  "memoria:aviso": { pane_id: string | null; codigo: "brief_falhou" | "fts5_indisponivel" | "limite_atingido"; mensagem: string };
}
export type CanalEventoMemoria = keyof PayloadsEventoMemoria;
/** O que `ApiMemoria.assinar` entrega: o canal e o payload dele. */
export type EventoMemoria = { [C in CanalEventoMemoria]: { canal: C; payload: PayloadsEventoMemoria[C] } }[CanalEventoMemoria];

/** `window.ade.memoria` (canais `memoria:*`). */
export interface ApiMemoria {
  estado(workspaceId: string): Promise<EstadoMemoriaApp>;
  gravarConfig(pedido: PedidoConfigMemoria): Promise<ConfigMemoria>;
  /** chave por Missão (P-21): `null` = herda do workspace. */
  definirMissao(missionId: string, ativa: boolean | null): Promise<{ mission_id: string; ativa: boolean | null }>;
  listar(pedido: PedidoListarMemoria): Promise<PaginaMemoria<EntradaMemoria>>;
  atualizar(pedido: PedidoAtualizarMemoria): Promise<EntradaMemoria>;
  esquecer(entradaId: string): Promise<{ ok: boolean }>;
  esquecerPane(paneId: string): Promise<{ removidas: number }>;
  purgar(pedido: PedidoPurgarMemoria): Promise<{ removidas: number }>;
  /** o main abre o diálogo de salvar; `null` = cancelou. */
  exportar(workspaceId: string, escopo: EscopoMemoria | "tudo"): Promise<{ caminho_salvo: string | null }>;
  briefPrevia(paneId: string): Promise<PreviaBrief>;
  restaurar(paneId: string, modo: "auto" | "retomar" | "brief"): Promise<ResultadoRestaurar>;
  preferenciasListar(): Promise<EntradaMemoria[]>;
  preferenciasGravar(pedido: PedidoPreferenciaMemoria): Promise<EntradaMemoria>;
  preferenciasRemover(id: string): Promise<{ ok: boolean }>;
  assinar(cb: (e: EventoMemoria) => void): () => void;
}

/** Canais de evento (nomes do contrato); o preload os repete inline. */
export const EVENTOS_IPC_MEMORIA = ["memoria:entrada_criada", "memoria:brief_montado", "memoria:restauracao_pedida", "memoria:aviso"] as const;
