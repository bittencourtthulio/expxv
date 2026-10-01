// Contratos do harness (Fase 9): política, faixas, rota, troca, perfis, intenção, decisor, cofre e OpenRouter.
// Tipos e constantes puros. Overrides do dono: P-28 (3 modos de troca, até 3 saltos, troca de provedor permitida,
// faixa mínima configurável com `descer_1`), P-31 (descer 1 faixa permitido), P-16 (adaptador JEV genérico),
// P-17 (OpenRouter com todas as CLIs compatíveis), P-29 (cofre com senha-mestra no Linux sem keyring).
import type { Papel } from "../nucleo/dominio/enums";
import type { Permissao } from "../nucleo/dominio/enums";
import type { AccountUsage } from "./limites";

export type { Papel };

// ---- faixas e política ----
export type Faixa = "topo" | "alto" | "medio" | "rapido";
export const FAIXAS: readonly Faixa[] = ["topo", "alto", "medio", "rapido"];

/** provider = id de ROTEAMENTO: id de CLI do catálogo ou "openrouter" (com `cli` = CLI a lançar). */
export interface Executor {
  provider: string;
  cli: string | null;
  model: string | null;
  effort: string | null;
  faixa: Faixa | null;
}
export const ATUALIZADO_POR = ["usuario", "mcp", "semente"] as const;
export type AtualizadoPor = (typeof ATUALIZADO_POR)[number];

export interface Politica {
  id: string;
  /** `null` = global. */
  workspace_id: string | null;
  task_type: string;
  executor: Executor;
  alternativas: Executor[];
  /** ≥ 1: nunca vazio. */
  fallback: Executor[];
  skills: string[];
  agente: string | null;
  conta_fixa_id: string | null;
  evitar_reservadas: boolean;
  habilitada: boolean;
  atualizado_por: AtualizadoPor;
  atualizado_em: string;
}
/** O que o renderer/MCP envia ao gravar (sem `id`, `atualizado_*`). */
export type PoliticaEntrada = Omit<Politica, "id" | "atualizado_por" | "atualizado_em">;

export interface TaskType {
  slug: string;
  categoria: string;
  rotulo: string;
  descricao: string | null;
  embutido: boolean;
}
export type TaskTypeEntrada = Omit<TaskType, "embutido">;

// ---- modos de troca (P-28) ----
export type ModoTroca = "manual" | "so_sugerir" | "automatico";
export const MODOS_TROCA: readonly ModoTroca[] = ["manual", "so_sugerir", "automatico"];
/** `descer_1` = pode descer UMA faixa (com aviso, P-31); `qualquer` = sem piso. */
export type FaixaMinimaTroca = "mesma" | "descer_1" | "qualquer";
export const FAIXAS_MINIMAS_TROCA: readonly FaixaMinimaTroca[] = ["mesma", "descer_1", "qualquer"];
export const MOTIVOS_TROCA = ["consumo_alto", "limite_atingido", "manual"] as const;
export const TIPOS_TROCA = ["outra_conta", "outro_provedor", "faixa_inferior"] as const;
export const STATUS_TROCA = ["sugerida", "feita", "ignorada", "adiada", "falhou"] as const;
export const ADIADA_POR = ["trabalhando", "operacao_git", "handoff_em_voo", "pergunta_pendente"] as const;
export type AcaoTroca = "aceitar" | "ignorar" | "adiar_30min";
export const ACOES_TROCA: readonly AcaoTroca[] = ["aceitar", "ignorar", "adiar_30min"];

/** Padrões (P-28). */
export const PADROES_HARNESS = {
  nivel: 4,
  limiar_troca_pct: 85,
  limiar_esgotamento_pct: 100,
  margem_troca_pontos: 10,
  troca_entre_provedores: true,
  faixa_minima_troca: "mesma" as FaixaMinimaTroca,
  max_saltos: 3,
  espera_ponto_seguro_s: 600,
  piloto_edita_politica: false,
  injetar_cofre_no_env: false,
} as const;

/** Linha `harness_workspace` (booleanos como booleano). */
export interface ConfigHarness {
  workspace_id: string;
  /** 1..4 */
  nivel: number;
  /** `null` = derivar de `workspace.permissao`. */
  modo_troca: ModoTroca | null;
  limiar_troca_pct: number;
  limiar_esgotamento_pct: number;
  margem_troca_pontos: number;
  troca_entre_provedores: boolean;
  faixa_minima_troca: FaixaMinimaTroca;
  max_saltos: number;
  espera_ponto_seguro_s: number;
  piloto_edita_politica: boolean;
  injetar_cofre_no_env: boolean;
  atualizado_em: string;
}
export type ConfigHarnessEntrada = Omit<ConfigHarness, "atualizado_em">;

/** automatico→automatico, seguro→so_sugerir (padrão derivado, P-28). */
export function modoTrocaEfetivo(modo: ModoTroca | null, permissao: Permissao): ModoTroca {
  return modo ?? (permissao === "automatico" ? "automatico" : "so_sugerir");
}

// ---- roteamento por conta (nunca segredo) ----
export type AuthConta = "ok" | "expirada" | "desconhecida";
export const AUTH_CONTA: readonly AuthConta[] = ["ok", "expirada", "desconhecida"];
export interface ContaRoteamento {
  conta_id: string;
  reservada_modelos: string[];
  reservada_papeis: Papel[];
  workspaces_fixados: string[];
  auth: AuthConta;
  em_cooldown_ate: string | null;
  /** tetos só para a fonte "estimado" (Fase 10). */
  teto_tokens_5h: number | null;
  teto_tokens_semana: number | null;
  atualizado_em: string;
}
export interface ContaRoteamentoEntrada {
  conta_id: string;
  reservada_modelos: string[];
  reservada_papeis: Papel[];
  workspaces_fixados: string[];
  teto_tokens_5h?: number | null;
  teto_tokens_semana?: number | null;
}

// ---- rota, decisão, troca, perfis ----
export type FonteDecisao = "decisor" | "regra" | "politica" | "explicito" | "fallback";
export const FONTES_DECISAO: readonly FonteDecisao[] = ["decisor", "regra", "politica", "explicito", "fallback"];
export const PROPOSITOS_DECISAO = ["selecao_conta", "task_type", "modelo_esforco", "troca", "intencao"] as const;
export type PropositoDecisao = (typeof PROPOSITOS_DECISAO)[number];
export const TIPOS_DECISAO = ["choice", "score", "boolean"] as const;
export const CUSTO_ORIGENS = ["resposta", "tabela", "informado", "desconhecido"] as const;
export type CustoOrigem = (typeof CUSTO_ORIGENS)[number];

export interface PedidoDeRota {
  workspace_id: string;
  origem: "piloto" | "usuario" | "mcp" | "metodo";
  descricao: string | null;
  task_type: string | null;
  modo_rota: "auto" | "nenhuma";
  explicito: { provider?: string; cli?: string; model?: string; effort?: string; account_id?: string; skills?: string[]; agent?: string };
  mission_id: string | null;
  pane_pai_id: string | null;
  papel: Papel;
  excluir_provedores?: string[];
}
export interface ResultadoDeRota {
  executor: Executor;
  conta_id: string | null;
  task_type: string;
  decisoes: string[];
  fontes: { task_type: FonteDecisao; executor: FonteDecisao; conta: FonteDecisao };
  recibo: string;
  avisos: string[];
  skills_aplicadas: boolean;
}
export type ErroRoteamento =
  | "executor_disabled"
  | "no_capacity"
  | "unknown_task_type"
  | "provider_unavailable"
  | "invalid_effort"
  | "no_compatible_cli"
  | "model_not_enabled"
  | "openrouter_not_consented";

/** Decisão gravada (tabela `decisao`). `custo_usd: null` = desconhecido (nunca 0 por omissão). */
export interface Decisao {
  id: string;
  criado_em: string;
  proposito: PropositoDecisao;
  workspace_id: string | null;
  mission_id: string | null;
  pane_id: string | null;
  tipo: "choice" | "score" | "boolean";
  opcoes: string[];
  probs: Record<string, number> | null;
  escolhida: string;
  confianca: number | null;
  fonte: FonteDecisao;
  escolha_regra: string | null;
  divergiu: boolean;
  latencia_ms: number | null;
  custo_usd: number | null;
  custo_origem: CustoOrigem | null;
  decisor: { modo: string; host: string; modelo: string | null } | null;
  /** ≤ 500 chars já redigido; `null` se nada saiu da máquina. */
  resumo_enviado: string | null;
  resumo_hash: string | null;
  skills_aplicadas: boolean;
  recibo: string;
}
export type DecisaoEntrada = Omit<Decisao, "id" | "criado_em">;
export interface TotaisDecisoes {
  consultas: number;
  /** soma só dos custos conhecidos; `null` se nenhum é conhecido. */
  custo_usd: number | null;
  custo_desconhecido: number;
}

export interface PerfilAgente {
  agente_id: string | null;
  provider: string;
  cli: string | null;
  modelo: string | null;
  esforco: string | null;
  faixa: Faixa;
}
export interface Troca {
  id: string;
  criado_em: string;
  status: "sugerida" | "feita" | "ignorada" | "adiada" | "falhou";
  motivo: "consumo_alto" | "limite_atingido" | "manual";
  modo: ModoTroca;
  tipo_troca: "outra_conta" | "outro_provedor" | "faixa_inferior";
  de: { conta_id: string | null; provedor: string; modelo: string | null };
  para: { conta_id: string | null; provedor: string; modelo: string | null };
  consumo_origem_pct: number | null;
  consumo_destino_pct: number | null;
  adiada_por: string | null;
  recibo: string;
}
export interface ResultadoMoverPane {
  novo_pane_id: string;
  de: Troca["de"];
  para: Troca["para"];
}

export interface ContextoPerfil {
  workspace_id: string;
  papel: Papel;
  mission_id: string | null;
  implementador_provedor?: string | null;
  excluir?: string[];
}
export interface OpcaoIntencao {
  id: string;
  descricao: string;
  palavras?: string[];
}
export interface ContextoIntencao {
  workspace_id: string;
  opcoes?: OpcaoIntencao[];
  trabalho_ativo?: { tipo: string; estagio: string } | null;
  resumo_projeto?: string | null;
}
export interface ResultadoIntencao {
  intencao: string;
  confianca: number;
  fonte: "decisor" | "regra" | "fallback";
  decisao_id: string | null;
  alternativas: Array<{ id: string; p: number }>;
}
export type PedidoResolverPerfil = { skill: string; etapa: string; ctx: ContextoPerfil } | { perfil: PerfilAgente; ctx: ContextoPerfil };

// ---- pickAccount / pickModel (D-55, D-102) ----
export interface CandidataConta {
  conta_id: string;
  provedor: string;
  habilitada: boolean;
  auth: AuthConta;
  reservada_modelos: string[];
  reservada_papeis: Papel[];
  fixada_em: string[];
  cooldown_ate: string | null;
  uso: AccountUsage | null;
}
export interface OpcoesPick {
  modelo: string | null;
  papel: Papel;
  workspace_id: string;
  /** epoch ms. */
  agora: number;
  limiar_esgotamento_pct: number;
  limiar_troca_pct: number;
  estrategia: "expires_first" | "max_slack";
  janela: "five_hour" | "weekly" | "auto";
  conta_fixa_id: string | null;
  evitar_reservadas: boolean;
  excluir: string[];
}
export type MotivoDescarte = "desabilitada" | "auth" | "reservada" | "cooldown" | "esgotada" | "modelo_esgotado" | "fora_do_pin" | "excluida";
export interface ResultadoPick {
  escolhida: string | null;
  ranking: Array<{ conta_id: string; tier: 1 | 2 | 3 | 4; chave: Array<number | string>; motivo: string }>;
  descartadas: Array<{ conta_id: string; motivo: MotivoDescarte }>;
}
export interface ModeloEquivalente {
  modelo: string | null;
  esforco: string | null;
}
export type TabelaEquivalencia = Record<string, Partial<Record<Faixa, ModeloEquivalente[]>>>;
export interface EntradaEquivalencia {
  faixas: Faixa[];
  ordem_de_descida: Faixa[];
  provedores: TabelaEquivalencia;
}
export interface EstadoEquivalencia {
  padrao: EntradaEquivalencia;
  efetiva: EntradaEquivalencia;
  /** só as diferenças do usuário (o que vai para `config`). */
  diferencas: TabelaEquivalencia;
}
export interface OpcoesModelo extends Omit<OpcoesPick, "modelo" | "excluir" | "conta_fixa_id"> {
  atual: { provedor: string; conta_id: string | null; modelo: string | null; faixa: Faixa };
  provedores_viaveis: string[];
  clis_openrouter: string[];
  task_type: string | null;
  trocando: boolean;
  permitir_outro_provedor: boolean;
  faixa_minima: FaixaMinimaTroca;
  margem_troca_pontos: number;
  excluir_contas: string[];
  conta_fixa_id: string | null;
}
export interface ResultadoModelo {
  escolhida: { provedor: string; cli: string; modelo: string | null; esforco: string | null; conta_id: string; faixa: Faixa } | null;
  motivo: "mesma_conta_ok" | "outra_conta" | "outro_provedor" | "faixa_inferior" | "sem_alternativa";
  ranking: Array<{ provedor: string; modelo: string | null; faixa: Faixa; conta_id: string; tier: 1 | 2 | 3 | 4 }>;
  picks: Record<string, ResultadoPick>;
}

// ---- decisor externo (P-16: adaptador JEV genérico; desligado por padrão) ----
export type ModoDecisor = "jev_direto" | "jev_openrouter" | "openai_compat";
export const MODOS_DECISOR: readonly ModoDecisor[] = ["jev_direto", "jev_openrouter", "openai_compat"];
export type FormatoDecisor = "probs_json" | "openai_chat";
export const FORMATOS_DECISOR: readonly FormatoDecisor[] = ["probs_json", "openai_chat"];
export interface ConsentimentoDecisor {
  host: string;
  modo: ModoDecisor;
  em: string;
}
/** Config do decisor SEM chave: a chave só existe no cofre (`chave_ref` = NOME da entrada). */
export interface ConfigDecisor {
  habilitado: boolean;
  modo: ModoDecisor;
  formato: FormatoDecisor;
  /** https; jev_direto/openai_compat. */
  endpoint: string | null;
  /** nome do cabeçalho que leva a chave (P-16), ex.: `Authorization`, `x-api-key`. */
  cabecalho_chave: string;
  /** prefixo do valor do cabeçalho, ex.: `Bearer `; `null` = nenhum. */
  prefixo_chave: string | null;
  /** id do modelo (jev_openrouter/openai_compat). */
  modelo: string | null;
  conta_openrouter_id: string | null;
  chave_ref: string | null;
  usar_para: { task_type: boolean; modelo_esforco: boolean; intencao: boolean };
  /** 0..1 */
  confianca_minima: number;
  timeout_ms: number;
  custo_por_decisao_usd: number | null;
  alerta_diario: number;
  consentimento: ConsentimentoDecisor | null;
}
/** Gravar: o consentimento vai sem `em` (o main carimba). */
export type ConfigDecisorEntrada = Omit<ConfigDecisor, "consentimento"> & { consentimento: { host: string; modo: ModoDecisor } | null };
export interface ResultadoTesteDecisor {
  ok: boolean;
  latencia_ms: number | null;
  motivo?: string;
}

// ---- cofre (nunca expõe valor) ----
export const ESCOPOS_COFRE = ["global", "workspace"] as const;
export type EscopoCofre = (typeof ESCOPOS_COFRE)[number];
export interface EntradaCofre {
  id: string;
  /** UPPER_SNAKE */
  nome: string;
  escopo: EscopoCofre;
  workspace_id: string | null;
  sensivel: boolean;
  ultimo_uso_em: string | null;
}
export type BackendCofre = "safe_storage" | "senha_mestra" | "indisponivel";
export interface EstadoCofre {
  ok: boolean;
  backend: BackendCofre;
  /** `senha_mestra` com o cofre trancado (P-29). */
  bloqueado: boolean;
  motivo?: string;
}
export interface PedidoGravarCofre {
  /** `null` = nova entrada. */
  id: string | null;
  nome: string;
  escopo: EscopoCofre;
  workspace_id: string | null;
  sensivel: boolean;
  /** atravessa UMA vez e nunca volta. */
  valor: string;
}

// ---- OpenRouter (D-113) ----
export type TipoContaOpenRouter = "pago" | "gratuito" | "desconhecido";
export interface ModeloOpenRouter {
  id: string;
  nome: string;
  contexto: number | null;
  suporta_tools: boolean | null;
  preco_entrada_por_mtok: number | null;
  preco_saida_por_mtok: number | null;
  habilitado: boolean;
  faixa: Faixa | null;
  ordem: number;
  tipos_permitidos: string[];
}
export type StatusAdaptadorCli = "verificado" | "a_verificar" | "desligado";
export interface ContaOpenRouterEstado {
  conta_id: string;
  rotulo: string;
  ultimos4: string;
  tipo: TipoContaOpenRouter;
  limite_usd: number | null;
  usado_usd: number | null;
  saldo_usd: number | null;
  saldo_em: string | null;
}
export interface EstadoOpenRouter {
  habilitado: boolean;
  consentimento_em: string | null;
  contas: ContaOpenRouterEstado[];
  modelos: { total: number; habilitados: number; atualizados_em: string | null };
  clis: Array<{ cli: string; instalada: boolean; status: StatusAdaptadorCli }>;
  proxy: { ativo: boolean };
}
export interface ResultadoTesteOpenRouter {
  ok: boolean;
  tipo: TipoContaOpenRouter;
  limite_usd: number | null;
  saldo_usd: number | null;
  latencia_ms: number | null;
  motivo?: string;
}
export interface ResultadoAtualizarModelos {
  total: number;
  novos: number;
  removidos: number;
}
export interface PedidoListarModelosOpenRouter {
  busca?: string;
  so_habilitados?: boolean;
  cursor?: string;
  limite?: number;
}
export interface PaginaModelosOpenRouter {
  itens: ModeloOpenRouter[];
  proximo: string | null;
  total: number;
}
export interface PedidoGravarModeloOpenRouter {
  id: string;
  habilitado: boolean;
  faixa: Faixa | null;
  tipos_permitidos: string[];
  ordem: number;
}

// ---- listagens paginadas ----
export interface PedidoListarDecisoes {
  desde?: string;
  proposito?: PropositoDecisao;
  cursor?: string;
  limite?: number;
}
export interface PaginaDecisoes {
  itens: Decisao[];
  proximo: string | null;
  totais: TotaisDecisoes;
}
export interface PedidoListarTrocas {
  desde?: string;
  cursor?: string;
  limite?: number;
}
export interface PaginaTrocas {
  itens: Troca[];
  proximo: string | null;
}

/** Eventos `harness:evento` (renderer). */
export type EventoHarness =
  | { tipo: "troca_sugerida"; troca_id: string; pane_id: string }
  | { tipo: "troca_feita"; troca_id: string; pane_antigo_id: string; pane_novo_id: string }
  | { tipo: "troca_falhou"; troca_id: string; pane_id: string }
  | { tipo: "politica_mudou"; task_type: string; por: AtualizadoPor }
  | { tipo: "decisor_pausado"; ate: string; motivo: string };
