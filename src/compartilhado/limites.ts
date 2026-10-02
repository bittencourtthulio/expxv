// Schema único de limites (Fase 9, D-56). snake_case em inglês: compartilhado com o MCP, sem mapeamento.
// Tipos e constantes puros — sem I/O, sem Electron. Regra: custo/limite desconhecido NUNCA vira zero (`null`).

/** `credit` = saldo/limite em USD (OpenRouter); não tem reset. */
export type JanelaKind = "five_hour" | "weekly" | "monthly" | "credit";
export const JANELAS_KIND: readonly JanelaKind[] = ["five_hour", "weekly", "monthly", "credit"];
/** Janelas que o dono pode informar à mão (crédito vem da API). */
export const JANELAS_MANUAIS = ["five_hour", "weekly", "monthly"] as const;
export type JanelaManual = (typeof JANELAS_MANUAIS)[number];
/** Janelas gravadas no histórico de amostras (`modelo` = balde por modelo). */
export const JANELAS_AMOSTRA = ["five_hour", "weekly", "monthly", "credit", "modelo"] as const;
export type JanelaAmostra = (typeof JANELAS_AMOSTRA)[number];
/** Janelas da eficiência semanal (`limite_semana`). */
export const JANELAS_SEMANA = ["five_hour", "weekly"] as const;

export interface JanelaLimite {
  kind: JanelaKind;
  /** 0..100 ou `null` = desconhecido. */
  used_pct: number | null;
  resets_at: string | null;
}
export interface BaldeModelo {
  used_pct: number | null;
  resets_at: string | null;
  kind: JanelaKind;
}

export type FonteLimite = "claude_statusline" | "codex_rollout" | "openrouter_api" | "manual" | "estimado" | "nenhuma";
export const FONTES_LIMITE: readonly FonteLimite[] = ["claude_statusline", "codex_rollout", "openrouter_api", "manual", "estimado", "nenhuma"];
export type ConfiancaLimite = "medido" | "manual" | "estimado" | "desconhecido";
export type StatusLimite = "ok" | "unavailable" | "auth_error";

export interface LimitSnapshot {
  account_id: string;
  provider: string;
  /** Quando o DADO foi observado (não quando o app leu). Nunca no futuro. */
  fetched_at: string;
  fonte: FonteLimite;
  /** Nunca `medido` se `fonte` ∈ {estimado, nenhuma}. */
  confianca: ConfiancaLimite;
  status: StatusLimite;
  windows: JanelaLimite[];
  model_buckets: Record<string, BaldeModelo>;
  /** Só contas de crédito. */
  credit?: { limit_usd: number | null; used_usd: number | null; remaining_usd: number | null };
}

/** Derivado por `derivarUso()`; nunca persistido. */
export interface AccountUsage extends LimitSnapshot {
  bottleneck: JanelaKind | null;
  slack_pct: number | null;
  idade_s: number;
  vencidas: JanelaKind[];
  /** Nome da conta como o dono vê (ex.: "Pessoal"). Aditivo e opcional: ausente em fixtures e builds antigos. */
  account_label?: string;
}

export interface CotaGeral {
  pior: { conta_id: string; rotulo: string; kind: JanelaKind; used_pct: number } | null;
  /** Média das `slack_pct` só das contas COM dado. */
  folga_media_pct: number | null;
  /** "3/4": nunca esconder conta sem dado. */
  cobertura: { com_dado: number; total: number };
  em_alerta: number;
  esgotadas: number;
}

export interface AmostraLimite {
  conta_id: string;
  janela: JanelaKind | "modelo";
  balde: string;
  ts: string;
  usado_pct: number;
  reinicia_em: string | null;
}

export type ConfiancaPrevisao = "insuficiente" | "baixa" | "media" | "alta";
export interface PrevisaoZerar {
  janela: JanelaKind;
  atual_pct: number | null;
  ritmo_pct_por_hora: number | null;
  zera_em: string | null;
  antes_do_reset: boolean;
  confianca: ConfiancaPrevisao;
}

export interface EficienciaSemana {
  semana_inicio: string;
  conta_id: string;
  pico_pct: number;
  estourou: boolean;
  estouro_precoce: boolean;
  meta_atingida: boolean;
}

export type EventoLimites =
  | { tipo: "atualizado"; contas: string[] }
  | { tipo: "consumo_alto"; conta_id: string; janela: JanelaKind | "modelo"; used_pct: number }
  | { tipo: "limite_atingido"; conta_id: string; janela: JanelaKind | "modelo"; pane_id: string | null; fonte: "medido" | "saida_do_pty" }
  | { tipo: "provedor_indisponivel"; provider: string; motivo: string };

export const TIPOS_ALERTA_LIMITE = ["consumo_alto", "vai_estourar", "cota_sobrando", "sem_dado"] as const;
export type TipoAlertaLimite = (typeof TIPOS_ALERTA_LIMITE)[number];
export interface AlertaLimite {
  tipo: TipoAlertaLimite;
  conta_id: string;
  texto: string;
  desde: string;
}

// ---- payloads de IPC ----
export interface RespostaLimites {
  contas: AccountUsage[];
  geral: CotaGeral;
}
export interface PedidoHistoricoLimites {
  conta_id: string;
  janela: JanelaKind | "modelo";
  /** só para `janela: "modelo"`: nome do balde (família do modelo). */
  balde?: string;
  desde: string;
  ate: string;
  /** ≤ 300 */
  max_pontos: number;
}

/** P-27: modo "Precisão máxima" opt-in por provedor (config `limites.precisao_maxima.<provedor>`). Padrão: desligado. */
export const MAX_PONTOS_HISTORICO = 300;
export const MAX_SEMANAS_EFICIENCIA = 26;
