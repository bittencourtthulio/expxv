// Contratos do Maestro (Fase 16, T-16.01 parte pura). Tipos puros e conjuntos fechados; sem I/O, sem Electron.
// Canais IPC e validadores ficam com o coordenador (ipc.ts); aqui só o vocabulário compartilhado entre main e renderer.
import type { Faixa } from "./harness";
import type { NivelRigidez } from "./squads";

export type { Faixa, NivelRigidez };
export { NIVEIS_RIGIDEZ } from "./squads";

// ---------------------------------------------------------------- intenção
export const INTENCOES = ["bug", "feature", "pedido", "projeto", "refatoracao", "entrega", "duvida", "historico", "convencoes", "design", "onboarding", "controle", "desconhecida"] as const;
export type Intencao = (typeof INTENCOES)[number];
/** Intenções que o léxico pontua (tudo menos `desconhecida`). */
export const INTENCOES_PONTUAVEIS = INTENCOES.filter((i) => i !== "desconhecida") as readonly Exclude<Intencao, "desconhecida">[];
/** Intenções que abrem um pipeline com terminal (o hook só encaminha estas). */
export const INTENCOES_ACIONAVEIS: readonly Intencao[] = ["bug", "feature", "refatoracao", "projeto", "entrega", "pedido"];

export const PIPELINES_IDS = ["runx", "sprintx", "sprintx_legadox", "prodx", "buildx", "mergex", "stackx", "designx", "onboarding", "rapido", "consulta", "controle"] as const;
export type PipelineId = (typeof PIPELINES_IDS)[number];

export const VIAS_MAESTRO = ["mcp", "hook", "paleta", "chat", "issue", "telegram", "api", "squad"] as const;
export type ViaMaestro = (typeof VIAS_MAESTRO)[number];
/** Vias remotas: só podem SUBIR a rigidez e nunca sobrescrevem trava (D-223). */
export const VIAS_REMOTAS: readonly ViaMaestro[] = ["telegram", "issue"];

export type FonteIntencao = "comando" | "explicito" | "regra" | "decisor" | "regra+decisor" | "fallback";
export type FaixaConfianca = "alta" | "media" | "baixa";

export interface ContextoPedido {
  pane_id: string | null;
  mission_id: string | null;
  trabalho_id: string | null;
  arquivos: string[];
  trecho: string | null;
}
export interface PedidoMaestro {
  workspace_id: string;
  texto: string;
  contexto: ContextoPedido | null;
  via: ViaMaestro;
  nivel_pedido: NivelRigidez | null;
  executar_direto: boolean | null;
}
export type TipoReferencia = "OC" | "PD" | "FT" | "slug";
export interface ResultadoClassificacao {
  intencao: Intencao;
  confianca: number;
  faixa: FaixaConfianca;
  pontos: Partial<Record<Intencao, number>>;
  candidatas: Array<{ intencao: Intencao; confianca: number }>;
  sinais: string[];
  retomar: { tipo: TipoReferencia; id: string } | null;
  sugestao_nivel: NivelRigidez | null;
  fonte: "comando" | "explicito" | "regra";
  tempo_ms: number;
  /** B10: pedido de revisar/mergear PR (o plano traz só a etapa humana). */
  so_humano?: boolean;
}

// ---------------------------------------------------------------- etapas
export const ETAPA_IDS = [
  "memox.consultar",
  "prodx.p1", "prodx.p0", "prodx.p25", "prodx.assinatura", "prodx.briefing",
  "legadox.perfil", "legadox.raio", "legadox.caracterizar", "legadox.divida", "legadox.manual",
  "runx.e1", "runx.e2", "runx.e3", "runx.e4", "runx.e5",
  "sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f35", "sprintx.f4", "sprintx.f5", "sprintx.f6",
  "stackx.detectar", "stackx.check", "stackx.atualizar",
  "designx.cartography", "designx.audit",
  "mergex.check", "mergex.atencao", "mergex.qa", "mergex.pr", "mergex.revisar",
  "buildx.condutor", "onboarding.executar", "rapido.executar", "consulta.rag",
] as const;
export type EtapaId = (typeof ETAPA_IDS)[number];

export type TipoEtapa = "investigador" | "planejador" | "implementador" | "avaliador" | "utilitario" | "humano" | "consulta";
export type ModoExecucao = "novo_terminal" | "reusar_terminal" | "confirmar" | "desligada";
export const MODOS_EXECUCAO: readonly ModoExecucao[] = ["novo_terminal", "reusar_terminal", "confirmar", "desligada"];

export interface PerfilEtapa {
  cli: string | "auto";
  modelo: string | null;
  esforco: string | null;
  faixa: Faixa;
  origem_modelo: "cli" | "openrouter";
  agente_id: string | null;
}
export type AtualizadoPor = "usuario" | "fabrica" | "importado";
export interface EtapaConfig {
  etapa_id: string;
  perfil: PerfilEtapa;
  skills: string[];
  modo_execucao: ModoExecucao;
  atualizado_por: AtualizadoPor;
}
/** Perfil efetivo depois do `resolverPerfil` (conta/modelo por consumo). Sem segredo. */
export interface PerfilEfetivo {
  cli: string;
  modelo: string | null;
  esforco: string | null;
  esforco_modo: "flag" | "config" | "indicativo" | "nenhum" | null;
  faixa: Faixa | null;
  conta_id: string | null;
  origem_modelo: "cli" | "openrouter";
  agente_id: string | null;
}

export interface EtapaDoPlano {
  etapa_id: EtapaId;
  ordem: number;
  estado_inicial: "pendente" | "pulada_nivel" | "pulada_usuario" | "humano" | "confirmar";
  tipo: TipoEtapa;
  comando: string | null;
  perfil: PerfilEfetivo | null;
  resumo_perfil: string | null;
  reduz: boolean;
  piso: boolean;
  reforco: string | null;
  agrupa_com_anterior: boolean;
  motivo: string | null;
  /** número de avaliações independentes (nível 5 = 2). */
  avaliacoes?: number;
}
export type TrocaPipeline = "rapido";

export interface PlanoMaestro {
  id: string;
  intencao: Intencao;
  pipeline_id: PipelineId;
  confianca: number;
  fonte: FonteIntencao;
  nivel: NivelRigidez;
  nivel_origem: "pedido" | "missao" | "squad" | "workspace" | "padrao";
  etapas: EtapaDoPlano[];
  alvo: { trabalho_id: string | null; retomada: boolean; estagio_atual: string | null };
  avisos: string[];
  trava: { minimo: NivelRigidez; motivo: string } | null;
  hooks_a_aplicar: Array<{ nome: string; modo: "aviso" | "bloqueio" | "desligado" }>;
  executar_direto: boolean;
  expira_em: string;
  /** candidatas quando a confiança é média/baixa (o usuário escolhe). */
  candidatas?: Array<{ intencao: Intencao; confianca: number }>;
  /** módulos da suíte DESLIGADOS no projeto que este pipeline usa (D-480): plano indisponível, nada é despachado; "ative o módulo X". */
  modulos_desligados?: string[];
}

export interface ReciboMaestro {
  id: string;
  pipeline_id: string | null;
  intencao: Intencao;
  confianca: number;
  fonte: FonteIntencao;
  decididor: { tipo: "regra" | "jev" | "openrouter"; modelo: string | null; endpoint_host: string | null; latencia_ms: number | null; custo_usd: number | null };
  escolha_regra: Intencao | null;
  escolha_decisor: Intencao | null;
  divergiu: boolean;
  nivel: NivelRigidez;
  texto: string;
}

export interface PipelineResumo {
  id: string;
  pipeline_id: PipelineId;
  estado: string;
  etapa_atual: string | null;
  etapas: Array<{ etapa_id: string; estado: string; pane_id: string | null }>;
  nivel_atual: NivelRigidez;
  mission_id: string | null;
  trabalho_id: string | null;
}

/** Porta que o chat (Fase 15), o Telegram (Fase 20) e o Maestro compartilham. */
export interface PortaMaestro {
  classificar(texto: string, ctx: { workspace_id: string; contexto: ContextoPedido | null }): Promise<ResultadoClassificacao>;
  pedir(p: PedidoMaestro): Promise<{ plano: PlanoMaestro; recibo: ReciboMaestro }>;
  confirmar(plano_id: string, ajustes?: { nivel?: NivelRigidez; etapas_desligadas?: string[]; intencao?: Intencao }): Promise<PipelineResumo>;
  cancelar(id: string): Promise<void>;
}

export const ESTADOS_PIPELINE = ["proposto", "executando", "aguardando_humano", "aguardando_usuario", "aguardando_confirmacao", "bloqueado_piso", "bloqueado_trava", "pausado", "concluido", "concluido_parcial", "falhou", "cancelado", "expirado"] as const;
export type EstadoPipeline = (typeof ESTADOS_PIPELINE)[number];
export const ESTADOS_PIPELINE_TERMINAIS: readonly EstadoPipeline[] = ["concluido", "concluido_parcial", "falhou", "cancelado", "expirado"];

export const ESTADOS_ETAPA = ["pendente", "pulada_nivel", "pulada_usuario", "despachando", "executando", "aguardando_humano", "aguardando_usuario", "aguardando_confirmacao", "concluida", "reprovada", "falhou", "sem_progresso"] as const;
export type EstadoEtapa = (typeof ESTADOS_ETAPA)[number];

// ---------------------------------------------------------------- estado do pipeline (máquina; serializável, sem texto do usuário)
export interface EtapaExec {
  etapa_id: EtapaId;
  ordem: number;
  tentativa: number;
  rodada: number;
  estado: EstadoEtapa;
  pane_id: string | null;
  perfil: PerfilEfetivo | null;
  nivel: NivelRigidez;
  comando: string | null;
  reutilizou_pane: boolean;
  detectada_por: "disco" | "rastro" | "timeout" | "usuario" | null;
  inicio_em: string | null;
  fim_em: string | null;
  detalhe: string | null;
  tipo: TipoEtapa;
  piso: boolean;
  reduz: boolean;
  reforco: string | null;
  agrupa_com_anterior: boolean;
  avaliacoes: number;
  /** o usuário confirmou esta etapa (clique) quando ela exige confirmação. */
  confirmada: boolean;
  /** o Pane desta etapa já foi encerrado pelo Maestro (`fechar_concluidos`). */
  pane_fechado?: boolean;
}
export interface PipelineEstado {
  id: string;
  workspace_id: string;
  mission_id: string | null;
  trabalho_id: string | null;
  pipeline_id: PipelineId;
  intencao: Intencao;
  estado: EstadoPipeline;
  via: ViaMaestro;
  origem_pane_id: string | null;
  texto_hash: string;
  /** ≤ 200 chars JÁ REDIGIDO. */
  texto_resumo: string;
  nivel_base: NivelRigidez;
  nivel_atual: NivelRigidez;
  nivel_pedido: NivelRigidez | null;
  executar_direto: boolean;
  voltar_ao_padrao: boolean;
  /** override de trava com justificativa registrada (a trava deixa de bloquear). */
  override_trava: boolean;
  plano: PlanoMaestro;
  execs: EtapaExec[];
  motivo_fim: string | null;
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
}

// ---------------------------------------------------------------- IPC (onda 2): payloads dos canais `maestro:*`, `pipelines:*` e `rigidez:*`
// O renderer nunca envia caminho, cwd, URL nem chave: só ids, enums, níveis e o texto do pedido (≤ 4 000). Segredo não existe nestes canais.
export const TEXTO_PEDIDO_MAX = 4000;
/** Vias que o renderer pode declarar (as demais nascem no main: mcp, hook, issue, telegram, squad). */
export const VIAS_DO_RENDERER = ["paleta", "chat"] as const satisfies readonly ViaMaestro[];
export type ViaDoRenderer = (typeof VIAS_DO_RENDERER)[number];
export const ACOES_DO_PIPELINE = ["pausar", "retomar", "pular_etapa", "reabrir_etapa", "confirmar_etapa", "abrir_arquivo"] as const;
export type AcaoDoPipelineIpc = (typeof ACOES_DO_PIPELINE)[number];

export interface PedidoPedirMaestro {
  workspace_id: string;
  texto: string;
  contexto: ContextoPedido | null;
  via: ViaDoRenderer;
  nivel_pedido: NivelRigidez | null;
  executar_direto: boolean | null;
}
export interface RespostaPedirMaestro {
  plano: PlanoMaestro;
  recibo: ReciboMaestro;
}
export interface PedidoConfirmarMaestro {
  plano_id: string;
  nivel: NivelRigidez | null;
  etapas_desligadas: string[];
  intencao: Intencao | null;
  /** ≥ 20 caracteres em override de trava de raio ALTO. */
  justificativa: string | null;
  /** a frase `baixar` digitada em branch protegida/produção. */
  confirmacao_digitada: string | null;
}
export interface PedidoListarPipelines {
  workspace_id: string;
  so_ativos: boolean;
  limite: number;
}
export interface ItemDePisoDto {
  id: string;
  titulo: string;
  estado: "ok" | "violado" | "nao_comprovado";
  detalhe: string;
}
export interface DetalhePipeline {
  id: string;
  workspace_id: string;
  mission_id: string | null;
  trabalho_id: string | null;
  pipeline_id: PipelineId;
  intencao: Intencao;
  estado: EstadoPipeline;
  via: ViaMaestro;
  /** ≤ 200, já redigido. */
  texto_resumo: string;
  nivel_atual: NivelRigidez;
  nivel_base: NivelRigidez;
  override_trava: boolean;
  plano: PlanoMaestro;
  execs: EtapaExec[];
  recibo: ReciboMaestro | null;
  piso: ItemDePisoDto[];
  motivo_fim: string | null;
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
  /** caminho RELATIVO do arquivo que a pessoa precisa abrir (assinatura, VEREDITO.md…), se houver. */
  arquivo_humano: string | null;
}
export interface PedidoAcaoPipeline {
  id: string;
  acao: AcaoDoPipelineIpc;
  etapa_id: string | null;
}
export interface PedidoListarRecibos {
  workspace_id: string;
  limite: number;
}
/** Config `maestro.*` por workspace (sem segredo). `confirmar_plano = false` exige `confirmado: true` ao gravar. */
export interface ConfigMaestroDto {
  confirmar_plano: boolean;
  hook_modo: "desligado" | "notificar" | "encaminhar";
  hook_confianca_min: number;
  producao: boolean;
  branches_protegidas: string[];
  escrever_hooks: boolean;
  hooks_aplicar_ja: boolean;
  max_terminais: number;
  fechar_concluidos: boolean;
  timeout_sem_progresso_min: number;
  proposta_expira_min: number;
}
export interface PedidoGravarConfigMaestro {
  workspace_id: string;
  config: ConfigMaestroDto;
  confirmado: boolean;
}
export interface EventoMaestro {
  workspace_id: string;
  pipeline_id: string | null;
  tipo: string;
  estado: EstadoPipeline | null;
  etapa_id: string | null;
}

// ---- pipelines (catálogo e configuração por etapa)
export interface EtapaDefDto {
  id: EtapaId;
  skill: string;
  nome: string;
  comando: string | null;
  tipo: TipoEtapa;
  interativa: boolean;
  humano: boolean;
  piso: boolean;
}
export interface PipelineDefDto {
  id: PipelineId;
  nome: string;
  passos: Array<{ etapa: EtapaId; piso: boolean; laco: EtapaId | null }>;
}
export interface DescricaoNivelDto {
  nivel: NivelRigidez;
  nome: string;
  semantica: string;
  ligado: string;
  desligado: string;
  quando: string;
}
export interface CatalogoPipelines {
  etapas: EtapaDefDto[];
  pipelines: PipelineDefDto[];
  niveis: DescricaoNivelDto[];
}
export interface AchadoPipeline {
  codigo: string;
  severidade: "erro" | "aviso";
  etapa_id: string;
  mensagem: string;
  relacionadas?: string[];
}
export type OrigemEtapaConfig = "workspace" | "global" | "fabrica";
export interface EtapaConfigEfetiva {
  config: EtapaConfig;
  origem: OrigemEtapaConfig;
}
export interface PerfilProntoDto {
  id: string;
  nome: string;
  descricao: string;
}
export interface PedidoConfigListar {
  workspace_id: string | null;
}
export interface PedidoConfigGravar {
  workspace_id: string | null;
  config: EtapaConfig;
}
export interface ResultadoConfigGravar {
  config: EtapaConfigEfetiva;
  achados: AchadoPipeline[];
}
export interface PedidoConfigRestaurar {
  workspace_id: string | null;
  etapa_id: string | null;
}
export interface PedidoValidarConfigs {
  workspace_id: string | null;
  configs: EtapaConfig[];
}
export interface PedidoAplicarPronto {
  workspace_id: string | null;
  pronto_id: string;
  cli: "manter" | "auto";
}
export interface PedidoExportarPipelines {
  workspace_id: string | null;
  destino: "repo" | "arquivo";
}
export interface ResultadoExportarPipelines {
  cancelado: boolean;
  caminho_relativo: string | null;
}
export interface PedidoImportarPreviaPipelines {
  workspace_id: string | null;
  origem: "repo" | "arquivo";
}
export interface PreviaImportacaoPipelines {
  previa_id: string | null;
  configs: EtapaConfig[];
  achados: AchadoPipeline[];
  erros: Array<{ campo: string; motivo: string }>;
  cancelado: boolean;
}
export interface PedidoImportarConfirmarPipelines {
  previa_id: string;
  workspace_id: string | null;
}

// ---- rigidez
export type OrigemNivelIpc = "pedido" | "missao" | "squad" | "workspace" | "padrao";
export interface PedidoLerRigidez {
  workspace_id: string;
  mission_id: string | null;
  plano_id: string | null;
}
export interface EstadoRigidez {
  efetivo: NivelRigidez;
  origem: OrigemNivelIpc;
  workspace: NivelRigidez | null;
  missao: NivelRigidez | null;
  minimo_travado: NivelRigidez;
  motivo_trava: string | null;
  /** o nível atual é < 3 e merece lembrete (conclusão/8 h). */
  lembrete: string | null;
}
export type EscopoRigidez = "workspace" | "missao" | "pedido";
export interface PedidoDefinirRigidez {
  workspace_id: string;
  escopo: EscopoRigidez;
  mission_id: string | null;
  plano_id: string | null;
  nivel: NivelRigidez;
  justificativa: string | null;
  /** a frase `baixar` digitada (branch protegida/produção). */
  confirmacao_digitada: string | null;
  aplicar_hooks_ja: boolean;
  voltar_ao_padrao: boolean;
}
export interface ResultadoDefinirRigidez {
  efetivo: NivelRigidez;
  hooks: { escrito: boolean; agendado: boolean; arquivo: string | null; aviso: string | null };
  estado: EstadoRigidez;
}
export interface CelaDto {
  modo: "roda" | "reduzida" | "reforco" | "omitida" | "humano" | "substituida";
  agrupa: boolean;
  avaliacoes: number | null;
  confirma: boolean;
  nota: string | null;
}
export interface MatrizRigidezDto {
  niveis: DescricaoNivelDto[];
  /** `parametros[nivel]` = ParametrosDoNivel (dado estático; chaves legíveis). */
  parametros: Record<string, Record<string, unknown>>;
  celulas: Array<{ etapa_id: EtapaId; por_nivel: Record<string, CelaDto> }>;
  hooks_por_nivel: Record<string, Record<string, "aviso" | "bloqueio" | "desligado">>;
}
export interface PedidoPreviaPlano {
  workspace_id: string;
  pipeline_id: PipelineId;
  nivel: NivelRigidez;
}
export interface PedidoHooksEstado {
  workspace_id: string;
  mission_id: string | null;
}
export interface EstadoHooksDto {
  arquivo: string;
  presente: boolean;
  invalido: boolean;
  gerenciadas: string[];
  nivel_aplicado: NivelRigidez | null;
  /** o método (`.expx/`) existe no diretório alvo; sem ele o ADE não cria nada. */
  metodo_instalado: boolean;
}
export interface EventoRigidez {
  workspace_id: string;
  mission_id: string | null;
  nivel: NivelRigidez;
  escopo: EscopoRigidez;
}
