// Contrato do painel de workspaces (D-450…): visão agregada, SOMENTE LEITURA, de todos os workspaces conhecidos com os agentes que
// rodam em cada um. Tipos puros, sem runtime; o validador dos canais vive em src/main/ipc/workspaces-resumo.ts.
// Nada sensível: caminho com o início mascarado (~), título legível, última linha de saída já limpa, redigida e truncada.
import type { AtividadeTerminal, EstadoSessao, FerramentaId } from "./terminais";

export const VERSAO_RESUMO_WORKSPACES = 1 as const;

/** Estado legível do agente: o que ele faz agora (a cor nunca é o único sinal). */
export type EstadoAgenteResumo = "iniciando" | "trabalhando" | "aguardando" | "pronto" | "ocioso" | "erro";

export interface AgenteResumo {
  sessao_id: string;
  /** Pane de Missão/painel livre dono da sessão (null = terminal de CLI avulso). */
  pane_id: string | null;
  mission_id: string | null;
  /** sessão do agente que abriu este (piloto → workers); null = raiz da árvore. */
  pai_sessao_id: string | null;
  /** 0 = raiz (piloto ou avulso); 1 = worker aberto por um piloto. */
  profundidade: number;
  ferramenta_id: FerramentaId;
  /** nome legível, sem conteúdo do trabalho: "Claude Code · piloto", "Codex · executor #3". */
  titulo: string;
  papel: string | null;
  piloto: boolean;
  estado: EstadoAgenteResumo;
  sessao_estado: EstadoSessao;
  atividade: AtividadeTerminal | null;
  /** epoch ms do início da sessão (null = desconhecido). */
  desde: number | null;
  /** epoch ms da última mudança de atividade vista pelo painel (null = nenhuma). */
  atividade_em: number | null;
  /** última linha de saída limpa de ANSI, redigida pelo scrubber do cofre e truncada (~80); null se nada legível. */
  linha: string | null;
  /** subagentes INTERNOS da CLI (somente leitura; nunca são terminais). */
  subagentes: { total: number; ativos: number } | null;
}

export interface MissaoResumo {
  id: string;
  titulo: string;
  modo: string;
  estado: string;
  /** Pane piloto (sessão) para focar ao abrir a Missão pelo painel. */
  piloto_sessao_id: string | null;
}

export interface ExecucaoResumo {
  fase: string;
  nome: string | null;
  porta: number | null;
  sessao_id: string | null;
  iniciado_em: number | null;
}

export interface ContagensWorkspace {
  agentes: number;
  trabalhando: number;
  aguardando: number;
  erro: number;
  subagentes: number;
  terminais: number;
}

export interface ItemWorkspaceResumo {
  id: string;
  nome: string;
  /** início mascarado como ~, separadores normalizados. */
  pasta_mascarada: string;
  branch: string | null;
  /** null = ainda não medido (o painel nunca dispara varredura: só usa o que o Versionamento já observou). */
  sujo: boolean | null;
  atual: boolean;
  missao: MissaoResumo | null;
  /** Missões ativas além da exibida. */
  missoes_ativas: number;
  agentes: AgenteResumo[];
  execucao: ExecucaoResumo | null;
  contagens: ContagensWorkspace;
}

export interface ResumoWorkspaces {
  versao: 1;
  gerado_em: number;
  itens: ItemWorkspaceResumo[];
}

export interface PedidoEncerrarAgente { workspace_id: string; sessao_id: string }
export interface ResultadoEncerrarAgente { ok: boolean; motivo: "encerrado" | "desconhecido" | "outro_workspace" | "falhou" }
