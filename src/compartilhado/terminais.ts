// Contrato dos terminais (main ↔ renderer). Adaptado do contrato de "Assistentes" do ExpxMedia
// (../ExpxMedia/docs/contrato/CONTRATO-assistentes.md): mesmo formato de fio, nomes do ADE.
// Tipos puros — sem runtime. Os validadores vivem em src/nucleo/terminais/ipc-validadores.ts.

export const VERSAO_TERMINAIS = 1 as const;

export const LIMITES_TERMINAIS = {
  argumentos: 64,
  argumento_bytes: 4_096,
  entrada_bytes: 64 * 1_024,
  colunas_min: 2,
  colunas_max: 500,
  linhas_min: 1,
  linhas_max: 300,
  /** painéis por janela (MVP; configurável depois). */
  sessoes_por_janela: 16,
  buffer_saida_bytes: 2 * 1_024 * 1_024,
} as const;

export type EstadoSessao = "iniciando" | "executando" | "encerrada" | "erro";

/** O que o agente faz por dentro da sessão, avisado pelos hooks da CLI (nunca adivinhado pela saída). */
export type AtividadeTerminal = "trabalhando" | "aguardando" | "pronto";
export const ATIVIDADES_TERMINAL: readonly AtividadeTerminal[] = ["trabalhando", "aguardando", "pronto"];

export type FerramentaId =
  | "terminal" | "claude" | "codex" | "gemini" | "opencode" | "aider" | "qwen" | "kilo" | "grok" | "personalizado";

export type ModoLancamento = "direto" | "cmd_wrapper" | "powershell_wrapper";
export type CodigoDeteccao = "ausente" | "sem_permissao" | "nao_mapeado";

/** O que a UI pode oferecer para a ferramenta, calculado no main (a UI nunca conhece flags). */
export interface RecursosFerramenta {
  prompt_inicial: boolean;
  retomar: boolean;
  /** aceita o servidor MCP do app (piloto/worker). */
  mcp: boolean;
  /** dispara atividade por hook (sinaleira exata). */
  hook: boolean;
}

export interface FerramentaDetectada {
  id: Exclude<FerramentaId, "personalizado">;
  nome: string;
  descricao: string;
  instalado: boolean;
  executavel_id: string | null;
  modo_lancamento: ModoLancamento | null;
  erro_codigo: CodigoDeteccao | null;
  versao: string | null;
  recursos: RecursosFerramenta;
}

/** Quem pede a sessão. O renderer NUNCA envia `cwd`: o main resolve pelo workspace/missão. */
export interface PedidoAbrirSessao {
  versao: 1;
  ferramenta_id: FerramentaId;
  executavel_id: string;
  argumentos: string[];
  colunas: number;
  linhas: number;
  /** workspace em que abrir (null = workspace atual do app). */
  workspace_id: string | null;
  /** id da conversa da CLI a retomar; vira argumento só depois de validado. */
  retomar?: string;
  /** prompt inicial por argumento da CLI. */
  prompt_inicial?: string;
}

export interface RespostaAbrirSessao {
  versao: 1;
  sessao_id: string;
  estado: "iniciando";
}

export interface MetadadosSessao {
  sessao_id: string;
  ferramenta_id: FerramentaId;
  estado: EstadoSessao;
  workspace_id: string | null;
  criada_em: string;
  persistente: boolean;
}

export type PapelLinhaSubagente = "prompt" | "texto" | "ferramenta" | "resultado";
export interface LinhaSubagente { papel: PapelLinhaSubagente; texto: string }

interface Base { versao: 1; sequencia: number; sessao_id: string }

export type EventoTerminal =
  | (Base & { tipo: "saida"; dados: string })
  | (Base & { tipo: "estado"; estado: EstadoSessao; erro_codigo: string | null; mensagem: string | null })
  /** `solicitado`: o app pediu o encerramento (orquestrador, dono, fim do trabalho): o código 143 ou o sinal NÃO são falha e nunca aparecem como tal. */
  | (Base & { tipo: "encerramento"; codigo: number | null; sinal: number | null; solicitado?: true })
  /** O app fechou a sessão de propósito (D-520): a interface tira o painel da grade na hora, sem "Sessão encerrada" pendurada. Vem ANTES do fim do processo. */
  | (Base & { tipo: "fechada" })
  | (Base & { tipo: "atividade"; atividade: AtividadeTerminal })
  | (Base & { tipo: "conversa"; conversa_id: string })
  | (Base & { tipo: "subagente_iniciado"; subagente_id: string; rotulo: string; descricao: string | null })
  | (Base & { tipo: "subagente_saida"; subagente_id: string; linhas: LinhaSubagente[] })
  | (Base & { tipo: "subagente_concluido"; subagente_id: string });

export interface FalhaTerminal { sessao_id: string; codigo: string; mensagem: string }

// ---- layout de painéis (árvore binária por aba; persistido no main por workspace) ----
export type NoLayout =
  | { tipo: "terminal"; sessao_id: string }
  /** `proporcao` (opcional, 0,05 a 0,95): fatia do PRIMEIRO filho; ausente = 0,5. Só o layout "orquestrador + workers" (D-515) a define. */
  | { tipo: "divisao"; orientacao: "horizontal" | "vertical"; proporcao?: number; primeiro: NoLayout; segundo: NoLayout };

export interface LayoutTerminais {
  versao: 2;
  ativa: string | null;
  abas: Array<{ arvore: NoLayout }>;
  fixadas: string[];
  /** D-570: painel que ocupava a aba inteira (modo foco com 2+ painéis); ausente = nenhum. */
  expandido?: string | null;
  /** D-570: modo foco de um painel só (esconde a linha de abas); ausente = falso. */
  foco_unico?: boolean;
}

// ---- anexos ----
export type ItemAnexo = { caminho: string } | { nome: string; bytes: Uint8Array };
export interface ResultadoAnexos { caminhos: string[]; texto: string }

// ---- diagnóstico copiável (só metadados) ----
export interface DiagnosticoTerminais {
  texto: string;
}

export interface ResultadoRecuperacao {
  sessoes: MetadadosSessao[];
}
