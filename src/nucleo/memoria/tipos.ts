import type { Banco } from "../banco";
import type { EscopoMemoria, FonteMemoria, ModoMemoria, TipoMemoria } from "../../compartilhado/memoria";

export type { EscopoMemoria, FonteMemoria, ModoMemoria, TipoMemoria };

export type PapelMemoria = "piloto" | "executor" | "explorador" | "revisor" | "nenhum";
export type Importancia = 1 | 2 | 3 | 4 | 5;

/** Identidade de quem fala com a memória: sempre derivada do TOKEN/Pane no main, nunca de argumento do agente. */
export interface ContextoMemoria {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string | null;
  /** raiz da cadeia `respawn_de` (D-49). */
  linhagem_id: string | null;
  squad_slug: string | null;
  modo: ModoMemoria;
  papel: PapelMemoria;
}

export interface LinhaEntrada {
  id: string;
  workspace_id: string | null;
  mission_id: string | null;
  pane_id: string | null;
  linhagem_id: string | null;
  squad_slug: string | null;
  escopo: EscopoMemoria;
  anel: 1 | 2 | 3;
  tipo: TipoMemoria;
  conteudo: string;
  fonte: FonteMemoria;
  autor_pane_id: string | null;
  importancia: Importancia;
  substitui_id: string | null;
  estado: "ativa" | "substituida" | "resumida" | "expirada";
  expira_em: string | null;
  redigido: number;
  hash_conteudo: string;
  contagem: number;
  criado_em: string;
  atualizado_em: string;
}

export type CodigoErroMemoria = "memory_disabled" | "too_large" | "invalid_argument" | "unauthorized" | "not_found" | "limit_reached" | "rate_limited";

/** Erro nominal; a mensagem nunca cita conteúdo de entrada. Mapeia 1:1 para os erros MCP já existentes. */
export class MemoriaErro extends Error {
  override name = "MemoriaErro";
  constructor(
    readonly codigo: CodigoErroMemoria,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface DepsBase {
  banco: Banco;
  agora?: () => Date;
}

export const relogio = (d: DepsBase): Date => (d.agora ?? (() => new Date()))();
