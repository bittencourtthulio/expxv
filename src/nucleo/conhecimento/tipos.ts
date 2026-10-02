// Tipos internos do conhecimento (Fase 15). Os tipos de contrato (IPC/eventos) vivem em `src/compartilhado/conhecimento.ts`.
import type { TipoAprendizado, TipoDocumento } from "../../compartilhado/conhecimento";
import type { EventoConhecimento } from "../memoria/eventos-conhecimento";
import type { EntradaCommit } from "./chunking/commit";
import type { Troca } from "./chunking/transcricao";

export type { EventoConhecimento } from "../memoria/eventos-conhecimento";
export type { TipoDocumento, TipoAprendizado } from "../../compartilhado/conhecimento";

export type FormatoDocumento = "markdown" | "codigo" | "transcricao" | "commit" | "evento";
export type FonteAutor = "sistema" | "agente" | "usuario";

/** Documento a indexar, já normalizado por uma das fontes (docs, código, git, transcrição, domínio, mapa). Texto BRUTO: o pipeline redige. */
export interface DocumentoEntrada {
  tipo: TipoDocumento;
  /** relativo ao workspace ou referência lógica (`commit:<sha>`, `task:T-03.02`, `sessao:<id>`). */
  origem: string;
  titulo: string;
  texto: string;
  formato: FormatoDocumento;
  fonte: FonteAutor;
  ocorrido_em: string;
  mission_id?: string | undefined;
  task_ref?: string | undefined;
  pane_id?: string | undefined;
  cli?: string | undefined;
  modelo_autor?: string | undefined;
  autor?: string | undefined;
  importancia?: 1 | 2 | 3 | 4 | 5 | undefined;
  expira_em?: string | undefined;
  /** código: extensão/linguagem (ts, py, go…). */
  linguagem?: string | undefined;
  /** arquivos (relativos) tocados/citados: viram arestas `toca`. */
  arquivos?: string[] | undefined;
  /** agente (CLI·modelo·papel) que produziu: vira nó `agente` + aresta `executou`. */
  agente?: string | undefined;
  /** formato `transcricao`: a troca estruturada (sem saída de ferramenta nem raciocínio). */
  troca?: Troca | undefined;
  /** formato `commit`: mensagem, arquivos e diffs resumíveis. */
  commit?: EntradaCommit | undefined;
}

/** Entradas internas de ingestão além dos `EventoConhecimento` da Fase 8 (docs/ade/fase-15, "Entradas internas"). */
export type EntradaConhecimento =
  | { tipo: "evento"; evento: EventoConhecimento }
  | { tipo: "session.turn_ended"; workspace_id: string; sessao_id: string; pane_id: string | null; mission_id: string | null; cli: string; modelo: string | null; usuario: string; resposta: string; ferramentas: string[]; arquivos: string[]; ocorrido_em: string; indice: number }
  | { tipo: "vcs.commit"; workspace_id: string; sha: string; mensagem: string; autor: string | null; arquivos: Array<{ caminho: string; status: string; diff?: string | undefined }>; ocorrido_em: string; mission_id: string | null }
  | { tipo: "file.changed"; workspace_id: string; caminho: string; texto: string; ocorrido_em: string }
  | { tipo: "user.note"; workspace_id: string; id: string; titulo: string; texto: string; ocorrido_em: string }
  | { tipo: "chat.exchange"; workspace_id: string; conversa_id: string; indice: number; pergunta: string; resposta: string; ocorrido_em: string };

export interface CandidatoAprendizado {
  tipo: TipoAprendizado;
  titulo: string;
  texto: string;
  fonte: FonteAutor;
  proveniencia: Proveniencia;
  /** arquivos (relativos) a que o aprendizado se liga: arestas. */
  arquivos?: string[] | undefined;
}

export interface Proveniencia {
  mission_id?: string | undefined;
  task_ref?: string | undefined;
  pane_id?: string | undefined;
  cli?: string | undefined;
  modelo?: string | undefined;
  commit?: string | undefined;
  origem?: string | undefined;
  em: string;
}

export interface FiltroBusca {
  tipos?: readonly TipoDocumento[] | null | undefined;
  desde?: string | null | undefined;
  mission_id?: string | null | undefined;
}
