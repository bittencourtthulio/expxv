// Entradas e portas do board (Fase 10B). O board é uma VISÃO: lê o método (disco), cruza com o banco local e com o custo. Nada aqui escreve em `docs/**` (D-04).
// Os tipos de entrada são estruturalmente compatíveis com `Trabalho`/`Task` de `nucleo/metodo/tipos.ts` (o main os monta a partir do índice), mas independem dele.
import type { CustoResumo } from "../../compartilhado/custo";

export type StatusTaskMetodo = "pendente" | "em_andamento" | "concluida" | "bloqueada";
export type VereditoMetodo = "sim" | "nao" | "aprovado" | "reprovado" | null;

export interface TaskDoMetodo {
  id: string;
  titulo: string;
  fase: string | null;
  status: StatusTaskMetodo;
  depende_de: string[];
  suite: "verde" | "vermelha" | "parcial" | "nao_executada";
  concluida_em: string | null;
  duracao_observada_ms: number | null;
  objetivo: string | null;
  criterio_aceite: string | null;
  teste_integracao: string | null;
  teste_funcional: string | null;
  teste_regressao: string | null;
  /** relativo à raiz do trabalho/worktree, com `/`. */
  arquivo: string;
}
export interface TrabalhoDoMetodo {
  id: string;
  titulo: string;
  workspace_id: string;
  /** Missão que executa este trabalho (banco), quando existe. */
  mission_id: string | null;
  /** tipo do trabalho no método (define o comando sugerido); ausente = feature. */
  tipo?: "feature" | "ocorrencia" | "pedido" | "projeto";
  veredito_qa: VereditoMetodo;
  veredito_auditoria?: VereditoMetodo;
  tasks: TaskDoMetodo[];
  /** violações do modelo do método, por alvo (id de task) — o texto é saneado antes de sair. */
  violacoes: Array<{ alvo: string; detalhe: string }>;
}
export type EstadoTaskBanco = "aberta" | "reivindicada" | "entregue" | "validada" | "descartada";
export interface TaskDoBanco {
  workspace_id: string;
  trabalho_id: string;
  task_ref: string;
  estado: EstadoTaskBanco;
  pane_id: string | null;
  handoff_status: "ok" | "parcial" | "bloqueado" | "falhou" | null;
}
export interface PaneParaBoard {
  cli: string;
  modelo: string | null;
  conta_rotulo: string | null;
  papel: string;
}

/** Fonte de custo do board: resumo por chave de card (`<ws>|<trabalho>|<task>`); ausente = card sem uso observado. */
export type CustosPorCard = ReadonlyMap<string, CustoResumo>;

/** Porta que a Fase 18 (gestão ágil) consome: colunas e limites de WIP do board de cada workspace. */
export interface PortaBoardAgil {
  colunas(workspaceId: string): Promise<string[] | null>;
  limiteWip(workspaceId: string, coluna: string): Promise<number | null>;
}
