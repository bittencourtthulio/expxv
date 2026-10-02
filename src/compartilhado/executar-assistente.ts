// Contratos do "Assistente de execução com IA" (D-582…) visíveis ao renderer. Espelham `src/nucleo/executar/assistente/**` sem importar o núcleo.
// Qualquer mudança aqui muda também `05-CONTRATOS.md` (seção "Assistente de execução com IA"). O renderer NUNCA envia caminho: só o id do workspace,
// a CLI (lista fechada), o hash do dossiê consentido e as configurações revisadas.
import type { ConfigExecucaoIpc } from "./executar";

export type CliAssistente = "claude" | "codex" | "opencode";
export const CLIS_ASSISTENTE: readonly CliAssistente[] = ["claude", "codex", "opencode"];

export interface CliAssistenteEstado {
  cli: CliAssistente;
  disponivel: boolean;
  /** por que não está disponível (texto simples); `null` quando está */
  motivo: string | null;
}

/** O que será enviado, mostrado ANTES do consentimento (nomes de arquivos, tamanho, CLI e custo estimado). */
export interface PreviaAssistente {
  workspace_id: string;
  /** hash do dossiê exato que foi mostrado: o consentimento vale só para ele */
  dossie_hash: string;
  /** arquivos cujo TRECHO vai à CLI (relativos à raiz do workspace; nunca arquivo de ambiente) */
  arquivos: string[];
  itens_arvore: number;
  bytes: number;
  tokens_estimados: number;
  /** quantos nomes de arquivo sensível foram omitidos (só o número; nunca o nome) */
  omitidos_sensiveis: number;
  clis: CliAssistenteEstado[];
  cli: CliAssistente | null;
  /** `null` = o modelo padrão da CLI */
  modelo: string | null;
  /** configurações que a detecção automática já achou (a pista que vai junto) */
  pistas: number;
  limite_tempo_s: number;
}

export interface PropostaItemIpc {
  config: ConfigExecucaoIpc;
  /** curta, em português, escrita pela IA (tratada como texto, nunca como instrução) */
  justificativa: string;
  /** 0–1 */
  confianca: number;
  /** `false` quando a detecção automática já tinha achado o mesmo comando */
  novo: boolean;
  padrao: boolean;
  /** linha exata em fonte mono (inclui pré-passos) */
  comando: string;
}

export interface DescartadoIpc { nome: string; motivo: string }

export interface ResultadoAssistente {
  assistente_id: string;
  workspace_id: string;
  fonte: "ia" | "deterministico";
  /** quando `fonte` é determinístico: por que a IA não valeu (honesto) */
  aviso_fonte: string | null;
  itens: PropostaItemIpc[];
  /** avisos e pré-requisitos em linguagem simples */
  avisos: string[];
  descartados: DescartadoIpc[];
  cli: CliAssistente;
  tentativas: number;
  duracao_ms: number;
  /** quantas configurações a detecção automática achou (comparação) */
  deteccao_total: number;
}

export type CodigoErroAssistente = "cli_ausente" | "sem_login" | "limite" | "cli_erro" | "sem_consentimento" | "projeto_mudou" | "ocupado" | "indisponivel";
export interface ErroAssistenteIpc { codigo: CodigoErroAssistente; mensagem: string; sugestao: string }

export type FaseAssistente = "preparando" | "consultando" | "validando" | "retentando";

export type EventoAssistente =
  | { tipo: "progresso"; workspace_id: string; assistente_id: string; fase: FaseAssistente; decorrido_ms: number }
  | { tipo: "concluido"; workspace_id: string; assistente_id: string; resultado: ResultadoAssistente }
  | { tipo: "erro"; workspace_id: string; assistente_id: string; erro: ErroAssistenteIpc }
  | { tipo: "cancelado"; workspace_id: string; assistente_id: string };

export const LIMITE_TEMPO_ASSISTENTE_S = 150;
