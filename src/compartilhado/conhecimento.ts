// Tipos compartilhados do conhecimento (Fase 15, T-15.02 parcial): RAG local, grafo e consulta prévia.
// Arquivo NOVO e puro (sem imports): usado pelo núcleo (`src/nucleo/conhecimento`) e, depois, pelo main/renderer.
// Os canais IPC e o preload são pedidos ao coordenador (docs/ade/pedidos/15-pedidos.md). Nenhum campo carrega
// caminho absoluto, segredo nem texto bruto não redigido.

export const TIPOS_DOCUMENTO = ["doc", "relatorio", "decisao", "causa_raiz", "qa", "handoff", "task", "missao", "commit", "pr", "codigo", "transcricao", "chat", "aprendizado", "nota"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export type EstadoConsulta = "ok" | "vazio" | "lento" | "degradado" | "indisponivel" | "desligado";
export type OrigemConsulta = "tool" | "injecao" | "hook" | "chat" | "ui";
export type ModoBusca = "hibrido" | "lexical" | "semantico";
export type EscopoBusca = "projeto" | "missao" | "usuario" | "equipe";

export interface FonteResultado {
  documento_id: string;
  tipo: TipoDocumento;
  titulo: string;
  /** caminho relativo ao workspace ou referência lógica (`commit:<sha>`, `task:T-03.02`). */
  origem: string;
  mission_id: string | null;
  task_ref: string | null;
  pane_id: string | null;
  ocorrido_em: string;
}

export interface ResultadoRag {
  chunk_id: string;
  escore: number;
  /** ≤ 400 caracteres, redigido e saneado. */
  trecho: string;
  fonte: FonteResultado;
  aprendizado_id: string | null;
  braco: "lexical" | "vetorial" | "grafo" | "ambos";
}

export interface RespostaBusca {
  resultados: ResultadoRag[];
  estado: EstadoConsulta;
  consulta_id: string;
  latencia_ms: number;
  modelo: string;
  aviso: string | null;
}

export interface SinaisContexto {
  ja_existe: boolean;
  houve_correcao: boolean;
  decisoes_relacionadas: number;
  fontes: FonteResultado[];
}

export interface RespostaContexto {
  /** envelope `<conhecimento_previo tipo="dados">`. */
  markdown: string;
  sinais: SinaisContexto;
  estado: EstadoConsulta;
  consulta_id: string;
  latencia_ms: number;
}

export interface EstadoConhecimento {
  ativo: boolean;
  chunks: number;
  documentos: number;
  aprendizados: Record<"candidato" | "ativo" | "arquivado" | "rejeitado", number>;
  modelo: string;
  dimensao: number;
  vetor_backend: "exato" | "exato_int8" | "sqlite_vec";
  fts5: boolean;
  tamanho_bytes: number;
  indexando: { pendentes: number; fase: string | null; pct: number | null };
  reembutindo_pct: number | null;
  cobertura_consulta_7d_pct: number | null;
  backend: "local" | "espelho" | "compartilhado";
}

export const TIPOS_NO = ["arquivo", "simbolo", "task", "missao", "decisao", "commit", "pr", "sessao", "agente", "aprendizado", "relatorio", "ocorrencia", "doc"] as const;
export type TipoNoGrafo = (typeof TIPOS_NO)[number];
export const TIPOS_ARESTA = ["toca", "implementa", "corrigiu", "causou", "depende", "citou", "pertence", "executou", "produziu", "substitui"] as const;
export type TipoArestaGrafo = (typeof TIPOS_ARESTA)[number];

export interface NoGrafo {
  id: string;
  tipo: string;
  rotulo: string;
  peso: number;
  x: number | null;
  y: number | null;
  ultimo_em: string;
  mission_id: string | null;
}
export interface ArestaGrafo {
  origem: string;
  destino: string;
  tipo: string;
  peso: number;
}

export const TIPOS_APRENDIZADO = ["decisao", "causa_raiz", "armadilha", "padrao", "correcao", "fato"] as const;
export type TipoAprendizado = (typeof TIPOS_APRENDIZADO)[number];
export type EstadoAprendizado = "candidato" | "ativo" | "arquivado" | "rejeitado";
export type ValorFeedback = "util" | "inutil" | "errado";

export interface Aprendizado {
  id: string;
  tipo: TipoAprendizado;
  titulo: string;
  texto: string;
  fonte: "sistema" | "agente" | "usuario";
  estado: EstadoAprendizado;
  confianca: number;
  vezes_visto: number;
  util: number;
  inutil: number;
  errado: number;
  criado_em: string;
}

// ---- Backend online opcional (D-90..D-92) ---------------------------------------------------------------------------

export type ModoBackend = "local" | "espelho" | "compartilhado";
export type EstadoMigracao = "previa" | "consentida" | "enviando" | "pausada" | "verificando" | "concluida" | "falhou" | "cancelada";

export interface ConsentimentoBackend {
  provedor: string;
  host: string;
  colecao: string;
  versao_politica: number;
  em?: string;
}
