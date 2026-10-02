// Contrato de IPC entre main e renderer (05-CONTRATOS.md §2). Compartilhado pelos dois lados.
// Regra: canal só existe se estiver em `CanaisInvoke`/`CanaisEnvio`/`CanaisEvento` E tiver validador
// registrado no main (teste de contrato falha sem). O preload expõe uma API ENUMERADA — nunca
// `ipcRenderer` cru.

import type { PedidoAprovacaoWorkers, PreferenciaAprovacaoWorkers } from "./aprovacao-workers";
import type { AcaoPonteGrok, AprovacaoDoPane, PedidoAbrirPainelLivre, PedidoOrquestrarPainel, PedidoPonteGrok, PreferenciaPainelLivre, RespostaOrquestrarPainel, RespostaPainelLivre, RespostaPonteGrok } from "./painel-livre";
import type {
  Conta,
  DetalheMissao,
  EstadoWorkspaces,
  EventoRastro,
  IndiceProjeto,
  Mission,
  Pagina,
  PedidoCriarMissao,
  PedidoDispararComando,
  Permissao,
  ProvedorInfo,
  ResultadoDisparo,
  ResumoMudancaMetodo,
  Workspace,
  WorktreeInfo,
  ComandoSugerido,
  GestoMetodo,
  EstadoMissao,
  EstadoPortoes,
  PortaoMissao,
} from "./dominio";
import type {
  AcaoTroca,
  ConfigDecisor,
  ConfigDecisorEntrada,
  ConfigHarness,
  ConfigHarnessEntrada,
  ContaOpenRouterEstado,
  ContaRoteamento,
  ContaRoteamentoEntrada,
  ContextoIntencao,
  EntradaCofre,
  EstadoCofre,
  EstadoEquivalencia,
  EstadoOpenRouter,
  EventoHarness,
  ModeloOpenRouter,
  PaginaDecisoes,
  PaginaModelosOpenRouter,
  PaginaTrocas,
  PedidoGravarCofre,
  PedidoGravarModeloOpenRouter,
  PedidoListarDecisoes,
  PedidoListarModelosOpenRouter,
  PedidoListarTrocas,
  PedidoResolverPerfil,
  Politica,
  PoliticaEntrada,
  ResultadoAtualizarModelos,
  ResultadoDeRota,
  ResultadoIntencao,
  ResultadoMoverPane,
  ResultadoTesteDecisor,
  ResultadoTesteOpenRouter,
  TabelaEquivalencia,
  TaskType,
  TaskTypeEntrada,
  Troca,
} from "./harness";
import type {
  AchadoPipeline,
  CatalogoPipelines,
  DetalhePipeline,
  ConfigMaestroDto,
  EstadoHooksDto,
  EstadoRigidez,
  EtapaConfigEfetiva,
  EventoMaestro,
  EventoRigidez,
  MatrizRigidezDto,
  PedidoAcaoPipeline,
  PedidoAplicarPronto,
  PedidoConfigGravar,
  PedidoConfigListar,
  PedidoConfigRestaurar,
  PedidoConfirmarMaestro,
  PedidoDefinirRigidez,
  PedidoExportarPipelines,
  PedidoGravarConfigMaestro,
  PedidoHooksEstado,
  PedidoImportarConfirmarPipelines,
  PedidoImportarPreviaPipelines,
  PedidoLerRigidez,
  PedidoListarPipelines,
  PedidoListarRecibos,
  PedidoPedirMaestro,
  PedidoPreviaPlano,
  PlanoMaestro,
  PedidoValidarConfigs,
  PerfilProntoDto,
  PipelineResumo,
  PreviaImportacaoPipelines,
  ReciboMaestro,
  RespostaPedirMaestro,
  ResultadoConfigGravar,
  ResultadoDefinirRigidez,
  ResultadoExportarPipelines,
} from "./maestro";
import type {
  AlertaLimite,
  AmostraLimite,
  EficienciaSemana,
  EventoLimites,
  JanelaManual,
  PedidoHistoricoLimites,
  PrevisaoZerar,
  RespostaLimites,
  AccountUsage,
} from "./limites";
import type {
  AgenteResumo,
  EventoSquad,
  FabricaAtualizacao,
  FabricaDiff,
  ItemLixeiraSquad,
  OpcoesPerfilCli,
  PaginaExecucoes,
  PedidoAbrirAgente,
  PedidoApagarSquad,
  PedidoArquivoExecucao,
  PedidoDuplicarSquad,
  PedidoEnviarPrompt,
  PedidoExportarSquad,
  PedidoFabricaAplicar,
  PedidoFabricaDiff,
  PedidoGravarPrompt,
  PedidoGravarSquad,
  PedidoImportarConfirmar,
  PedidoImportarPrevia,
  PedidoListarExecucoes,
  PedidoListarSquads,
  PedidoPreflight,
  PedidoPreviaPrompt,
  PedidoRestaurarLixeira,
  PreviaImportacao,
  PromptLido,
  ResultadoArquivoExecucao,
  ResultadoEnviarPrompt,
  ResultadoExportarSquad,
  ResultadoGravarPrompt,
  ResultadoGravarSquad,
  ResultadoPreflight,
  ResultadoPreviaPrompt,
  Squad,
  SquadResumo,
  Achado,
} from "./squads";
import type {
  AchadoSaude,
  ApiCatalogo,
  ApiGateway,
  ConfigGateway,
  DetalheCatalogo,
  EntradaAuditoriaGateway,
  EstadoEmbarcada,
  EstadoGateway,
  EventoCatalogo,
  EventoGateway,
  FerramentaGateway,
  PedidoAuditoriaGateway,
  PedidoConfigGateway,
  PedidoDesinstalarCatalogo,
  PedidoFerramentasGateway,
  PedidoFiltroGateway,
  PedidoInstalarCatalogo,
  PedidoListarCatalogo,
  PedidoPoliticaGravar,
  PedidoPoliticaPrevia,
  PedidoRevelarCatalogo,
  PedidoVarrer,
  PoliticaResolvida,
  PoliticaSkills,
  ResultadoInstalar,
  ResultadoListarCatalogo,
  ResultadoVerificarMcp,
  TipoCatalogo,
  CliCatalogo as CliCatalogoIpc,
} from "./catalogo";
import type {
  AlvoHabilitacaoTipo,
  CliLojaMcp,
  ConsentimentoLoja,
  DetalheMcp,
  DiagnosticoLojaMcp,
  DiffAtualizacaoMcp,
  EstadoKitMcp,
  EventoLojaMcp,
  HabilitacaoMcp,
  ListaLojaMcp,
  LogMcp,
  PedidoInstalarMcp,
  PlanoKitMcp,
  PreviaCliMcp,
  ResultadoAcaoMcp,
  ResultadoCliMcp,
  ResultadoDescobertaMcp,
  ResultadoPlanoLoja,
  ResultadoTesteMcp,
  VariavelMcpEstado,
} from "./loja-mcp";
import type {
  AlvoVcs,
  EstadoVcs,
  EventoVcs,
  FamiliasVcs,
  PedidoDiff,
  PedidoFamilia,
  PedidoMissao,
  OperacoesMissao,
  ResumoVcs,
  SaidaDe,
  Diff as DiffVcs,
  ApiVcs,
} from "./vcs";
import type { ApiVcsPublicar, EstadoPublicacao, PedidoEnviarInstrucao, PedidoPedirMerge, PreparoAtualizar, PreparoPublicacao, ResultadoAtualizar, ResultadoBuscaRemoto, ResultadoEnviarInstrucao, ResultadoIgnorarSuite } from "./vcs-publicar";
import type {
  ApiMemoria,
  ConfigMemoria,
  EntradaMemoria,
  EstadoMemoriaApp,
  PaginaMemoria,
  PayloadsEventoMemoria,
  PedidoAtualizarMemoria,
  PedidoConfigMemoria,
  PedidoListarMemoria,
  PedidoPreferenciaMemoria,
  PedidoPurgarMemoria,
  PreviaBrief,
  ResultadoRestaurar,
  EscopoMemoria,
} from "./memoria";
import type {
  AlvoEsquecer,
  ApiConhecimento,
  ConfigConhecimentoDto,
  DetalheDocumento,
  DetalheNoGrafo,
  EstadoModelosEmbedding,
  FonteReindexar,
  Pagina as PaginaConhecimento,
  PayloadsEventoConhecimento,
  PedidoAtualizarAprendizado,
  PedidoBuscarConhecimento,
  PedidoContextoPrevia,
  PedidoFeedbackConhecimento,
  PedidoGravarConfigConhecimento,
  PedidoListarAprendizados,
  PedidoListarDocumentos,
  PedidoSubgrafo,
  PosicaoNo,
  RespostaSubgrafo,
} from "./conhecimento-api";
import type { Aprendizado, EstadoConhecimento, FonteResultado, RespostaBusca, RespostaContexto, TipoDocumento as _TipoDocumentoRag } from "./conhecimento";
import type {
  ApiChat,
  ConversaChatDto,
  ConversaCompleta,
  PayloadsEventoChat,
  PedidoCriarConversa,
  PedidoDecidirPlano,
  PedidoEnviarChat,
  PedidoGravarPerfilChat,
  PerfilChatEstado,
  PlanoChatDto,
} from "./chat";
import type {
  ApiRag,
  EstadoBackendRag,
  PayloadsEventoRag,
  PedidoConfigurarBackend,
  PedidoTestarBackend,
  PreviaMigracao,
  ProvedorRag,
  ProvedorRagDto,
  ResultadoTestarBackend,
  ResultadoVerificacaoMigracao,
} from "./rag";
import type { BichinhoVisao, EspecieId, EventoBichinhoMudou, UsoEspecie } from "./bichinho";
import type { AmostraSistema, DetalheSistema, PedidoAssinarSistema, PedidoDetalheSistema } from "./sistema";
import type { ApiProgresso, EstadoProgresso, EventoProgressoMudou } from "./progresso";
import type { AvaliacaoDestino, DestinoPai, EstadoGhAdicionar, EventoClone, LoteProjetos, PedidoAvaliarDestino, PedidoClonar, PedidoNovoProjeto, ResultadoIniciarClone, ResultadoNovoProjeto, ResultadoRepos } from "./workspaces-adicionar";
import type { EstadoModulosSuite, EstadoSuite, EventoModulosMudou, EventoSuite, ModoInstalacao, PadraoModulos, PlanoSuite, ResultadoModulos } from "./suite";
import type { ApiRelay, ConfigRelay, DispositivoRelay, ErroLigarRelay, ErroParearRelay, EstadoRelay, EventoRelayIpc, PareamentoRelayAberto, SasRelayVisao } from "./relay";
import type { AcaoTipada, ApiJarvis, ApiRemoto, CodigoRecusaJarvis, ConfigJarvis, ConfigRemoto, DispositivoVisao, EntradaAuditoriaJarvis, ErroLigarRemoto, EstadoJarvis, EstadoRemoto, EventoJarvisIpc, EventoRemotoIpc, PermissaoRemota, ResultadoJarvis, TransporteRemoto } from "./jarvis";
import type { ApiCaptura, ApiVoz, ConfigCaptura, ConfigVoz, DisparoVoz, EntradaHistoricoVoz, EstadoCaptura, EstadoPermissao, EstadoVoz, EventoCapturaIpc, EventoVozIpc, FonteCaptura, FormatoImagem, NomeSegredoVoz, PaginaCapturas, ResultadoAcaoCaptura, ResultadoAnexoCaptura, ResultadoRegiaoIniciar, RetanguloLogico, ServicoConsentimento, TermoVoz, CodigoErroVoz, CodigoErroCaptura } from "./captura";
import type { ListaModelosVoz, PedidoBaixarModelo, ProgressoModelo, ResultadoAutoteste, CodigoErroModelo } from "./voz-local";
import type { CodigoErroLaya, ConfigLaya, EstadoServicoLaya, ListaModelosLaya, PedidoBaixarModeloLaya, ProgressoModeloLaya, ResultadoTesteLaya, ApiLaya } from "./laya";
import type {
  ApiAgil,
  CapacidadeSprintAgil,
  DailyAgil,
  DestinoPendentesAgil,
  EdicaoItemAgilPedido,
  EstadoAgilApp,
  EstadoChecklist,
  EventoAgilIpc,
  FormatoExportacaoAgil,
  ItemDetalheAgil,
  ItemReviewAgil,
  MembroAgilPedido,
  NovaSprintAgilPedido,
  NovoItemAgilPedido,
  OrdenacaoBacklogAgil,
  PaginaBacklogAgil,
  PedidoClassificacaoAgil,
  PedidoEstimativaAgil,
  PedidoMarcarRetrabalhoAgil,
  PraticasAgil,
  ResultadoEstimarAgil,
  ResultadoExportarAgil,
  ResultadoFecharSprintAgil,
  ResultadoPrevisaoAgil,
  RetrabalhoListaAgil,
  RetroAgil,
  SprintComResumoAgil,
  SugestaoPlanejamentoAgil,
  TipoExportacaoAgil,
} from "./agil";
import type {
  AlertaVisao,
  ApiAlertas,
  AuditoriaTelegramVisao,
  AutorizadoCompletoVisao,
  AutorizadoVisao,
  BotVisao,
  CanalVisao,
  ConfigAlertas,
  DestinoEntidade,
  EstadoTelegram,
  EventoPareamentoTelegram,
  EventoTelegram,
  FiltroListaAlertas,
  MetaTipoVisao,
  ModeloVisao,
  NaoAutorizadoVisao,
  NivelTemplate as NivelTemplateAlerta,
  Pagina as PaginaAlertas,
  PedidoConfigAutorizado,
  PlanoPendenteDesktop,
  PresetRegraAlerta,
  PrevisaoModelo,
  Regra as RegraAlerta,
  ResultadoTesteToken,
  Severidade as SeveridadeAlerta,
  SilencioGlobalVisao,
  TipoAlerta,
  TipoCanal,
} from "./alertas";
import type { Classificacao, ConfigAgil, EpicoAgil, Estimativa, EventoRetrabalho, FiltrosAgil, FiltrosBacklog, ItemAgil, MembroAgil, PainelAgil, SprintAgil, SprintItemAgil } from "./agil";
import type {
  ApiRelatorios, CanalDivulgacao, ConfigRelatorios, EnvioDivulgacao, EscopoRelatorio, EstadoCanalDivulgacao, EventoRelatoriosIpc, FiltroPacotes, ModoExportacao, OpcoesGerarRelatorio, PacoteDetalhe, PacoteResumo, PreviaPacote,
  ResultadoExportarRel, SprintCandidata, VarianteDivulgacao,
} from "./relatorios";
import type * as Bn from "./bench";
import type {
  ApiMapa, ConfigMapa, ConfiancaIpc, DestinoExportacaoMapa, DirecaoVizinhosIpc, EventoMapaIpc, FiltroGrafoMapa, FluxoMapaIpc, FormatoExportacaoMapa, GrafoMapaIpc, NivelGrafo, NoDetalheMapa, ParametrosAnaliseMapa,
  PedidoDisparoMapa, PerfilProvisorioMapa, RaioMapaIpc, ResultadoAnaliseMapa, ResultadoBuscaMapa, ResultadoDisparoMapa, ResultadoExportacaoMapa, ResumoMapaIpc, TipoAnaliseMapa, TipoNoIpc, VistaExportacaoMapa, VizinhosMapaIpc,
} from "./mapa";
import type { PedidoEncerrarAgente, ResultadoEncerrarAgente, ResumoWorkspaces } from "./workspaces-resumo";
import type { ConfigExecucaoIpc, EntradaHistoricoExecutar, EstadoExecucao, EventoExecutar, ListaExecucao, ResultadoIniciar } from "./executar";
import type { CliAssistente, EventoAssistente, PreviaAssistente } from "./executar-assistente";
import type {
  BoardModelo,
  CardDetalhe,
  ConfigBoard,
  ConfigCusto,
  CustoMissao,
  CustoResumo,
  CustoSprint,
  EstimativaCusto,
  EventoBoard,
  EventoCusto,
  FiltrosBoard,
  FonteDeUsoEstado,
  PedidoDelegarCard,
  PedidoDetalheCard,
  PedidoEstimativaCusto,
  PedidoGravarPreco,
  PedidoRelatorioCusto,
  PedidoResumoCusto,
  Preco,
  PrevisaoMissao,
  PrevisaoPeriodo,
  RespostaDelegarCard,
  RespostaRelatorioCusto,
} from "./custo";
import type {
  DiagnosticoTerminais,
  EventoTerminal,
  FalhaTerminal,
  FerramentaDetectada,
  ItemAnexo,
  LayoutTerminais,
  MetadadosSessao,
  PedidoAbrirSessao,
  ResultadoAnexos,
  ResultadoRecuperacao,
  RespostaAbrirSessao,
} from "./terminais";

export type TemaPreferencia = "claro" | "escuro" | "sistema";
export type TemaEfetivo = "claro" | "escuro";

/** Ações do menu nativo/bandeja que o renderer executa (abrir-projeto, paleta, tema, sobre). */
export type AcaoMenu = "abrir-projeto" | "adicionar-workspace" | "paleta" | "tema" | "sobre";
export const ACOES_MENU: readonly AcaoMenu[] = ["abrir-projeto", "adicionar-workspace", "paleta", "tema", "sobre"];

export interface InfoPerf {
  /** ms desde o início do processo até a janela estar visível (marca do main). */
  janelaVisivelMs: number | null;
  /** marcas nomeadas gravadas pelo main (ex.: "boot:onda1"). */
  marcas: Record<string, number>;
}

/** Pedido/resposta (`ipcRenderer.invoke`). */
export interface CanaisInvoke {
  "app:versao": { entrada: undefined; saida: string };
  "app:tema_ler": { entrada: undefined; saida: { preferencia: TemaPreferencia; efetivo: TemaEfetivo } };
  "app:tema_definir": { entrada: { preferencia: TemaPreferencia }; saida: { preferencia: TemaPreferencia; efetivo: TemaEfetivo } };
  "app:config_ler": { entrada: { chave: string }; saida: unknown };
  "app:config_gravar": { entrada: { chave: string; valor: unknown }; saida: { ok: true } };
  "app:perf": { entrada: undefined; saida: InfoPerf };

  // ---- executar projeto (D-430…; contratos em compartilhado/executar.ts): ▶/■ do cabeçalho. O renderer NUNCA envia cwd, caminho nem URL: só ids, o hash de confirmação e a configuração validada ----
  "executar:listar": { entrada: { workspace_id: string }; saida: ListaExecucao };
  "executar:estado": { entrada: { workspace_id: string }; saida: EstadoExecucao };
  "executar:iniciar": { entrada: { workspace_id: string; config_id?: string; confirmar_hash?: string }; saida: ResultadoIniciar };
  "executar:parar": { entrada: { workspace_id: string; config_id?: string }; saida: { ok: boolean } };
  "executar:reiniciar": { entrada: { workspace_id: string; config_id?: string }; saida: ResultadoIniciar };
  "executar:config_gravar": { entrada: { workspace_id: string; config: ConfigExecucaoIpc; confirmou_shell: boolean }; saida: ListaExecucao };
  "executar:config_remover": { entrada: { workspace_id: string; config_id: string }; saida: ListaExecucao };
  "executar:definir_padrao": { entrada: { workspace_id: string; config_id: string }; saida: ListaExecucao };
  "executar:revogar_confianca": { entrada: { workspace_id: string; config_id?: string }; saida: ListaExecucao };
  "executar:historico": { entrada: { workspace_id: string }; saida: EntradaHistoricoExecutar[] };
  "executar:abrir_url": { entrada: { workspace_id: string }; saida: { ok: boolean } };
  // ---- assistente de execução com IA (D-582…; contratos em compartilhado/executar-assistente.ts). Nenhum caminho vem do renderer: só ids, a CLI (lista fechada), o hash do dossiê consentido e as configurações REVISADAS ----
  "executar:assistente_previa": { entrada: { workspace_id: string; cli?: CliAssistente }; saida: PreviaAssistente };
  "executar:assistente_propor": { entrada: { workspace_id: string; cli: CliAssistente; dossie_hash: string; consentimento: boolean }; saida: { assistente_id: string } };
  "executar:assistente_cancelar": { entrada: { workspace_id: string }; saida: { ok: boolean } };
  "executar:assistente_salvar": { entrada: { workspace_id: string; assistente_id: string; configs: ConfigExecucaoIpc[]; padrao_id: string | null }; saida: ListaExecucao };

  // ---- terminais (Fase 1) ----
  "terminais:listar_ferramentas": { entrada: { forcar: boolean }; saida: FerramentaDetectada[] };
  "terminais:selecionar_executavel": { entrada: { ferramenta_id: string }; saida: FerramentaDetectada | null };
  "terminais:abrir": { entrada: PedidoAbrirSessao; saida: RespostaAbrirSessao };
  "terminais:listar_sessoes": { entrada: undefined; saida: MetadadosSessao[] };
  "terminais:recuperar": { entrada: undefined; saida: ResultadoRecuperacao };
  "terminais:encerrar": { entrada: { sessao_id: string }; saida: boolean };
  "terminais:descartar": { entrada: { sessao_id: string }; saida: boolean };
  "terminais:confirmar_consumo": { entrada: { sessao_id: string; bytes: number }; saida: boolean };
  "terminais:anexar": { entrada: { sessao_id: string; itens: ItemAnexo[] }; saida: ResultadoAnexos };
  "terminais:abrir_link": { entrada: { url: string }; saida: boolean };
  "terminais:layout_ler": { entrada: { workspace_id: string | null }; saida: LayoutTerminais | null };
  "terminais:layout_gravar": { entrada: { workspace_id: string | null; layout: LayoutTerminais }; saida: boolean };
  "terminais:diagnostico": { entrada: undefined; saida: DiagnosticoTerminais };
  "terminais:conversas": { entrada: undefined; saida: Record<string, string> };

  // ---- workspaces (Fase 2) ----
  "workspaces:estado": { entrada: undefined; saida: EstadoWorkspaces };
  /** `caminho` null abre o diálogo nativo de pasta (só o main abre diálogos). */
  "workspaces:abrir": { entrada: { caminho: string | null }; saida: Workspace | null };
  "workspaces:definir_atual": { entrada: { workspace_id: string }; saida: Workspace | null };
  "workspaces:remover": { entrada: { workspace_id: string }; saida: boolean };
  "workspaces:definir_permissao": { entrada: { workspace_id: string; permissao: Permissao }; saida: Workspace | null };
  "workspaces:worktrees": { entrada: { workspace_id: string }; saida: WorktreeInfo[] };
  // ---- painel de workspaces (D-450…): leitura agregada de todos os workspaces + encerrar um agente + revelar pasta ----
  "workspaces:resumo": { entrada: undefined; saida: ResumoWorkspaces };
  "workspaces:resumo_ativar": { entrada: { ativo: boolean }; saida: boolean };
  "workspaces:encerrar_agente": { entrada: PedidoEncerrarAgente; saida: ResultadoEncerrarAgente };
  "workspaces:revelar": { entrada: { workspace_id: string }; saida: boolean };
  "workspaces:copiar_caminho": { entrada: { workspace_id: string }; saida: boolean };
  // ---- modal "Adicionar workspace" (D-600…): o renderer nunca envia caminho, só tokens de pasta emitidos pelo main ----
  "workspaces:adicionar_destino_padrao": { entrada: undefined; saida: DestinoPai };
  "workspaces:adicionar_escolher_pasta": { entrada: { lembrar: boolean }; saida: DestinoPai | null };
  "workspaces:adicionar_avaliar_destino": { entrada: PedidoAvaliarDestino; saida: AvaliacaoDestino };
  "workspaces:adicionar_abrir_destino": { entrada: PedidoAvaliarDestino; saida: Workspace | null };
  "workspaces:adicionar_clonar_iniciar": { entrada: PedidoClonar; saida: ResultadoIniciarClone };
  "workspaces:adicionar_clonar_cancelar": { entrada: { clone_id: string }; saida: boolean };
  "workspaces:adicionar_projetos_buscar": { entrada: undefined; saida: { busca_id: string } };
  "workspaces:adicionar_projetos_cancelar": { entrada: { busca_id: string }; saida: boolean };
  "workspaces:adicionar_projeto_achado": { entrada: { achado_id: string }; saida: Workspace | null };
  "workspaces:adicionar_gh_estado": { entrada: { forcar: boolean }; saida: EstadoGhAdicionar };
  "workspaces:adicionar_repos_listar": { entrada: { consentimento: boolean }; saida: ResultadoRepos };
  "workspaces:adicionar_novo_criar": { entrada: PedidoNovoProjeto; saida: ResultadoNovoProjeto };

  // ---- provedores (Fase 2) ----
  "provedores:listar": { entrada: { forcar: boolean }; saida: ProvedorInfo[] };
  "provedores:contas_criar": { entrada: { provedor: string; rotulo: string }; saida: Conta };
  "provedores:contas_habilitar": { entrada: { conta_id: string; habilitada: boolean }; saida: Conta | null };
  "provedores:diagnostico": { entrada: undefined; saida: DiagnosticoTerminais };

  // ---- missões (Fase 2) ----
  "missoes:listar": { entrada: { workspace_id: string; estado: EstadoMissao | null; depois: string | null }; saida: Pagina<Mission> };
  "missoes:criar": { entrada: PedidoCriarMissao; saida: Mission };
  "missoes:detalhe": { entrada: { mission_id: string }; saida: DetalheMissao | null };
  "missoes:encerrar": { entrada: { mission_id: string }; saida: Mission | null };
  "missoes:abortar": { entrada: { mission_id: string }; saida: Mission | null };
  "missoes:portoes": { entrada: { mission_id: string }; saida: EstadoPortoes | null };
  "missoes:liberar_portao": { entrada: { mission_id: string; portao: PortaoMissao }; saida: EstadoPortoes | null };

  // ---- método Expx (Fase 4) ----
  "metodo:estado": { entrada: { workspace_id: string }; saida: IndiceProjeto | null };
  "metodo:rastro": { entrada: { workspace_id: string; trabalho_id: string; depois: number }; saida: { eventos: EventoRastro[]; proximo: number } };
  "metodo:comando_sugerido": { entrada: { workspace_id: string; trabalho_id: string | null; gesto: GestoMetodo; argumento: string | null }; saida: ComandoSugerido };
  "metodo:disparar": { entrada: PedidoDispararComando; saida: ResultadoDisparo };

  // ---- limites (Fase 9) ----
  "limites:snapshot": { entrada: { conta_ids?: string[] }; saida: RespostaLimites };
  "limites:atualizar": { entrada: { conta_id?: string }; saida: RespostaLimites };
  "limites:manual_definir": { entrada: { conta_id: string; janela: JanelaManual; usado_pct: number; reinicia_em: string | null }; saida: AccountUsage };
  "limites:manual_limpar": { entrada: { conta_id: string; janela?: JanelaManual }; saida: AccountUsage };
  "limites:historico": { entrada: PedidoHistoricoLimites; saida: AmostraLimite[] };
  "limites:previsao": { entrada: { conta_id: string }; saida: PrevisaoZerar[] };
  "limites:eficiencia": { entrada: { conta_id?: string; semanas: number }; saida: EficienciaSemana[] };
  "limites:alertas": { entrada: Record<string, never>; saida: AlertaLimite[] };

  // ---- harness (Fase 9) ----
  "harness:config_ler": { entrada: { workspace_id: string }; saida: ConfigHarness };
  "harness:config_gravar": { entrada: ConfigHarnessEntrada; saida: ConfigHarness };
  "harness:task_types_listar": { entrada: Record<string, never>; saida: TaskType[] };
  "harness:task_types_gravar": { entrada: TaskTypeEntrada; saida: TaskType };
  "harness:task_types_apagar": { entrada: { slug: string }; saida: boolean };
  "harness:politica_listar": { entrada: { workspace_id: string | null }; saida: Politica[] };
  "harness:politica_gravar": { entrada: PoliticaEntrada; saida: Politica };
  "harness:politica_restaurar_semente": { entrada: { workspace_id: string | null; task_type?: string }; saida: Politica[] };
  "harness:equivalencia_ler": { entrada: Record<string, never>; saida: EstadoEquivalencia };
  "harness:equivalencia_gravar": { entrada: { provedores: TabelaEquivalencia }; saida: EstadoEquivalencia };
  "harness:equivalencia_restaurar": { entrada: Record<string, never>; saida: EstadoEquivalencia };
  "harness:recomendar": { entrada: { workspace_id: string; descricao: string }; saida: ResultadoDeRota };
  "harness:decisoes_listar": { entrada: PedidoListarDecisoes; saida: PaginaDecisoes };
  "harness:contas_config_listar": { entrada: Record<string, never>; saida: ContaRoteamento[] };
  "harness:contas_config_gravar": { entrada: ContaRoteamentoEntrada; saida: ContaRoteamento };
  "harness:trocas_listar": { entrada: PedidoListarTrocas; saida: PaginaTrocas };
  "harness:troca_decidir": { entrada: { troca_id: string; acao: AcaoTroca }; saida: Troca };
  "harness:mover_pane": { entrada: { pane_id: string; conta_alvo_id?: string }; saida: ResultadoMoverPane };
  "harness:decisor_ler": { entrada: Record<string, never>; saida: ConfigDecisor };
  "harness:decisor_gravar": { entrada: ConfigDecisorEntrada; saida: ConfigDecisor };
  "harness:decisor_testar": { entrada: { chave?: string }; saida: ResultadoTesteDecisor };
  "harness:classificar_intencao": { entrada: { texto: string; contexto: ContextoIntencao }; saida: ResultadoIntencao };
  "harness:resolver_perfil": { entrada: PedidoResolverPerfil; saida: ResultadoDeRota };

  // ---- OpenRouter (Fase 9; seção da tela Provedores) ----
  "provedores:openrouter_estado": { entrada: Record<string, never>; saida: EstadoOpenRouter };
  "provedores:openrouter_consentir": { entrada: { consentimento: true; versao_texto: string }; saida: EstadoOpenRouter };
  "provedores:openrouter_revogar": { entrada: Record<string, never>; saida: EstadoOpenRouter };
  "provedores:openrouter_chave_gravar": { entrada: { conta_id?: string; rotulo: string; chave: string }; saida: ContaOpenRouterEstado };
  "provedores:openrouter_chave_apagar": { entrada: { conta_id: string }; saida: boolean };
  "provedores:openrouter_testar": { entrada: { conta_id?: string; chave?: string }; saida: ResultadoTesteOpenRouter };
  "provedores:openrouter_modelos_atualizar": { entrada: { conta_id?: string }; saida: ResultadoAtualizarModelos };
  "provedores:openrouter_modelos_listar": { entrada: PedidoListarModelosOpenRouter; saida: PaginaModelosOpenRouter };
  "provedores:openrouter_modelo_gravar": { entrada: PedidoGravarModeloOpenRouter; saida: ModeloOpenRouter };
  "provedores:openrouter_saldo_atualizar": { entrada: { conta_id?: string }; saida: EstadoOpenRouter };

  // ---- cofre (Fase 9): o valor atravessa UMA vez e nunca volta ----
  "cofre:disponivel": { entrada: Record<string, never>; saida: EstadoCofre };
  "cofre:listar": { entrada: Record<string, never>; saida: EntradaCofre[] };
  "cofre:gravar": { entrada: PedidoGravarCofre; saida: EntradaCofre };
  "cofre:apagar": { entrada: { id: string }; saida: boolean };
  "cofre:senha_mestra_definir": { entrada: { senha: string }; saida: EstadoCofre };
  "cofre:desbloquear": { entrada: { senha: string }; saida: EstadoCofre };
  "cofre:bloquear": { entrada: Record<string, never>; saida: EstadoCofre };

  // ---- squads e agentes (Fase 14; as squads são ARQUIVOS, D-201; o renderer nunca envia caminho, cwd nem userData) ----
  "squads:listar": { entrada: PedidoListarSquads; saida: SquadResumo[] };
  "squads:obter": { entrada: { slug: string }; saida: Squad };
  "squads:gravar": { entrada: PedidoGravarSquad; saida: ResultadoGravarSquad };
  "squads:validar": { entrada: { squad: Squad; workspace_id: string | null }; saida: Achado[] };
  "squads:duplicar": { entrada: PedidoDuplicarSquad; saida: Squad };
  "squads:apagar": { entrada: PedidoApagarSquad; saida: { ok: true } };
  "squads:fabrica_atualizacao": { entrada: { slug: string }; saida: FabricaAtualizacao };
  "squads:fabrica_aplicar": { entrada: PedidoFabricaAplicar; saida: Squad };
  "squads:fabrica_diff": { entrada: PedidoFabricaDiff; saida: FabricaDiff };
  "squads:lixeira_listar": { entrada: Record<string, never>; saida: ItemLixeiraSquad[] };
  "squads:lixeira_restaurar": { entrada: PedidoRestaurarLixeira; saida: Squad };
  "squads:execucao_arquivo": { entrada: PedidoArquivoExecucao; saida: ResultadoArquivoExecucao };
  "squads:preflight": { entrada: PedidoPreflight; saida: ResultadoPreflight };
  "squads:enviar_prompt": { entrada: PedidoEnviarPrompt; saida: ResultadoEnviarPrompt };
  "squads:execucoes_listar": { entrada: PedidoListarExecucoes; saida: PaginaExecucoes };
  "squads:exportar": { entrada: PedidoExportarSquad; saida: ResultadoExportarSquad };
  "squads:importar_previa": { entrada: PedidoImportarPrevia; saida: PreviaImportacao };
  "squads:importar_confirmar": { entrada: PedidoImportarConfirmar; saida: Squad };
  "agentes:listar": { entrada: { squad?: string }; saida: AgenteResumo[] };
  "agentes:prompt_ler": { entrada: { agent_id: string }; saida: PromptLido };
  "agentes:prompt_gravar": { entrada: PedidoGravarPrompt; saida: ResultadoGravarPrompt };
  "agentes:prompt_previa": { entrada: PedidoPreviaPrompt; saida: ResultadoPreviaPrompt };
  "agentes:prompt_restaurar": { entrada: { agent_id: string }; saida: { hash: string } };
  "agentes:perfil_opcoes": { entrada: { cli: string }; saida: OpcoesPerfilCli };
  "agentes:abrir_pane": { entrada: PedidoAbrirAgente; saida: { pane_id: string } };
  // ---- painel livre que orquestra (D-420; contratos em compartilhado/painel-livre.ts) ----
  /** lê (sem `ativa`) ou grava (com `ativa`) a preferência do workspace "painéis livres podem abrir agentes" (padrão desligada). */
  "painel_livre:preferencia": { entrada: { workspace_id: string; ativa?: boolean; orquestrador_edita?: boolean; fechar_workers?: boolean }; saida: PreferenciaPainelLivre };
  /** ponte do Grok (D-514): `estado` lê, `aplicar` grava `.grok/config.toml` do projeto (autorização explícita na UI), `remover` apaga só o que tem a marca do app. */
  "painel_livre:ponte_grok": { entrada: PedidoPonteGrok; saida: RespostaPonteGrok };
  /** D-640: política de aprovações dos workers. Sem `nivel/permitir_raiz/confiavel/herdar` lê; com eles grava (`total` exige `confirmacao: "liberar tudo"`). `workspace_id: null` = padrão global. */
  "painel_livre:aprovacao": { entrada: PedidoAprovacaoWorkers; saida: PreferenciaAprovacaoWorkers };
  /** D-640: aprovação efetiva de um Pane de worker (nível, selo, avisos); `null` = Pane sem política (piloto, painel comum, já esquecido). */
  "painel_livre:aprovacao_pane": { entrada: { pane_id: string }; saida: AprovacaoDoPane | null };
  "painel_livre:abrir": { entrada: PedidoAbrirPainelLivre; saida: RespostaPainelLivre };
  "painel_livre:orquestrar": { entrada: PedidoOrquestrarPainel; saida: RespostaOrquestrarPainel };

  // ---- versionamento (Fase 6E; contratos em compartilhado/vcs.ts): um canal por assunto, operação em `op` ----
  "vcs:estado": { entrada: AlvoVcs & { ignorados: boolean }; saida: EstadoVcs };
  /** liga/desliga o observador (contado por referência) da árvore; devolve o resumo e passa a emitir `vcs:mudou`. */
  "vcs:observar": { entrada: AlvoVcs & { ativo: boolean }; saida: ResumoVcs };
  "vcs:diff": { entrada: PedidoDiff; saida: DiffVcs };
  "vcs:estagio": { entrada: PedidoFamilia<FamiliasVcs["vcs:estagio"]>; saida: SaidaDe<FamiliasVcs["vcs:estagio"]> };
  "vcs:commit": { entrada: PedidoFamilia<FamiliasVcs["vcs:commit"]>; saida: SaidaDe<FamiliasVcs["vcs:commit"]> };
  "vcs:ramos": { entrada: PedidoFamilia<FamiliasVcs["vcs:ramos"]>; saida: SaidaDe<FamiliasVcs["vcs:ramos"]> };
  "vcs:stash": { entrada: PedidoFamilia<FamiliasVcs["vcs:stash"]>; saida: SaidaDe<FamiliasVcs["vcs:stash"]> };
  "vcs:historico": { entrada: PedidoFamilia<FamiliasVcs["vcs:historico"]>; saida: SaidaDe<FamiliasVcs["vcs:historico"]> };
  "vcs:remoto": { entrada: PedidoFamilia<FamiliasVcs["vcs:remoto"]>; saida: SaidaDe<FamiliasVcs["vcs:remoto"]> };
  "vcs:operacao": { entrada: PedidoFamilia<FamiliasVcs["vcs:operacao"]>; saida: SaidaDe<FamiliasVcs["vcs:operacao"]> };
  "vcs:conflitos": { entrada: PedidoFamilia<FamiliasVcs["vcs:conflitos"]>; saida: SaidaDe<FamiliasVcs["vcs:conflitos"]> };
  "vcs:svn": { entrada: PedidoFamilia<FamiliasVcs["vcs:svn"]>; saida: SaidaDe<FamiliasVcs["vcs:svn"]> };
  "vcs:forge": { entrada: PedidoFamilia<FamiliasVcs["vcs:forge"]>; saida: SaidaDe<FamiliasVcs["vcs:forge"]> };
  "vcs:missao": { entrada: PedidoMissao; saida: SaidaDe<OperacoesMissao> };
  // ---- Commit e push / Enviar PR (D-630..D-639; contratos em compartilhado/vcs-publicar.ts): o botão só prepara e ENTREGA a instrução ao agente ----
  /** fatos locais e baratos (git? remoto GitHub? gh? branch, alterações, commits à frente); `consultar_pr` = UMA consulta ao `gh` depois do push. */
  "vcs:publicar_estado": { entrada: { workspace_id: string; consultar_pr: boolean }; saida: EstadoPublicacao };
  "vcs:publicar_preparar_commit_push": { entrada: { workspace_id: string; sessao_foco: string | null }; saida: PreparoPublicacao };
  "vcs:publicar_preparar_pr": { entrada: { workspace_id: string; sessao_foco: string | null }; saida: PreparoPublicacao };
  /** monta a instrução, grava na pasta do produto e entrega ao agente (contrato D-620). */
  "vcs:publicar_enviar_instrucao": { entrada: PedidoEnviarInstrucao; saida: ResultadoEnviarInstrucao };
  /** abre no navegador só `https://github.com/...` (o main confere de novo). */
  "vcs:publicar_abrir_url": { entrada: { workspace_id: string; url: string }; saida: boolean };
  /** Atualizar/pull (D-693): fetch silencioso com throttle de 60 s; prévia (commits e arquivos tocados, sem conteúdo); `git pull --ff-only` pelo executor do VCS; instrução de merge ao agente. */
  "vcs:publicar_buscar_remoto": { entrada: { workspace_id: string; forcar: boolean }; saida: ResultadoBuscaRemoto };
  "vcs:publicar_preparar_atualizar": { entrada: { workspace_id: string; sessao_foco: string | null }; saida: PreparoAtualizar };
  "vcs:publicar_atualizar": { entrada: { workspace_id: string }; saida: ResultadoAtualizar };
  "vcs:publicar_pedir_merge": { entrada: PedidoPedirMerge; saida: ResultadoEnviarInstrucao };
  /** acrescenta as pastas da suíte não rastreadas em `.git/info/exclude` (D-692). */
  "vcs:publicar_ignorar_suite": { entrada: { workspace_id: string }; saida: ResultadoIgnorarSuite };

  // ---- Loja de MCPs (Fase 7B; contratos em compartilhado/loja-mcp.ts). O valor de variável secreta atravessa UMA vez e nunca volta ----
  "loja_mcp:listar": { entrada: Record<string, never>; saida: ListaLojaMcp };
  "loja_mcp:detalhe": { entrada: { id: string; workspace_id: string | null }; saida: DetalheMcp | null };
  "loja_mcp:plano_instalacao": { entrada: { ids: string[]; workspace_id: string | null }; saida: ResultadoPlanoLoja };
  "loja_mcp:instalar": { entrada: PedidoInstalarMcp; saida: { instalacao_id: string } };
  "loja_mcp:cancelar": { entrada: { instalacao_id: string }; saida: { ok: boolean } };
  "loja_mcp:desinstalar": { entrada: { id: string; apagar_segredos: boolean }; saida: { ok: boolean; codigo: string | null; residuos: string[] } };
  "loja_mcp:plano_atualizacao": { entrada: { id: string; workspace_id: string | null }; saida: DiffAtualizacaoMcp | null };
  "loja_mcp:atualizar": { entrada: { id: string; consentimento: ConsentimentoLoja; workspace_id: string | null }; saida: { instalacao_id: string } };
  "loja_mcp:variaveis_estado": { entrada: { id: string }; saida: VariavelMcpEstado[] };
  "loja_mcp:variavel_gravar": { entrada: { id: string; nome: string; valor: string }; saida: { ok: boolean; codigo: string | null } };
  "loja_mcp:variavel_apagar": { entrada: { id: string; nome: string }; saida: { ok: boolean } };
  "loja_mcp:testar": { entrada: { id: string; workspace_id: string | null }; saida: ResultadoTesteMcp };
  "loja_mcp:habilitar": { entrada: { id: string; alvo_tipo: AlvoHabilitacaoTipo; alvo_valor: string; habilitado: boolean }; saida: ResultadoAcaoMcp };
  "loja_mcp:habilitacoes": { entrada: { workspace_id: string }; saida: HabilitacaoMcp[] };
  "loja_mcp:previa_cli_usuario": { entrada: { id: string; cli: CliLojaMcp; workspace_id: string | null }; saida: { ok: true; previa: PreviaCliMcp } | { ok: false; codigo: string; motivo: string } };
  "loja_mcp:instalar_na_cli": { entrada: { id: string; cli: CliLojaMcp; confirmacao: string; workspace_id: string | null }; saida: ResultadoCliMcp };
  "loja_mcp:remover_da_cli": { entrada: { id: string; cli: CliLojaMcp }; saida: ResultadoCliMcp };
  "loja_mcp:logs": { entrada: { id: string; limite: number }; saida: LogMcp[] };
  "loja_mcp:kit_estado": { entrada: Record<string, never>; saida: EstadoKitMcp };
  "loja_mcp:kit_plano": { entrada: { workspace_id: string | null }; saida: PlanoKitMcp };
  "loja_mcp:kit_instalar": { entrada: { consentimento: ConsentimentoLoja; workspace_id: string | null }; saida: { instalacao_id: string } };
  "loja_mcp:kit_opt_out": { entrada: { valor: boolean }; saida: EstadoKitMcp };
  "loja_mcp:diagnostico": { entrada: Record<string, never>; saida: DiagnosticoLojaMcp };
  /** T-07B.32 (P2): só por clique; resultado do Registro Oficial, não curado e não instalável. */
  "loja_mcp:descobrir": { entrada: { consulta: string }; saida: ResultadoDescobertaMcp };

  // ---- catálogo (Fase 7; contratos em compartilhado/catalogo.ts; o renderer nunca envia caminho) ----
  "catalogo:varrer": { entrada: PedidoVarrer; saida: { varredura_id: string } };
  "catalogo:listar": { entrada: PedidoListarCatalogo; saida: ResultadoListarCatalogo };
  "catalogo:detalhe": { entrada: { item_id: string }; saida: DetalheCatalogo | null };
  "catalogo:instalar": { entrada: PedidoInstalarCatalogo; saida: ResultadoInstalar };
  "catalogo:desinstalar": { entrada: PedidoDesinstalarCatalogo; saida: { ok: boolean; codigo: string | null } };
  "catalogo:limpar_ausentes": { entrada: { tipo: TipoCatalogo }; saida: { removidos: number } };
  "catalogo:remover_do_catalogo": { entrada: { item_id: string }; saida: { ok: boolean } };
  "catalogo:revelar": { entrada: PedidoRevelarCatalogo; saida: boolean };
  "catalogo:verificar_mcp": { entrada: { item_id: string; confirmado: true }; saida: ResultadoVerificarMcp };
  "catalogo:politica_ler": { entrada: { workspace_id: string }; saida: PoliticaSkills[] };
  "catalogo:politica_gravar": { entrada: PedidoPoliticaGravar; saida: PoliticaSkills };
  "catalogo:politica_previa": { entrada: PedidoPoliticaPrevia; saida: PoliticaResolvida };
  "catalogo:saude": { entrada: { workspace_id: string | null }; saida: AchadoSaude[] };
  "catalogo:embarcadas_estado": { entrada: Record<string, never>; saida: EstadoEmbarcada[] };
  "catalogo:embarcadas_instalar": { entrada: { nome: string | null; cli: CliCatalogoIpc }; saida: { instaladas: string[]; preservadas_editadas: string[] } };
  "catalogo:embarcadas_opt_out": { entrada: { nome: string; cli: CliCatalogoIpc; valor: boolean }; saida: { ok: true } };

  // ---- gateway MCP (Fase 7C) ----
  "gateway:estado": { entrada: Record<string, never>; saida: EstadoGateway };
  "gateway:config_ler": { entrada: { workspace_id: string }; saida: ConfigGateway };
  "gateway:config_gravar": { entrada: PedidoConfigGateway; saida: ConfigGateway };
  "gateway:ferramentas": { entrada: PedidoFerramentasGateway; saida: FerramentaGateway[] };
  "gateway:filtro_definir": { entrada: PedidoFiltroGateway; saida: { ok: boolean } };
  "gateway:auditoria": { entrada: PedidoAuditoriaGateway; saida: EntradaAuditoriaGateway[] };
  "gateway:revogar_pane": { entrada: { pane_id: string }; saida: { ok: boolean } };

  // ---- memória local (Fase 8; contratos em compartilhado/memoria.ts; o conteúdo só atravessa em listar/exportar/preferências, sempre já redigido) ----
  "memoria:estado": { entrada: { workspace_id: string }; saida: EstadoMemoriaApp };
  "memoria:config_gravar": { entrada: PedidoConfigMemoria; saida: ConfigMemoria };
  "memoria:missao_config": { entrada: { mission_id: string; ativa: boolean | null }; saida: { mission_id: string; ativa: boolean | null } };
  "memoria:listar": { entrada: PedidoListarMemoria; saida: PaginaMemoria<EntradaMemoria> };
  "memoria:atualizar": { entrada: PedidoAtualizarMemoria; saida: EntradaMemoria };
  "memoria:esquecer": { entrada: { entrada_id: string }; saida: { ok: boolean } };
  "memoria:esquecer_pane": { entrada: { pane_id: string }; saida: { removidas: number } };
  "memoria:purgar": { entrada: PedidoPurgarMemoria; saida: { removidas: number } };
  "memoria:exportar": { entrada: { workspace_id: string; escopo: EscopoMemoria | "tudo" }; saida: { caminho_salvo: string | null } };
  "memoria:brief_previa": { entrada: { pane_id: string }; saida: PreviaBrief };
  "memoria:restaurar": { entrada: { pane_id: string; modo: "auto" | "retomar" | "brief" }; saida: ResultadoRestaurar };
  "memoria:preferencias_listar": { entrada: Record<string, never>; saida: EntradaMemoria[] };
  "memoria:preferencias_gravar": { entrada: PedidoPreferenciaMemoria; saida: EntradaMemoria };
  "memoria:preferencias_remover": { entrada: { id: string }; saida: { ok: boolean } };
  // ---- gestão ágil (Fase 18; contratos em compartilhado/agil.ts): backlog, estimativa, sprint, cerimônias, retrabalho, painel. Todo pedido leva workspace_id ----
  "agil:estado": { entrada: { workspace_id: string }; saida: EstadoAgilApp };
  "agil:config_ler": { entrada: { workspace_id: string }; saida: ConfigAgil };
  "agil:config_gravar": { entrada: { workspace_id: string; config: Partial<ConfigAgil> }; saida: ConfigAgil };
  "agil:consentimento_ia": { entrada: { workspace_id: string; consentido: boolean }; saida: { consentimento: boolean } };
  "agil:sincronizar": { entrada: { workspace_id: string; forcar?: boolean }; saida: { iniciado: boolean } };
  "agil:membro_listar": { entrada: { workspace_id: string }; saida: MembroAgil[] };
  "agil:membro_gravar": { entrada: { workspace_id: string; membro: MembroAgilPedido }; saida: MembroAgil };
  "agil:backlog_listar": { entrada: { workspace_id: string; filtros?: Partial<FiltrosBacklog>; ordenar?: OrdenacaoBacklogAgil; cursor?: string | null; limite?: number }; saida: PaginaBacklogAgil };
  "agil:item_ler": { entrada: { workspace_id: string; item_id: string }; saida: ItemDetalheAgil };
  "agil:item_criar": { entrada: { workspace_id: string; item: NovoItemAgilPedido }; saida: ItemAgil };
  "agil:item_atualizar": { entrada: { workspace_id: string; item_id: string; campos: EdicaoItemAgilPedido }; saida: ItemAgil };
  "agil:item_descartar": { entrada: { workspace_id: string; item_id: string; motivo: string }; saida: ItemAgil };
  "agil:item_reordenar": { entrada: { workspace_id: string; item_id: string; antes_id: string | null }; saida: { ordem: number } };
  "agil:item_promover": { entrada: { workspace_id: string; item_id: string; destino: "prodx" | "sprintx" | "runx" }; saida: { comando: string } };
  "agil:item_vincular": { entrada: { workspace_id: string; item_id: string; trabalho_id: string | null; task_ref?: string | null }; saida: ItemAgil };
  "agil:epico_listar": { entrada: { workspace_id: string }; saida: EpicoAgil[] };
  "agil:epico_gravar": { entrada: { workspace_id: string; id?: string; titulo: string; descricao?: string | null; estado?: EpicoAgil["estado"] }; saida: EpicoAgil };
  "agil:epico_apagar": { entrada: { workspace_id: string; epico_id: string }; saida: { ok: true } };
  "agil:estimar": { entrada: { workspace_id: string; item_ids: string[] | "sem_estimativa" }; saida: ResultadoEstimarAgil };
  "agil:estimativa_gravar": { entrada: { workspace_id: string } & PedidoEstimativaAgil; saida: { estimativa: Estimativa; ajustado_a_escala: boolean } };
  "agil:classificacao_gravar": { entrada: { workspace_id: string } & PedidoClassificacaoAgil; saida: Classificacao };
  "agil:estimativa_aceitar_lote": { entrada: { workspace_id: string; item_ids: string[]; confianca_min?: number }; saida: { aceitas: number; restantes: number; restantes_ids: string[] } };
  "agil:sprint_listar": { entrada: { workspace_id: string }; saida: SprintComResumoAgil[] };
  "agil:sprint_criar": { entrada: { workspace_id: string; sprint: NovaSprintAgilPedido }; saida: SprintAgil };
  "agil:sprint_atualizar": { entrada: { workspace_id: string; sprint_id: string; campos: Partial<Pick<SprintAgil, "nome" | "meta" | "inicio" | "fim" | "capacidade_pontos">> }; saida: SprintAgil };
  "agil:sprint_iniciar": { entrada: { workspace_id: string; sprint_id: string }; saida: SprintAgil };
  "agil:sprint_cancelar": { entrada: { workspace_id: string; sprint_id: string }; saida: SprintAgil };
  "agil:sprint_item_mover": { entrada: { workspace_id: string; sprint_id: string; item_id: string; acao: "adicionar" | "remover"; motivo?: string | null }; saida: SprintItemAgil };
  "agil:sprint_fechar": { entrada: { workspace_id: string; sprint_id: string; destino_pendentes: DestinoPendentesAgil; versao_lancamento?: string | null }; saida: ResultadoFecharSprintAgil };
  "agil:capacidade_ler": { entrada: { workspace_id: string; sprint_id: string }; saida: CapacidadeSprintAgil };
  "agil:capacidade_gravar": { entrada: { workspace_id: string; sprint_id: string; membro_id: string; ausencias_dias: number }; saida: CapacidadeSprintAgil };
  "agil:planejamento_sugerir": { entrada: { workspace_id: string; sprint_id: string | null; buffer?: number }; saida: SugestaoPlanejamentoAgil };
  "agil:daily_gerar": { entrada: { workspace_id: string; sprint_id?: string | null }; saida: DailyAgil };
  "agil:daily_salvar": { entrada: { workspace_id: string; cerimonia_id: string; observacoes: { ref: string; observacao: string }[] }; saida: { ok: true } };
  "agil:review_ler": { entrada: { workspace_id: string; sprint_id: string }; saida: ItemReviewAgil[] };
  "agil:review_gravar": { entrada: { workspace_id: string; sprint_id: string; item_id: string; resultado: "aceito" | "ajustar" | "rejeitado"; nota?: string | null; devolver?: boolean }; saida: { devolvido_item_id: string | null } };
  "agil:retro_ler": { entrada: { workspace_id: string; sprint_id: string }; saida: RetroAgil };
  "agil:retro_item_gravar": { entrada: { workspace_id: string; cerimonia_id: string; coluna?: string; texto?: string; item_id?: string; voto?: 1 | -1 }; saida: RetroAgil };
  "agil:retro_acao_gravar": { entrada: { workspace_id: string; cerimonia_id: string; texto?: string; dono_membro_id?: string | null; prazo?: string | null; acao_id?: string; estado?: "aberta" | "feita" | "cancelada" }; saida: RetroAgil };
  "agil:retro_acao_para_item": { entrada: { workspace_id: string; acao_id: string }; saida: ItemAgil };
  "agil:retrabalho_listar": { entrada: { workspace_id: string; limite?: number }; saida: RetrabalhoListaAgil };
  "agil:retrabalho_marcar": { entrada: { workspace_id: string } & PedidoMarcarRetrabalhoAgil; saida: EventoRetrabalho };
  "agil:painel": { entrada: { workspace_id: string; filtros?: Partial<FiltrosAgil> }; saida: PainelAgil };
  "agil:previsao": { entrada: { workspace_id: string; filtros?: Partial<FiltrosAgil>; iteracoes?: number }; saida: ResultadoPrevisaoAgil };
  "agil:praticas": { entrada: { workspace_id: string; sprint_id?: string | null }; saida: PraticasAgil };
  "agil:checklist_gravar": { entrada: { workspace_id: string; sprint_id: string; codigo: string; estado: EstadoChecklist["estado"]; nota?: string | null }; saida: { ok: true } };
  "agil:exportar": { entrada: { workspace_id: string; tipo: TipoExportacaoAgil; formato: FormatoExportacaoAgil; sprint_id?: string | null }; saida: ResultadoExportarAgil };
  // ---- documentação e relatórios de entrega (Fase 19; contratos em compartilhado/relatorios.ts). O renderer NUNCA envia caminho; todo pedido leva workspace_id ----
  "relatorios:config_ler": { entrada: { workspace_id: string }; saida: ConfigRelatorios };
  "relatorios:config_gravar": { entrada: { workspace_id: string; config: Partial<Pick<ConfigRelatorios, "gerar_ao_fechar" | "redacao_modo" | "csv_bom" | "hashtags" | "cta">> }; saida: ConfigRelatorios };
  "relatorios:consentimento_llm": { entrada: { workspace_id: string; consentido: boolean }; saida: ConfigRelatorios };
  "relatorios:sprints": { entrada: { workspace_id: string }; saida: SprintCandidata[] };
  "relatorios:listar": { entrada: { workspace_id: string; filtros?: FiltroPacotes }; saida: PacoteResumo[] };
  "relatorios:ler": { entrada: { workspace_id: string; pacote_id: string }; saida: PacoteDetalhe };
  "relatorios:gerar": { entrada: { workspace_id: string; escopo: EscopoRelatorio; opcoes?: OpcoesGerarRelatorio }; saida: { pacote_id: string; reaproveitado: boolean } };
  "relatorios:regenerar": { entrada: { workspace_id: string; pacote_id: string }; saida: { pacote_id: string; reaproveitado: boolean } };
  "relatorios:previa": { entrada: { workspace_id: string; pacote_id: string; nome: string }; saida: PreviaPacote };
  "relatorios:ajuste_gravar": { entrada: { workspace_id: string; sprint_id: string; bloco_id: string; texto_md: string | null }; saida: { ok: true } };
  "relatorios:aprovar": { entrada: { workspace_id: string; pacote_id: string; aprovar: boolean }; saida: PacoteResumo };
  "relatorios:exportar": { entrada: { workspace_id: string; pacote_id: string; nomes: string[] | "todos"; modo: ModoExportacao }; saida: ResultadoExportarRel };
  "relatorios:divulgacao_estado": { entrada: { workspace_id: string }; saida: EstadoCanalDivulgacao[] };
  "relatorios:divulgacao_consentimento": { entrada: { workspace_id: string; canal: CanalDivulgacao; consentido: boolean }; saida: EstadoCanalDivulgacao[] };
  "relatorios:divulgacao_fila": { entrada: { workspace_id: string; pacote_id: string }; saida: EnvioDivulgacao[] };
  "relatorios:divulgacao_enfileirar": { entrada: { workspace_id: string; pacote_id: string; canal: CanalDivulgacao; variante: VarianteDivulgacao }; saida: EnvioDivulgacao };
  "relatorios:divulgacao_aprovar": { entrada: { workspace_id: string; envio_id: string; aprovar: boolean }; saida: EnvioDivulgacao };
  "relatorios:divulgacao_enviar": { entrada: { workspace_id: string; envio_id: string }; saida: EnvioDivulgacao };
  "relatorios:divulgacao_cancelar": { entrada: { workspace_id: string; envio_id: string }; saida: EnvioDivulgacao };

  // ---- mapa lógico do código (Fase 17; contratos em compartilhado/mapa.ts): sob demanda, nada no boot. O renderer NUNCA envia caminho absoluto nem cwd; todo pedido leva workspace_id ----
  "mapa:resumo": { entrada: { workspace_id: string }; saida: ResumoMapaIpc };
  "mapa:analisar": { entrada: { workspace_id: string; modo: "completo" | "incremental"; historia?: boolean }; saida: { execucao_id: number } };
  "mapa:cancelar": { entrada: { workspace_id: string }; saida: { ok: true } };
  "mapa:apagar": { entrada: { workspace_id: string; confirmacao: string }; saida: { ok: true } };
  "mapa:grafo": { entrada: { workspace_id: string; nivel: NivelGrafo; filtro?: FiltroGrafoMapa; limite?: number }; saida: GrafoMapaIpc };
  "mapa:vizinhos": { entrada: { workspace_id: string; no_id: string; direcao?: DirecaoVizinhosIpc; profundidade?: number; limite?: number }; saida: VizinhosMapaIpc };
  "mapa:no": { entrada: { workspace_id: string; no_id: string }; saida: NoDetalheMapa | null };
  "mapa:fluxo": { entrada: { workspace_id: string; entrada_id: string; profundidade?: number; min_confianca?: ConfiancaIpc }; saida: FluxoMapaIpc };
  "mapa:analise": { entrada: { workspace_id: string; tipo: TipoAnaliseMapa; parametros?: ParametrosAnaliseMapa }; saida: ResultadoAnaliseMapa };
  "mapa:raio": { entrada: { workspace_id: string; arquivos: string[]; simbolos?: string[] }; saida: RaioMapaIpc };
  "mapa:perfil": { entrada: { workspace_id: string }; saida: PerfilProvisorioMapa };
  "mapa:buscar": { entrada: { workspace_id: string; texto: string; tipos?: TipoNoIpc[]; limite?: number }; saida: ResultadoBuscaMapa[] };
  "mapa:exportar": { entrada: { workspace_id: string; formato: FormatoExportacaoMapa; vista: VistaExportacaoMapa; destino?: DestinoExportacaoMapa }; saida: ResultadoExportacaoMapa };
  "mapa:disparar": { entrada: { workspace_id: string } & PedidoDisparoMapa; saida: ResultadoDisparoMapa };
  "mapa:config_ler": { entrada: { workspace_id: string }; saida: ConfigMapa };
  "mapa:config_gravar": { entrada: { workspace_id: string; config: Partial<ConfigMapa> }; saida: ConfigMapa };
  "mapa:layout_ler": { entrada: { workspace_id: string; chave: string }; saida: { nivel: string; posicoes: number[] } | null };
  "mapa:layout_gravar": { entrada: { workspace_id: string; chave: string; nivel: string; posicoes: number[] }; saida: { ok: true } };

  // ---- custo e board (Fase 10; contratos em compartilhado/custo.ts): sob demanda, nada no boot. O renderer nunca envia caminho absoluto nem valor de custo ----
  "custo:resumo": { entrada: PedidoResumoCusto; saida: CustoResumo | CustoMissao };
  "custo:relatorio": { entrada: PedidoRelatorioCusto; saida: RespostaRelatorioCusto };
  "custo:estimativa": { entrada: PedidoEstimativaCusto; saida: EstimativaCusto };
  "custo:previsao_missao": { entrada: { mission_id: string }; saida: PrevisaoMissao };
  "custo:previsao_periodo": { entrada: { workspace_id: string; inicio: string; fim: string }; saida: PrevisaoPeriodo };
  "custo:sprint": { entrada: { workspace_id: string; sprint_id: string }; saida: CustoSprint };
  "custo:fontes": { entrada: { workspace_id?: string }; saida: FonteDeUsoEstado[] };
  "custo:precos_listar": { entrada: Record<string, never>; saida: Preco[] };
  "custo:preco_gravar": { entrada: PedidoGravarPreco; saida: Preco };
  "custo:preco_apagar": { entrada: { id: string }; saida: { ok: boolean } };
  "custo:reprecificar": { entrada: { desde?: string; simular?: boolean }; saida: { registros_reprecificados: number } };
  "custo:config_ler": { entrada: Record<string, never>; saida: ConfigCusto };
  "custo:config_gravar": { entrada: ConfigCusto; saida: ConfigCusto };
  "custo:teto_gravar": { entrada: { mission_id: string; teto_usd: number | null }; saida: { ok: true } };
  "custo:reindexar": { entrada: { workspace_id?: string }; saida: { iniciado: boolean; registros: number } };
  "custo:diagnostico": { entrada: Record<string, never>; saida: { texto: string } };
  "board:snapshot": { entrada: { filtros: FiltrosBoard }; saida: BoardModelo };
  "board:card_detalhe": { entrada: PedidoDetalheCard; saida: CardDetalhe };
  "board:abrir_arquivo": { entrada: PedidoDetalheCard; saida: { ok: boolean } };
  "board:delegar_card": { entrada: PedidoDelegarCard; saida: RespostaDelegarCard };
  "board:config_ler": { entrada: { workspace_id: string }; saida: ConfigBoard };
  "board:config_gravar": { entrada: { workspace_id: string; config: ConfigBoard }; saida: ConfigBoard };

  // ---- Maestro (Fase 16; contratos em compartilhado/maestro.ts): intenção -> pipeline do método; rigidez em 5 níveis ----
  "maestro:pedir": { entrada: PedidoPedirMaestro; saida: RespostaPedirMaestro };
  "maestro:confirmar": { entrada: PedidoConfirmarMaestro; saida: PipelineResumo };
  "maestro:cancelar": { entrada: { id: string }; saida: { ok: true } };
  "maestro:pipelines_listar": { entrada: PedidoListarPipelines; saida: PipelineResumo[] };
  "maestro:pipeline_detalhe": { entrada: { id: string }; saida: DetalhePipeline | null };
  "maestro:pipeline_acao": { entrada: PedidoAcaoPipeline; saida: PipelineResumo };
  "maestro:recibos_listar": { entrada: PedidoListarRecibos; saida: ReciboMaestro[] };
  "maestro:config_ler": { entrada: { workspace_id: string }; saida: ConfigMaestroDto };
  "maestro:config_gravar": { entrada: PedidoGravarConfigMaestro; saida: ConfigMaestroDto };
  "pipelines:catalogo": { entrada: Record<string, never>; saida: CatalogoPipelines };
  "pipelines:config_listar": { entrada: PedidoConfigListar; saida: EtapaConfigEfetiva[] };
  "pipelines:config_gravar": { entrada: PedidoConfigGravar; saida: ResultadoConfigGravar };
  "pipelines:config_restaurar": { entrada: PedidoConfigRestaurar; saida: EtapaConfigEfetiva[] };
  "pipelines:validar": { entrada: PedidoValidarConfigs; saida: AchadoPipeline[] };
  "pipelines:perfis_prontos": { entrada: Record<string, never>; saida: PerfilProntoDto[] };
  "pipelines:aplicar_pronto": { entrada: PedidoAplicarPronto; saida: EtapaConfigEfetiva[] };
  "pipelines:exportar": { entrada: PedidoExportarPipelines; saida: ResultadoExportarPipelines };
  "pipelines:importar_previa": { entrada: PedidoImportarPreviaPipelines; saida: PreviaImportacaoPipelines };
  "pipelines:importar_confirmar": { entrada: PedidoImportarConfirmarPipelines; saida: EtapaConfigEfetiva[] };
  "rigidez:ler": { entrada: PedidoLerRigidez; saida: EstadoRigidez };
  "rigidez:definir": { entrada: PedidoDefinirRigidez; saida: ResultadoDefinirRigidez };
  "rigidez:matriz": { entrada: Record<string, never>; saida: MatrizRigidezDto };
  "rigidez:previa_plano": { entrada: PedidoPreviaPlano; saida: PlanoMaestro["etapas"] };
  "rigidez:hooks_estado": { entrada: PedidoHooksEstado; saida: EstadoHooksDto };
  "rigidez:hooks_reverter": { entrada: PedidoHooksEstado; saida: { revertidas: string[] } };
  // Fase 20: alertas, canais e Telegram (validadores em src/main/ipc/alertas.ts; payloads de token/PIN são `sensivel`)
  "alertas:catalogo": { entrada: Record<string, never>; saida: MetaTipoVisao[] };
  "alertas:listar": { entrada: FiltroListaAlertas; saida: PaginaAlertas<AlertaVisao> };
  "alertas:contar": { entrada: Record<string, never>; saida: { nao_lidos: number; criticos: number } };
  "alertas:marcar_lido": { entrada: { ids: string[] } | { todos: true; filtro?: Omit<FiltroListaAlertas, "depois_id" | "limite"> }; saida: { n: number } };
  "alertas:silenciar": { entrada: { alvo: { tipo: TipoAlerta } | { entidade_tipo: string; entidade_id: string }; ate: string | null }; saida: { ok: boolean } };
  "alertas:regras_listar": { entrada: Record<string, never>; saida: RegraAlerta[] };
  "alertas:regra_gravar": { entrada: Omit<RegraAlerta, "id"> & { id?: string }; saida: RegraAlerta };
  "alertas:regra_apagar": { entrada: { id: string }; saida: { ok: boolean } };
  "alertas:regra_preset": { entrada: { preset: PresetRegraAlerta; canal_id: string }; saida: RegraAlerta };
  "alertas:silencio_ler": { entrada: Record<string, never>; saida: SilencioGlobalVisao };
  "alertas:silencio_gravar": { entrada: SilencioGlobalVisao; saida: SilencioGlobalVisao };
  "alertas:modelos_listar": { entrada: Record<string, never>; saida: ModeloVisao[] };
  "alertas:modelo_gravar": { entrada: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplateAlerta; corpo: string }; saida: ModeloVisao | { erros: string[] } };
  "alertas:modelo_restaurar": { entrada: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplateAlerta }; saida: ModeloVisao };
  "alertas:modelo_prever": { entrada: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplateAlerta; corpo: string }; saida: PrevisaoModelo };
  "alertas:config_ler": { entrada: Record<string, never>; saida: ConfigAlertas };
  "alertas:config_gravar": { entrada: { patch: Partial<ConfigAlertas> }; saida: ConfigAlertas };
  "alertas:abrir_entidade": { entrada: { alerta_id: string }; saida: { ok: boolean; destino: DestinoEntidade } };
  "canais:listar": { entrada: Record<string, never>; saida: CanalVisao[] };
  "canais:consentir": { entrada: { canal_id: string; versao_texto: string; hash_texto: string }; saida: CanalVisao };
  "canais:ligar_saida": { entrada: { canal_id: string }; saida: CanalVisao };
  "canais:desligar_saida": { entrada: { canal_id: string }; saida: CanalVisao };
  "canais:teste_envio": { entrada: { canal_id: string }; saida: { ok: boolean; detalhe: string } };
  "telegram:estado": { entrada: Record<string, never>; saida: EstadoTelegram };
  "telegram:token_testar": { entrada: { token: string | null }; saida: ResultadoTesteToken };
  "telegram:token_salvar": { entrada: { token: string }; saida: { ok: boolean; token_mascarado?: string; bot?: BotVisao; erro?: ResultadoTesteToken["erro"]; instrucao?: string } };
  "telegram:token_remover": { entrada: Record<string, never>; saida: { ok: boolean } };
  "telegram:webhook_limpar": { entrada: Record<string, never>; saida: { ok: boolean } };
  "telegram:comandos_configurar": { entrada: Record<string, never>; saida: { ok: boolean } };
  "telegram:parear_iniciar": { entrada: Record<string, never>; saida: { codigo: string; link: string | null; expira_em: string } };
  "telegram:parear_cancelar": { entrada: Record<string, never>; saida: { ok: boolean } };
  "telegram:parear_decidir": { entrada: { pedido_id: string; permitir: boolean }; saida: AutorizadoVisao | null };
  "telegram:autorizado_config": { entrada: PedidoConfigAutorizado; saida: { ok: boolean; autorizado?: AutorizadoCompletoVisao; erro?: string } };
  "telegram:autorizado_revogar": { entrada: { id: string }; saida: { ok: boolean } };
  "telegram:nao_autorizado_listar": { entrada: Record<string, never>; saida: NaoAutorizadoVisao[] };
  "telegram:nao_autorizado_bloquear": { entrada: { user_id: number }; saida: { ok: boolean } };
  "telegram:entrada_ligar": { entrada: { ligada: boolean }; saida: { ok: boolean; erro?: string; estado: EstadoTelegram } };
  "telegram:retomar": { entrada: Record<string, never>; saida: EstadoTelegram };
  "telegram:panico": { entrada: { parar_execucoes: boolean }; saida: { ok: boolean; revogados: number } };
  "telegram:plano_decidir_desktop": { entrada: { plano_id: string; decisao: "aprovar" | "cancelar"; args_hash: string }; saida: { ok: boolean; motivo?: string } };
  "telegram:auditoria_listar": { entrada: { depois: string | null; limite?: number }; saida: PaginaAlertas<AuditoriaTelegramVisao> };
  "telegram:auditoria_exportar": { entrada: Record<string, never>; saida: { ok: boolean; cancelado?: boolean } };
  // ---- conhecimento / RAG local (Fase 15; contratos em compartilhado/conhecimento-api.ts; ação humana, nunca token de agente) ----
  "conhecimento:estado": { entrada: { workspace_id: string }; saida: EstadoConhecimento };
  "conhecimento:config_ler": { entrada: { workspace_id: string }; saida: ConfigConhecimentoDto };
  "conhecimento:config_gravar": { entrada: PedidoGravarConfigConhecimento; saida: ConfigConhecimentoDto };
  "conhecimento:buscar": { entrada: PedidoBuscarConhecimento; saida: RespostaBusca };
  "conhecimento:contexto_previa": { entrada: PedidoContextoPrevia; saida: RespostaContexto };
  "conhecimento:documentos_listar": { entrada: PedidoListarDocumentos; saida: PaginaConhecimento<FonteResultado> };
  "conhecimento:documento_detalhe": { entrada: { workspace_id: string; documento_id: string }; saida: DetalheDocumento | null };
  "conhecimento:reindexar": { entrada: { workspace_id: string; fonte: FonteReindexar }; saida: { enfileirado: boolean } };
  "conhecimento:esquecer": { entrada: { workspace_id: string; alvo: AlvoEsquecer }; saida: { removidos: number } };
  "conhecimento:purgar": { entrada: { workspace_id: string; confirmacao: string }; saida: { removidos: number } };
  "conhecimento:importar_historico": { entrada: { workspace_id: string; cli: "claude" | "codex" | "opencode"; consentimento: true }; saida: { enfileirado: boolean; sessoes: number } };
  "conhecimento:exportar": { entrada: { workspace_id: string }; saida: { caminho_salvo: string | null } };
  "conhecimento:grafo_subgrafo": { entrada: PedidoSubgrafo; saida: RespostaSubgrafo };
  "conhecimento:grafo_no": { entrada: { workspace_id: string; no_id: string }; saida: DetalheNoGrafo | null };
  "conhecimento:grafo_posicoes_gravar": { entrada: { workspace_id: string; posicoes: PosicaoNo[] }; saida: { ok: boolean } };
  "conhecimento:aprendizados_listar": { entrada: PedidoListarAprendizados; saida: PaginaConhecimento<Aprendizado> };
  "conhecimento:aprendizado_atualizar": { entrada: PedidoAtualizarAprendizado; saida: Aprendizado | null };
  "conhecimento:feedback": { entrada: PedidoFeedbackConhecimento; saida: { ok: boolean } };
  "conhecimento:destilar_missao": { entrada: { workspace_id: string; mission_id: string }; saida: { aprendizados: number } };
  "conhecimento:modelos": { entrada: { workspace_id: string }; saida: EstadoModelosEmbedding };
  "conhecimento:modelo_definir": { entrada: { workspace_id: string; modelo: string }; saida: EstadoModelosEmbedding };
  // ---- chat orquestrador (Fase 15; contratos em compartilhado/chat.ts; a resposta chega por eventos) ----
  "chat:conversas_listar": { entrada: { workspace_id: string }; saida: ConversaChatDto[] };
  "chat:conversa_criar": { entrada: PedidoCriarConversa; saida: ConversaChatDto };
  "chat:conversa_ler": { entrada: { conversa_id: string }; saida: ConversaCompleta | null };
  "chat:conversa_apagar": { entrada: { conversa_id: string }; saida: { ok: boolean } };
  "chat:perfil_ler": { entrada: { workspace_id: string }; saida: PerfilChatEstado };
  "chat:perfil_gravar": { entrada: PedidoGravarPerfilChat; saida: PerfilChatEstado };
  "chat:enviar": { entrada: PedidoEnviarChat; saida: { mensagem_id: string } };
  "chat:parar": { entrada: { mensagem_id: string }; saida: { ok: boolean } };
  "chat:plano_decidir": { entrada: PedidoDecidirPlano; saida: PlanoChatDto };
  "chat:plano_parar": { entrada: { plano_id: string }; saida: { ok: boolean } };
  // ---- backend online opcional do RAG (Fase 15; contratos em compartilhado/rag.ts; segredo entra uma vez e nunca volta) ----
  "rag:backend_estado": { entrada: { workspace_id: string }; saida: EstadoBackendRag };
  "rag:backend_provedores": { entrada: Record<string, never>; saida: ProvedorRagDto[] };
  "rag:backend_configurar": { entrada: PedidoConfigurarBackend; saida: { ok: boolean; mascarado: Record<string, string> } };
  "rag:backend_testar": { entrada: PedidoTestarBackend; saida: ResultadoTestarBackend };
  "rag:backend_esquecer_segredo": { entrada: { provedor: ProvedorRag }; saida: { ok: boolean } };
  "rag:migracao_previa": { entrada: { workspace_id: string; tipos: _TipoDocumentoRag[] }; saida: PreviaMigracao };
  "rag:migracao_iniciar": { entrada: { workspace_id: string; previa_id: string; consentimento: { provedor: string; host: string; colecao: string; versao_politica: number } }; saida: { migracao_id: string } };
  "rag:migracao_pausar": { entrada: { migracao_id: string }; saida: { ok: boolean } };
  "rag:migracao_retomar": { entrada: { migracao_id: string }; saida: { ok: boolean } };
  "rag:migracao_cancelar": { entrada: { migracao_id: string }; saida: { ok: boolean } };
  "rag:migracao_verificar": { entrada: { migracao_id: string }; saida: ResultadoVerificacaoMigracao };
  "rag:voltar_para_local": { entrada: { workspace_id: string; baixar_do_remoto: boolean }; saida: { ok: boolean } };
  "rag:sincronizar": { entrada: { workspace_id: string }; saida: { enviados: number; recebidos: number } };
  "rag:remoto_apagar": { entrada: { workspace_id: string; confirmacao: string }; saida: { apagados: number | "desconhecido" } };
  // ---- captura de tela e voz (Fase 11; contratos em compartilhado/captura.ts). O renderer NUNCA envia caminho, cwd nem executável livre: captura é id, o destino é o Pane validado no main ----
  "captura:estado": { entrada: undefined; saida: EstadoCaptura };
  "captura:config_gravar": { entrada: { patch: Partial<ConfigCaptura> }; saida: EstadoCaptura };
  "captura:pedir_tela": { entrada: undefined; saida: { estado: EstadoPermissao; reiniciar_app: boolean } };
  "captura:regiao_iniciar": { entrada: { fonte: FonteCaptura }; saida: ResultadoRegiaoIniciar };
  "captura:regiao_confirmar": { entrada: { token: string; selecao: RetanguloLogico; workspace_id: string | null }; saida: ResultadoAcaoCaptura };
  "captura:regiao_cancelar": { entrada: { token: string }; saida: boolean };
  "captura:janela_inteira": { entrada: { workspace_id: string | null }; saida: ResultadoAcaoCaptura };
  "captura:quadros_iniciar": { entrada: { fonte: FonteCaptura; fps: 1 | 2; workspace_id: string | null }; saida: { ok: true } | { ok: false; codigo: CodigoErroCaptura; instrucao: string } };
  "captura:quadros_parar": { entrada: undefined; saida: { captura_id: string | null } };
  "captura:listar": { entrada: { workspace_id: string | null; depois: string | null }; saida: PaginaCapturas };
  "captura:ler": { entrada: { captura_id: string; workspace_id: string | null }; saida: { bytes: Uint8Array; tipo: FormatoImagem } };
  "captura:salvar_edicao": { entrada: { captura_id: string; workspace_id: string | null; png: Uint8Array }; saida: { ok: true } };
  "captura:anexar_ao_pane": { entrada: { captura_id: string; workspace_id: string | null; sessao_id: string }; saida: ResultadoAnexoCaptura };
  "captura:anexar_quadros": { entrada: { captura_id: string; workspace_id: string | null; sessao_id: string }; saida: ResultadoAnexoCaptura };
  "captura:copiar_caminho": { entrada: { captura_id: string; workspace_id: string | null }; saida: boolean };
  "captura:remover": { entrada: { captura_id: string; workspace_id: string | null }; saida: boolean };
  "voz:estado": { entrada: undefined; saida: EstadoVoz };
  "voz:config_gravar": { entrada: { patch: Partial<ConfigVoz> & { aviso_microfone_visto?: boolean } }; saida: EstadoVoz };
  "voz:segredo_gravar": { entrada: { nome: NomeSegredoVoz; valor: string | null }; saida: { ok: true } };
  "voz:consentir": { entrada: { servico: ServicoConsentimento; host: string; aceitar: boolean }; saida: { ok: true } };
  "voz:testar_motor": { entrada: undefined; saida: { ok: boolean; latencia_ms: number | null; erro: CodigoErroVoz | null } };
  "voz:pedir_microfone": { entrada: undefined; saida: { estado: EstadoPermissao } };
  "voz:abrir_ajustes": { entrada: { painel: "microfone" | "tela" }; saida: boolean };
  "voz:iniciar": { entrada: { sessao_id: string; disparo: DisparoVoz }; saida: { ok: boolean; codigo: CodigoErroVoz | null } };
  "voz:parar": { entrada: undefined; saida: { ok: boolean } };
  "voz:cancelar": { entrada: undefined; saida: { ok: boolean } };
  "voz:dicionario_listar": { entrada: undefined; saida: TermoVoz[] };
  "voz:dicionario_salvar": { entrada: { termo: string; dica: string | null }; saida: TermoVoz[] };
  "voz:dicionario_remover": { entrada: { termo: string }; saida: TermoVoz[] };
  "voz:historico_listar": { entrada: undefined; saida: EntradaHistoricoVoz[] };
  "voz:historico_limpar": { entrada: undefined; saida: { ok: true } };
  // ---- voz local embutida (Fase 11, D-540 a D-549; contratos em compartilhado/voz-local.ts): o renderer só envia `modelo_id` do catálogo; nenhum caminho nem URL ----
  "voz:modelos_listar": { entrada: undefined; saida: ListaModelosVoz };
  "voz:modelo_baixar": { entrada: PedidoBaixarModelo; saida: { modelo_id: string } };
  "voz:modelo_pausar": { entrada: { modelo_id: string }; saida: { ok: boolean } };
  "voz:modelo_retomar": { entrada: { modelo_id: string }; saida: { ok: boolean } };
  "voz:modelo_cancelar": { entrada: { modelo_id: string }; saida: { ok: boolean } };
  "voz:modelo_apagar": { entrada: { modelo_id: string }; saida: { ok: boolean } };
  "voz:modelo_ativar": { entrada: { modelo_id: string }; saida: { ok: boolean; codigo: CodigoErroModelo | null; instrucao: string | null } };
  "voz:modelo_autoteste": { entrada: { modelo_id: string }; saida: ResultadoAutoteste };

  // ---- decisor local laya (Fase 25, D-695..D-708; contratos em compartilhado/laya.ts). O renderer NUNCA envia caminho nem URL: só `modelo_id`
  //      do catálogo versionado, o aceite_versao do consentimento e patches de config. Nenhum canal devolve texto de entrada (só decisão tipada e métricas, D-699) ----
  "laya:estado": { entrada: undefined; saida: EstadoServicoLaya };
  "laya:consentir": { entrada: { host: string; aceitar: boolean }; saida: { ok: true } };
  "laya:modelos_listar": { entrada: undefined; saida: ListaModelosLaya };
  "laya:modelo_baixar": { entrada: PedidoBaixarModeloLaya; saida: { modelo_id: string } };
  "laya:modelo_pausar": { entrada: { modelo_id: string }; saida: { ok: boolean } };
  "laya:modelo_retomar": { entrada: { modelo_id: string }; saida: { ok: boolean } };
  "laya:modelo_cancelar": { entrada: { modelo_id: string }; saida: { ok: boolean } };
  "laya:modelo_apagar": { entrada: { modelo_id: string }; saida: { ok: boolean } };
  "laya:modelo_ativar": { entrada: { modelo_id: string }; saida: { ok: boolean; codigo: CodigoErroLaya | null; instrucao: string | null } };
  "laya:testar": { entrada: undefined; saida: ResultadoTesteLaya };
  "laya:config_gravar": { entrada: { patch: Partial<ConfigLaya> }; saida: EstadoServicoLaya };
  // ---- Bench (Fase 12; contratos em compartilhado/bench.ts). O renderer NUNCA envia caminho, executável nem variável de ambiente: só slugs e ids. Iniciar/re-rodar/julgar exigem token de
  //      consentimento humano de uso único (TTL 120 s) obtido por `bench:consentir`; o payload desses canais é `sensivel` (o token não vai a log). Nenhum canal devolve `mapa_cego`.
  "bench:tarefas_listar": { entrada: { atividade: string | null; estado: Bn.EstadoTarefa | null }; saida: Bn.TarefaBench[] };
  "bench:tarefa_salvar": { entrada: { tarefa: Bn.TarefaEditavel }; saida: Bn.TarefaBench | { erro: Bn.ErroTarefa } };
  "bench:alvos_listar": { entrada: undefined; saida: Bn.AlvoDisponivel[] };
  "bench:alvos_salvar": { entrada: { alvos: Bn.AlvoEditavel[] }; saida: Bn.AlvoBench[] };
  "bench:precos_ler": { entrada: undefined; saida: Bn.PrecoBench[] };
  "bench:precos_gravar": { entrada: { precos: Bn.PrecoBench[] }; saida: Bn.PrecoBench[] };
  "bench:estimar": { entrada: { tarefas: string[]; alvos: string[]; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null }; saida: Bn.Estimativa };
  "bench:consentir": { entrada: { estimativa_id: string; confirmacao: string; finalidade?: "rodar" | "rerodar" | "julgar" }; saida: { token: string; expira_em: string } | { erro: "confirmacao_invalida" | "estimativa_desconhecida" } };
  "bench:descartar_consentimento": { entrada: { estimativa_id: string }; saida: boolean };
  "bench:rodar": { entrada: { estimativa_id: string; token: string }; saida: { run_id: string } | { erro: Bn.ErroRodar } };
  "bench:cancelar": { entrada: { run_id: string }; saida: boolean };
  "bench:rerodar": { entrada: { run_id: string; tarefa: string; alvo: string; token: string }; saida: { resultado_id: string } | { erro: Bn.ErroRodar } };
  "bench:julgar": { entrada: { run_id: string; tarefa: string | null; juiz_alvo: string; token: string }; saida: { veredito_ids: string[] } | { erro: "juiz_igual_a_executor" | "sem_resultados" | "consentimento_invalido" } };
  "bench:nota_manual": { entrada: { resultado_id: string; nota: number; notas: string | null }; saida: boolean };
  "bench:runs_listar": { entrada: { depois: string | null }; saida: Bn.Pagina<Bn.ResumoRun> };
  "bench:estado_run": { entrada: { run_id: string }; saida: Bn.GradeRun };
  "bench:resultado": { entrada: { resultado_id: string }; saida: Bn.DetalheResultado };
  "bench:log_ler": { entrada: { resultado_id: string; depois: number; max: number }; saida: { texto: string; proximo: number } };
  "bench:artefato_ler": { entrada: { resultado_id: string; nome: string }; saida: { bytes: Uint8Array; tipo: string } };
  "bench:comparar": { entrada: { alvos: string[]; tarefas: string[] | null; agrupar: "tarefa" | "atividade" }; saida: Bn.Comparacao | { erro: "nao_comparavel" } };
  "bench:recomendar": { entrada: { atividade: string; restricoes: Bn.Restricoes | null; estrategia: Bn.Estrategia | null }; saida: Bn.Recomendacao };
  "bench:exportar_politica": { entrada: { atividades: string[] | null }; saida: { rascunho: Bn.RascunhoPolitica[]; avisos: string[] } };
  "bench:exportar_relatorio": { entrada: { run_ids: string[] | null; formato: "md" | "json" }; saida: { caminho: string | null } };
  // ---- Jarvis e controle remoto (Fase 13; contratos em compartilhado/jarvis.ts). Texto digitado vira AÇÃO TIPADA da lista fechada; confirmação só por gesto no app (`jarvis:confirmar`).
  //      O renderer nunca define ator, origem nem permissão: o main carimba. Texto de comando e confirmações de permissão são `sensivel` (não vão a log).
  "jarvis:estado": { entrada: undefined; saida: EstadoJarvis };
  "jarvis:config_gravar": { entrada: { patch: Partial<ConfigJarvis> }; saida: EstadoJarvis };
  "jarvis:enviar": { entrada: { texto: string }; saida: ResultadoJarvis };
  "jarvis:acao": { entrada: { acao: AcaoTipada }; saida: ResultadoJarvis };
  "jarvis:confirmar": { entrada: { confirmacao_id: string; aprovado: boolean }; saida: { ok: boolean; resultado: ResultadoJarvis | null; codigo: CodigoRecusaJarvis | null } };
  "jarvis:historico": { entrada: { depois: string | null }; saida: { itens: EntradaAuditoriaJarvis[]; proximo: string | null } };
  "jarvis:limpar": { entrada: undefined; saida: EstadoJarvis };
  "remoto:estado": { entrada: undefined; saida: EstadoRemoto };
  "remoto:ligar": { entrada: { transporte: TransporteRemoto; interface: string; consentimento_versao: string }; saida: EstadoRemoto | { erro: ErroLigarRemoto } };
  "remoto:desligar": { entrada: undefined; saida: EstadoRemoto };
  "remoto:config_gravar": { entrada: { patch: Partial<ConfigRemoto> }; saida: EstadoRemoto };
  "remoto:parear_iniciar": { entrada: { permissao: PermissaoRemota }; saida: { codigo: string; expira_em: string } | { erro: ErroLigarRemoto } };
  "remoto:parear_cancelar": { entrada: undefined; saida: boolean };
  "remoto:parear_confirmar_sas": { entrada: { igual: boolean; confirmacao_permissao: string | null }; saida: DispositivoVisao | null };
  "remoto:revogar": { entrada: { dispositivo_id: string }; saida: boolean };
  "remoto:permissao_definir": { entrada: { dispositivo_id: string; permissao: PermissaoRemota; confirmacao: string | null }; saida: DispositivoVisao | null };
  "remoto:aprovar_pedido": { entrada: { pedido_id: string; aprovado: boolean }; saida: boolean };
  "remoto:panico": { entrada: undefined; saida: EstadoRemoto };
  "remoto:auditoria": { entrada: { depois: string | null }; saida: { itens: EntradaAuditoriaJarvis[]; proximo: string | null } };
  // ---- Relay (Fase 22; contratos em compartilhado/relay.ts). EXPERIMENTAL e desligado por padrão; só `leitura` no pareamento; pareamento e SAS são `sensivel`; decisão humana só no desktop.
  "relay:estado": { entrada: undefined; saida: EstadoRelay };
  "relay:config_obter": { entrada: undefined; saida: ConfigRelay };
  "relay:config_definir": { entrada: Partial<ConfigRelay>; saida: ConfigRelay };
  "relay:ligar": { entrada: undefined; saida: { ok: boolean; motivo?: ErroLigarRelay } };
  "relay:desligar": { entrada: undefined; saida: { ok: boolean } };
  "relay:parear_iniciar": { entrada: { permissao_inicial: "leitura" }; saida: PareamentoRelayAberto | { erro: ErroParearRelay } };
  "relay:parear_sas": { entrada: undefined; saida: SasRelayVisao };
  "relay:parear_decidir": { entrada: { permitir: boolean }; saida: { ok: boolean } };
  "relay:dispositivos": { entrada: undefined; saida: DispositivoRelay[] };
  "relay:revogar": { entrada: { dispositivo_id: string }; saida: { ok: boolean } };
  "relay:panico": { entrada: undefined; saida: { ok: boolean } };
  // ---- Bichinho do workspace (D-460…; contratos em compartilhado/bichinho.ts). Só ids, espécie do catálogo e apelido validado: nunca caminho nem conteúdo. Preferências globais ("Mostrar bichinhos", "Silenciar animações") usam `app:config_*` (chaves `bichinho_mostrar`, `bichinho_silenciar`). ----
  "bichinho:listar": { entrada: { workspace_ids: string[] }; saida: BichinhoVisao[] };
  "bichinho:obter": { entrada: { workspace_id: string }; saida: BichinhoVisao };
  "bichinho:trocar_especie": { entrada: { workspace_id: string; especie: EspecieId | null }; saida: BichinhoVisao };
  "bichinho:renomear": { entrada: { workspace_id: string; apelido: string | null }; saida: BichinhoVisao };
  "bichinho:atencao": { entrada: { workspace_id: string }; saida: BichinhoVisao };
  /** quem usa cada espécie nos workspaces conhecidos (o seletor marca "já em uso em <workspace>"). */
  "bichinho:usos": { entrada: undefined; saida: UsoEspecie[] };
  // ---- Medidor de CPU e memória da máquina (D-530…; contratos em compartilhado/sistema.ts). Só inteiros e nomes-base de executável: nunca argumentos, caminhos nem variáveis. Preferência `medidor_sistema_mostrar` pelo `app:config_*`. ----
  "sistema:amostra_assinar": { entrada: PedidoAssinarSistema; saida: { ativo: boolean } };
  "sistema:detalhe": { entrada: PedidoDetalheSistema; saida: DetalheSistema | null };
  // ---- Painel de progresso da pipeline (D-660…; contratos em compartilhado/progresso.ts). Só ids e booleanos; o estado agregado volta em `progresso:mudou`. Preferência `progresso_painel_mostrar` pelo `app:config_*`. ----
  "progresso:estado": { entrada: undefined; saida: EstadoProgresso };
  "progresso:dispensar": { entrada: { id: string }; saida: { ok: true } };
  "progresso:fixar": { entrada: { id: string; fixado: boolean }; saida: { ok: true } };
  /** Suíte ExpxDev (D-470…): detecção, requisitos, instalação por AÇÃO EXPLÍCITA, cancelamento e "Agora não". Nenhum caminho vem do renderer. */
  "suite:estado": { entrada: { workspace_id: string }; saida: EstadoSuite };
  "suite:requisitos": { entrada: { workspace_id: string }; saida: PlanoSuite };
  "suite:instalar": { entrada: { workspace_id: string; modo: ModoInstalacao }; saida: { instalacao_id: string } };
  "suite:cancelar": { entrada: { workspace_id: string }; saida: { ok: boolean } };
  "suite:dispensar": { entrada: { workspace_id: string; dispensar: boolean }; saida: EstadoSuite };
  /** Módulos da suíte (D-480…): ligar/desligar cada skill POR PROJETO, só no que o app oferece e dispara (o lock e as skills instaladas nunca são tocados). */
  "suite:modulos_estado": { entrada: { workspace_id: string }; saida: EstadoModulosSuite };
  "suite:modulos_definir": { entrada: { workspace_id: string; modulo: string; ligado: boolean; confirmar_cascata: boolean }; saida: ResultadoModulos };
  "suite:modulos_restaurar": { entrada: { workspace_id: string }; saida: EstadoModulosSuite };
  /** Preferência global "módulos padrão para projetos novos" (legadox desligado de fábrica). */
  "suite:modulos_padrao": { entrada: Record<string, never>; saida: PadraoModulos };
  "suite:modulos_padrao_definir": { entrada: { modulos: Record<string, boolean> }; saida: PadraoModulos };
}

/** Sem resposta (`ipcRenderer.send`): teclado, redimensionar… (preenchido pelas fases seguintes). */
export interface CanaisEnvio {
  "app:marca_perf": { entrada: { nome: string } };
  "terminais:escrever": { entrada: { sessao_id: string; dados: string } };
  "terminais:redimensionar": { entrada: { sessao_id: string; colunas: number; linhas: number } };
  "terminais:interromper": { entrada: { sessao_id: string } };
  /** PCM16 LE, 16 kHz, mono, até 64 KiB, `sequencia` monotônica; só vale durante o ditado. */
  "voz:audio": { entrada: { sequencia: number; dados: Uint8Array } };
}

/** Eventos main → renderer. */
export interface CanaisEvento {
  "executar:evento": EventoExecutar;
  "executar:assistente_evento": EventoAssistente;
  "app:tema_mudou": { preferencia: TemaPreferencia; efetivo: TemaEfetivo };
  "app:menu": { acao: AcaoMenu };
  "terminais:evento": EventoTerminal;
  "terminais:falha": FalhaTerminal;
  "workspaces:mudou": EstadoWorkspaces;
  "workspaces:resumo_mudou": ResumoWorkspaces;
  "workspaces:adicionar_progresso": EventoClone;
  "workspaces:adicionar_projetos_lote": LoteProjetos;
  "missoes:mudou": { workspace_id: string; mission_id: string | null };
  "metodo:mudou": ResumoMudancaMetodo;
  "limites:evento": EventoLimites;
  "harness:evento": EventoHarness;
  "squads:evento": EventoSquad;
  "maestro:evento": EventoMaestro;
  "rigidez:evento": EventoRigidez;
  "vcs:mudou": EventoVcs;
  "loja_mcp:evento": EventoLojaMcp;
  "catalogo:evento": EventoCatalogo;
  "gateway:evento": EventoGateway;
  "memoria:entrada_criada": PayloadsEventoMemoria["memoria:entrada_criada"];
  "memoria:brief_montado": PayloadsEventoMemoria["memoria:brief_montado"];
  "memoria:restauracao_pedida": PayloadsEventoMemoria["memoria:restauracao_pedida"];
  "memoria:aviso": PayloadsEventoMemoria["memoria:aviso"];
  "agil:evento": EventoAgilIpc;
  "relatorios:evento": EventoRelatoriosIpc;
  "mapa:evento": EventoMapaIpc;
  "custo:evento": EventoCusto;
  "board:evento": EventoBoard;
  "alertas:novo": { alerta: AlertaVisao };
  "alertas:contagem": { nao_lidos: number; criticos: number };
  "alertas:mudou": { ids: string[] };
  "canais:estado": { canal: CanalVisao };
  "telegram:pareamento": EventoPareamentoTelegram;
  "telegram:evento": EventoTelegram;
  "telegram:plano_pendente_desktop": PlanoPendenteDesktop;
  "conhecimento:progresso": PayloadsEventoConhecimento["conhecimento:progresso"];
  "conhecimento:consultado": PayloadsEventoConhecimento["conhecimento:consultado"];
  "conhecimento:aprendizado_novo": PayloadsEventoConhecimento["conhecimento:aprendizado_novo"];
  "chat:token": PayloadsEventoChat["chat:token"];
  "chat:mensagem": PayloadsEventoChat["chat:mensagem"];
  "chat:plano": PayloadsEventoChat["chat:plano"];
  "chat:progresso": PayloadsEventoChat["chat:progresso"];
  "rag:migracao_progresso": PayloadsEventoRag["rag:migracao_progresso"];
  "rag:aviso": PayloadsEventoRag["rag:aviso"];
  "captura:evento": EventoCapturaIpc;
  "voz:evento": EventoVozIpc;
  /** progresso COALESCIDO (≥ 250 ms) do download/instalação/autoteste de um modelo de voz local. */
  "voz:modelo_progresso": ProgressoModelo;
  /** progresso COALESCIDO (≥ 250 ms) do download/instalação de um modelo do decisor local (P-706). */
  "laya:modelo_progresso": ProgressoModeloLaya;
  /** estado do serviço do decisor (métricas agregadas e contadores; mudança de estado, RAM e latências). */
  "laya:estado_mudou": EstadoServicoLaya;
  "bench:evento": Bn.EventoBenchIpc;
  "jarvis:evento": EventoJarvisIpc;
  "jarvis:abrir_pane": { ref: string };
  "remoto:evento": EventoRemotoIpc;
  "relay:evento": EventoRelayIpc;
  "bichinho:mudou": EventoBichinhoMudou;
  "sistema:amostra": AmostraSistema;
  "progresso:mudou": EventoProgressoMudou;
  "suite:progresso": EventoSuite;
  "suite:modulos_mudou": EventoModulosMudou;
}

export type NomeInvoke = keyof CanaisInvoke;
export type NomeEnvio = keyof CanaisEnvio;
export type NomeEvento = keyof CanaisEvento;

export const CANAIS_INVOKE: readonly NomeInvoke[] = [
  "executar:listar",
  "executar:estado",
  "executar:iniciar",
  "executar:parar",
  "executar:reiniciar",
  "executar:config_gravar",
  "executar:config_remover",
  "executar:definir_padrao",
  "executar:revogar_confianca",
  "executar:historico",
  "executar:abrir_url",
  "executar:assistente_previa",
  "executar:assistente_propor",
  "executar:assistente_cancelar",
  "executar:assistente_salvar",
  "app:versao",
  "app:tema_ler",
  "app:tema_definir",
  "app:config_ler",
  "app:config_gravar",
  "app:perf",
  "terminais:listar_ferramentas",
  "terminais:selecionar_executavel",
  "terminais:abrir",
  "terminais:listar_sessoes",
  "terminais:recuperar",
  "terminais:encerrar",
  "terminais:descartar",
  "terminais:confirmar_consumo",
  "terminais:anexar",
  "terminais:abrir_link",
  "terminais:layout_ler",
  "terminais:layout_gravar",
  "terminais:diagnostico",
  "terminais:conversas",
  "workspaces:estado",
  "workspaces:abrir",
  "workspaces:definir_atual",
  "workspaces:remover",
  "workspaces:definir_permissao",
  "workspaces:worktrees",
  "workspaces:resumo",
  "workspaces:resumo_ativar",
  "workspaces:encerrar_agente",
  "workspaces:revelar",
  "workspaces:copiar_caminho",
  "workspaces:adicionar_destino_padrao",
  "workspaces:adicionar_escolher_pasta",
  "workspaces:adicionar_avaliar_destino",
  "workspaces:adicionar_abrir_destino",
  "workspaces:adicionar_clonar_iniciar",
  "workspaces:adicionar_clonar_cancelar",
  "workspaces:adicionar_projetos_buscar",
  "workspaces:adicionar_projetos_cancelar",
  "workspaces:adicionar_projeto_achado",
  "workspaces:adicionar_gh_estado",
  "workspaces:adicionar_repos_listar",
  "workspaces:adicionar_novo_criar",
  "provedores:listar",
  "provedores:contas_criar",
  "provedores:contas_habilitar",
  "provedores:diagnostico",
  "missoes:listar",
  "missoes:criar",
  "missoes:detalhe",
  "missoes:encerrar",
  "missoes:abortar",
  "missoes:portoes",
  "missoes:liberar_portao",
  "metodo:estado",
  "metodo:rastro",
  "metodo:comando_sugerido",
  "metodo:disparar",
  "limites:snapshot",
  "limites:atualizar",
  "limites:manual_definir",
  "limites:manual_limpar",
  "limites:historico",
  "limites:previsao",
  "limites:eficiencia",
  "limites:alertas",
  "harness:config_ler",
  "harness:config_gravar",
  "harness:task_types_listar",
  "harness:task_types_gravar",
  "harness:task_types_apagar",
  "harness:politica_listar",
  "harness:politica_gravar",
  "harness:politica_restaurar_semente",
  "harness:equivalencia_ler",
  "harness:equivalencia_gravar",
  "harness:equivalencia_restaurar",
  "harness:recomendar",
  "harness:decisoes_listar",
  "harness:contas_config_listar",
  "harness:contas_config_gravar",
  "harness:trocas_listar",
  "harness:troca_decidir",
  "harness:mover_pane",
  "harness:decisor_ler",
  "harness:decisor_gravar",
  "harness:decisor_testar",
  "harness:classificar_intencao",
  "harness:resolver_perfil",
  "provedores:openrouter_estado",
  "provedores:openrouter_consentir",
  "provedores:openrouter_revogar",
  "provedores:openrouter_chave_gravar",
  "provedores:openrouter_chave_apagar",
  "provedores:openrouter_testar",
  "provedores:openrouter_modelos_atualizar",
  "provedores:openrouter_modelos_listar",
  "provedores:openrouter_modelo_gravar",
  "provedores:openrouter_saldo_atualizar",
  "cofre:disponivel",
  "cofre:listar",
  "cofre:gravar",
  "cofre:apagar",
  "cofre:senha_mestra_definir",
  "cofre:desbloquear",
  "cofre:bloquear",
  "squads:listar",
  "squads:obter",
  "squads:gravar",
  "squads:validar",
  "squads:duplicar",
  "squads:apagar",
  "squads:fabrica_atualizacao",
  "squads:fabrica_aplicar",
  "squads:fabrica_diff",
  "squads:lixeira_listar",
  "squads:lixeira_restaurar",
  "squads:execucao_arquivo",
  "squads:preflight",
  "squads:enviar_prompt",
  "squads:execucoes_listar",
  "squads:exportar",
  "squads:importar_previa",
  "squads:importar_confirmar",
  "agentes:listar",
  "agentes:prompt_ler",
  "agentes:prompt_gravar",
  "agentes:prompt_previa",
  "agentes:prompt_restaurar",
  "agentes:perfil_opcoes",
  "agentes:abrir_pane",
  "painel_livre:preferencia",
  "painel_livre:abrir",
  "painel_livre:orquestrar",
  "painel_livre:ponte_grok",
  "painel_livre:aprovacao",
  "painel_livre:aprovacao_pane",
  "vcs:estado",
  "vcs:observar",
  "vcs:diff",
  "vcs:estagio",
  "vcs:commit",
  "vcs:ramos",
  "vcs:stash",
  "vcs:historico",
  "vcs:remoto",
  "vcs:operacao",
  "vcs:conflitos",
  "vcs:svn",
  "vcs:forge",
  "vcs:missao",
  "vcs:publicar_estado",
  "vcs:publicar_preparar_commit_push",
  "vcs:publicar_preparar_pr",
  "vcs:publicar_enviar_instrucao",
  "vcs:publicar_abrir_url",
  "vcs:publicar_buscar_remoto",
  "vcs:publicar_preparar_atualizar",
  "vcs:publicar_atualizar",
  "vcs:publicar_pedir_merge",
  "vcs:publicar_ignorar_suite",
  "loja_mcp:listar",
  "loja_mcp:detalhe",
  "loja_mcp:plano_instalacao",
  "loja_mcp:instalar",
  "loja_mcp:cancelar",
  "loja_mcp:desinstalar",
  "loja_mcp:plano_atualizacao",
  "loja_mcp:atualizar",
  "loja_mcp:variaveis_estado",
  "loja_mcp:variavel_gravar",
  "loja_mcp:variavel_apagar",
  "loja_mcp:testar",
  "loja_mcp:habilitar",
  "loja_mcp:habilitacoes",
  "loja_mcp:previa_cli_usuario",
  "loja_mcp:instalar_na_cli",
  "loja_mcp:remover_da_cli",
  "loja_mcp:logs",
  "loja_mcp:kit_estado",
  "loja_mcp:kit_plano",
  "loja_mcp:kit_instalar",
  "loja_mcp:kit_opt_out",
  "loja_mcp:diagnostico",
  "loja_mcp:descobrir",
  "catalogo:varrer",
  "catalogo:listar",
  "catalogo:detalhe",
  "catalogo:instalar",
  "catalogo:desinstalar",
  "catalogo:limpar_ausentes",
  "catalogo:remover_do_catalogo",
  "catalogo:revelar",
  "catalogo:verificar_mcp",
  "catalogo:politica_ler",
  "catalogo:politica_gravar",
  "catalogo:politica_previa",
  "catalogo:saude",
  "catalogo:embarcadas_estado",
  "catalogo:embarcadas_instalar",
  "catalogo:embarcadas_opt_out",
  "gateway:estado",
  "gateway:config_ler",
  "gateway:config_gravar",
  "gateway:ferramentas",
  "gateway:filtro_definir",
  "gateway:auditoria",
  "gateway:revogar_pane",
  "memoria:estado",
  "memoria:config_gravar",
  "memoria:missao_config",
  "memoria:listar",
  "memoria:atualizar",
  "memoria:esquecer",
  "memoria:esquecer_pane",
  "memoria:purgar",
  "memoria:exportar",
  "memoria:brief_previa",
  "memoria:restaurar",
  "memoria:preferencias_listar",
  "memoria:preferencias_gravar",
  "memoria:preferencias_remover",
  "maestro:pedir",
  "maestro:confirmar",
  "maestro:cancelar",
  "maestro:pipelines_listar",
  "maestro:pipeline_detalhe",
  "maestro:pipeline_acao",
  "maestro:recibos_listar",
  "maestro:config_ler",
  "maestro:config_gravar",
  "pipelines:catalogo",
  "pipelines:config_listar",
  "pipelines:config_gravar",
  "pipelines:config_restaurar",
  "pipelines:validar",
  "pipelines:perfis_prontos",
  "pipelines:aplicar_pronto",
  "pipelines:exportar",
  "pipelines:importar_previa",
  "pipelines:importar_confirmar",
  "rigidez:ler",
  "rigidez:definir",
  "rigidez:matriz",
  "rigidez:previa_plano",
  "rigidez:hooks_estado",
  "rigidez:hooks_reverter",
  "agil:estado",
  "agil:config_ler",
  "agil:config_gravar",
  "agil:consentimento_ia",
  "agil:sincronizar",
  "agil:membro_listar",
  "agil:membro_gravar",
  "agil:backlog_listar",
  "agil:item_ler",
  "agil:item_criar",
  "agil:item_atualizar",
  "agil:item_descartar",
  "agil:item_reordenar",
  "agil:item_promover",
  "agil:item_vincular",
  "agil:epico_listar",
  "agil:epico_gravar",
  "agil:epico_apagar",
  "agil:estimar",
  "agil:estimativa_gravar",
  "agil:classificacao_gravar",
  "agil:estimativa_aceitar_lote",
  "agil:sprint_listar",
  "agil:sprint_criar",
  "agil:sprint_atualizar",
  "agil:sprint_iniciar",
  "agil:sprint_cancelar",
  "agil:sprint_item_mover",
  "agil:sprint_fechar",
  "agil:capacidade_ler",
  "agil:capacidade_gravar",
  "agil:planejamento_sugerir",
  "agil:daily_gerar",
  "agil:daily_salvar",
  "agil:review_ler",
  "agil:review_gravar",
  "agil:retro_ler",
  "agil:retro_item_gravar",
  "agil:retro_acao_gravar",
  "agil:retro_acao_para_item",
  "agil:retrabalho_listar",
  "agil:retrabalho_marcar",
  "agil:painel",
  "agil:previsao",
  "agil:praticas",
  "agil:checklist_gravar",
  "agil:exportar",
  "relatorios:config_ler",
  "relatorios:config_gravar",
  "relatorios:consentimento_llm",
  "relatorios:sprints",
  "relatorios:listar",
  "relatorios:ler",
  "relatorios:gerar",
  "relatorios:regenerar",
  "relatorios:previa",
  "relatorios:ajuste_gravar",
  "relatorios:aprovar",
  "relatorios:exportar",
  "relatorios:divulgacao_estado",
  "relatorios:divulgacao_consentimento",
  "relatorios:divulgacao_fila",
  "relatorios:divulgacao_enfileirar",
  "relatorios:divulgacao_aprovar",
  "relatorios:divulgacao_enviar",
  "relatorios:divulgacao_cancelar",
  "mapa:resumo",
  "mapa:analisar",
  "mapa:cancelar",
  "mapa:apagar",
  "mapa:grafo",
  "mapa:vizinhos",
  "mapa:no",
  "mapa:fluxo",
  "mapa:analise",
  "mapa:raio",
  "mapa:perfil",
  "mapa:buscar",
  "mapa:exportar",
  "mapa:disparar",
  "mapa:config_ler",
  "mapa:config_gravar",
  "mapa:layout_ler",
  "mapa:layout_gravar",
  "custo:resumo",
  "custo:relatorio",
  "custo:estimativa",
  "custo:previsao_missao",
  "custo:previsao_periodo",
  "custo:sprint",
  "custo:fontes",
  "custo:precos_listar",
  "custo:preco_gravar",
  "custo:preco_apagar",
  "custo:reprecificar",
  "custo:config_ler",
  "custo:config_gravar",
  "custo:teto_gravar",
  "custo:reindexar",
  "custo:diagnostico",
  "board:snapshot",
  "board:card_detalhe",
  "board:abrir_arquivo",
  "board:delegar_card",
  "board:config_ler",
  "board:config_gravar",
  "alertas:catalogo",
  "alertas:listar",
  "alertas:contar",
  "alertas:marcar_lido",
  "alertas:silenciar",
  "alertas:regras_listar",
  "alertas:regra_gravar",
  "alertas:regra_apagar",
  "alertas:regra_preset",
  "alertas:silencio_ler",
  "alertas:silencio_gravar",
  "alertas:modelos_listar",
  "alertas:modelo_gravar",
  "alertas:modelo_restaurar",
  "alertas:modelo_prever",
  "alertas:config_ler",
  "alertas:config_gravar",
  "alertas:abrir_entidade",
  "canais:listar",
  "canais:consentir",
  "canais:ligar_saida",
  "canais:desligar_saida",
  "canais:teste_envio",
  "telegram:estado",
  "telegram:token_testar",
  "telegram:token_salvar",
  "telegram:token_remover",
  "telegram:webhook_limpar",
  "telegram:comandos_configurar",
  "telegram:parear_iniciar",
  "telegram:parear_cancelar",
  "telegram:parear_decidir",
  "telegram:autorizado_config",
  "telegram:autorizado_revogar",
  "telegram:nao_autorizado_listar",
  "telegram:nao_autorizado_bloquear",
  "telegram:entrada_ligar",
  "telegram:retomar",
  "telegram:panico",
  "telegram:plano_decidir_desktop",
  "telegram:auditoria_listar",
  "telegram:auditoria_exportar",
  "conhecimento:estado",
  "conhecimento:config_ler",
  "conhecimento:config_gravar",
  "conhecimento:buscar",
  "conhecimento:contexto_previa",
  "conhecimento:documentos_listar",
  "conhecimento:documento_detalhe",
  "conhecimento:reindexar",
  "conhecimento:esquecer",
  "conhecimento:purgar",
  "conhecimento:importar_historico",
  "conhecimento:exportar",
  "conhecimento:grafo_subgrafo",
  "conhecimento:grafo_no",
  "conhecimento:grafo_posicoes_gravar",
  "conhecimento:aprendizados_listar",
  "conhecimento:aprendizado_atualizar",
  "conhecimento:feedback",
  "conhecimento:destilar_missao",
  "conhecimento:modelos",
  "conhecimento:modelo_definir",
  "chat:conversas_listar",
  "chat:conversa_criar",
  "chat:conversa_ler",
  "chat:conversa_apagar",
  "chat:perfil_ler",
  "chat:perfil_gravar",
  "chat:enviar",
  "chat:parar",
  "chat:plano_decidir",
  "chat:plano_parar",
  "rag:backend_estado",
  "rag:backend_provedores",
  "rag:backend_configurar",
  "rag:backend_testar",
  "rag:backend_esquecer_segredo",
  "rag:migracao_previa",
  "rag:migracao_iniciar",
  "rag:migracao_pausar",
  "rag:migracao_retomar",
  "rag:migracao_cancelar",
  "rag:migracao_verificar",
  "rag:voltar_para_local",
  "rag:sincronizar",
  "rag:remoto_apagar",
  "captura:estado",
  "captura:config_gravar",
  "captura:pedir_tela",
  "captura:regiao_iniciar",
  "captura:regiao_confirmar",
  "captura:regiao_cancelar",
  "captura:janela_inteira",
  "captura:quadros_iniciar",
  "captura:quadros_parar",
  "captura:listar",
  "captura:ler",
  "captura:salvar_edicao",
  "captura:anexar_ao_pane",
  "captura:anexar_quadros",
  "captura:copiar_caminho",
  "captura:remover",
  "voz:estado",
  "voz:config_gravar",
  "voz:segredo_gravar",
  "voz:consentir",
  "voz:testar_motor",
  "voz:pedir_microfone",
  "voz:abrir_ajustes",
  "voz:iniciar",
  "voz:parar",
  "voz:cancelar",
  "voz:dicionario_listar",
  "voz:dicionario_salvar",
  "voz:dicionario_remover",
  "voz:historico_listar",
  "voz:historico_limpar",
  "voz:modelos_listar",
  "voz:modelo_baixar",
  "voz:modelo_pausar",
  "voz:modelo_retomar",
  "voz:modelo_cancelar",
  "voz:modelo_apagar",
  "voz:modelo_ativar",
  "voz:modelo_autoteste",
  "laya:estado",
  "laya:consentir",
  "laya:modelos_listar",
  "laya:modelo_baixar",
  "laya:modelo_pausar",
  "laya:modelo_retomar",
  "laya:modelo_cancelar",
  "laya:modelo_apagar",
  "laya:modelo_ativar",
  "laya:testar",
  "laya:config_gravar",
  "bench:tarefas_listar",
  "bench:tarefa_salvar",
  "bench:alvos_listar",
  "bench:alvos_salvar",
  "bench:precos_ler",
  "bench:precos_gravar",
  "bench:estimar",
  "bench:consentir",
  "bench:descartar_consentimento",
  "bench:rodar",
  "bench:cancelar",
  "bench:rerodar",
  "bench:julgar",
  "bench:nota_manual",
  "bench:runs_listar",
  "bench:estado_run",
  "bench:resultado",
  "bench:log_ler",
  "bench:artefato_ler",
  "bench:comparar",
  "bench:recomendar",
  "bench:exportar_politica",
  "bench:exportar_relatorio",
  "jarvis:estado",
  "jarvis:config_gravar",
  "jarvis:enviar",
  "jarvis:acao",
  "jarvis:confirmar",
  "jarvis:historico",
  "jarvis:limpar",
  "remoto:estado",
  "remoto:ligar",
  "remoto:desligar",
  "remoto:config_gravar",
  "remoto:parear_iniciar",
  "remoto:parear_cancelar",
  "remoto:parear_confirmar_sas",
  "remoto:revogar",
  "remoto:permissao_definir",
  "remoto:aprovar_pedido",
  "remoto:panico",
  "remoto:auditoria",
  "relay:estado",
  "relay:config_obter",
  "relay:config_definir",
  "relay:ligar",
  "relay:desligar",
  "relay:parear_iniciar",
  "relay:parear_sas",
  "relay:parear_decidir",
  "relay:dispositivos",
  "relay:revogar",
  "relay:panico",
  "bichinho:listar",
  "bichinho:obter",
  "bichinho:trocar_especie",
  "bichinho:renomear",
  "bichinho:atencao",
  "bichinho:usos",
  "sistema:amostra_assinar",
  "sistema:detalhe",
  "progresso:estado",
  "progresso:dispensar",
  "progresso:fixar",
  "suite:estado",
  "suite:requisitos",
  "suite:instalar",
  "suite:cancelar",
  "suite:dispensar",
  "suite:modulos_estado",
  "suite:modulos_definir",
  "suite:modulos_restaurar",
  "suite:modulos_padrao",
  "suite:modulos_padrao_definir",
];
export const CANAIS_ENVIO: readonly NomeEnvio[] = [
  "app:marca_perf",
  "terminais:escrever",
  "terminais:redimensionar",
  "terminais:interromper",
  "voz:audio",
];
export const CANAIS_EVENTO: readonly NomeEvento[] = [
  "executar:evento",
  "executar:assistente_evento",
  "app:tema_mudou",
  "app:menu",
  "terminais:evento",
  "terminais:falha",
  "workspaces:mudou",
  "workspaces:resumo_mudou",
  "workspaces:adicionar_progresso",
  "workspaces:adicionar_projetos_lote",
  "missoes:mudou",
  "metodo:mudou",
  "limites:evento",
  "harness:evento",
  "squads:evento",
  "maestro:evento",
  "rigidez:evento",
  "vcs:mudou",
  "loja_mcp:evento",
  "catalogo:evento",
  "gateway:evento",
  "memoria:entrada_criada",
  "memoria:brief_montado",
  "memoria:restauracao_pedida",
  "memoria:aviso",
  "agil:evento",
  "relatorios:evento",
  "bench:evento",
  "mapa:evento",
  "custo:evento",
  "board:evento",
  "alertas:novo",
  "alertas:contagem",
  "alertas:mudou",
  "canais:estado",
  "telegram:pareamento",
  "telegram:evento",
  "telegram:plano_pendente_desktop",
  "conhecimento:progresso",
  "conhecimento:consultado",
  "conhecimento:aprendizado_novo",
  "chat:token",
  "chat:mensagem",
  "chat:plano",
  "chat:progresso",
  "rag:migracao_progresso",
  "rag:aviso",
  "captura:evento",
  "voz:evento",
  "voz:modelo_progresso",
  "laya:modelo_progresso",
  "laya:estado_mudou",
  "jarvis:evento",
  "jarvis:abrir_pane",
  "remoto:evento",
  "relay:evento",
  "bichinho:mudou",
  "sistema:amostra",
  "progresso:mudou",
  "suite:progresso",
  "suite:modulos_mudou",
];

/**
 * Canais cujo payload carrega segredo (chave, valor de cofre, senha-mestra). O registro de IPC NUNCA
 * imprime o payload (nem o motivo detalhado da recusa) destes canais — sentinela testada em registro.test.ts.
 */
export const CANAIS_SENSIVEIS: readonly NomeInvoke[] = [
  "executar:config_gravar",
  "executar:assistente_salvar",
  "bench:rodar",
  "bench:rerodar",
  "bench:julgar",
  "jarvis:enviar",
  "jarvis:acao",
  "remoto:parear_confirmar_sas",
  "remoto:permissao_definir",
  "relay:parear_iniciar",
  "relay:parear_sas",
  "provedores:openrouter_chave_gravar",
  "provedores:openrouter_testar",
  "harness:decisor_testar",
  "cofre:gravar",
  "cofre:senha_mestra_definir",
  "cofre:desbloquear",
  "loja_mcp:variavel_gravar",
  "telegram:token_testar",
  "telegram:token_salvar",
  "telegram:autorizado_config",
  "rag:backend_configurar",
  "rag:backend_testar",
  "voz:segredo_gravar",
];

export type Cancelar = () => void;

/** Loja de MCPs no `window.ade`. O valor de uma variável secreta entra uma vez e nunca volta. */
export interface ApiLojaMcp {
  listar(): Promise<ListaLojaMcp>;
  detalhe(id: string, workspaceId?: string | null): Promise<DetalheMcp | null>;
  planoInstalacao(ids: string[], workspaceId?: string | null): Promise<ResultadoPlanoLoja>;
  /** a instalação roda em segundo plano; o andamento chega por `assinar` (progresso/estado). */
  instalar(pedido: PedidoInstalarMcp): Promise<{ instalacao_id: string }>;
  cancelar(instalacaoId: string): Promise<{ ok: boolean }>;
  desinstalar(id: string, apagarSegredos: boolean): Promise<{ ok: boolean; codigo: string | null; residuos: string[] }>;
  planoAtualizacao(id: string, workspaceId?: string | null): Promise<DiffAtualizacaoMcp | null>;
  atualizar(id: string, consentimento: ConsentimentoLoja, workspaceId?: string | null): Promise<{ instalacao_id: string }>;
  variaveisEstado(id: string): Promise<VariavelMcpEstado[]>;
  gravarVariavel(id: string, nome: string, valor: string): Promise<{ ok: boolean; codigo: string | null }>;
  apagarVariavel(id: string, nome: string): Promise<{ ok: boolean }>;
  testar(id: string, workspaceId?: string | null): Promise<ResultadoTesteMcp>;
  habilitar(id: string, alvoTipo: AlvoHabilitacaoTipo, alvoValor: string, habilitado: boolean): Promise<ResultadoAcaoMcp>;
  habilitacoes(workspaceId: string): Promise<HabilitacaoMcp[]>;
  previaCliUsuario(id: string, cli: CliLojaMcp, workspaceId?: string | null): Promise<{ ok: true; previa: PreviaCliMcp } | { ok: false; codigo: string; motivo: string }>;
  /** `confirmacao` precisa ser o nome exato mostrado na prévia (confirmação digitada). */
  instalarNaCli(id: string, cli: CliLojaMcp, confirmacao: string, workspaceId?: string | null): Promise<ResultadoCliMcp>;
  removerDaCli(id: string, cli: CliLojaMcp): Promise<ResultadoCliMcp>;
  logs(id: string, limite?: number): Promise<LogMcp[]>;
  kitEstado(): Promise<EstadoKitMcp>;
  kitPlano(workspaceId?: string | null): Promise<PlanoKitMcp>;
  kitInstalar(consentimento: ConsentimentoLoja, workspaceId?: string | null): Promise<{ instalacao_id: string }>;
  kitOptOut(valor: boolean): Promise<EstadoKitMcp>;
  diagnostico(): Promise<DiagnosticoLojaMcp>;
  /** Registro Oficial do MCP, SÓ por clique (timeout 8 s). Candidatos são dado de terceiro: `curado:false`, `instalavel:false`. */
  descobrir(consulta: string): Promise<ResultadoDescobertaMcp>;
  assinar(cb: (e: EventoLojaMcp) => void): Cancelar;
}

/** API exposta ao renderer como `window.ade` (travada por preload.test.ts). */
/** Custo (Fase 10): sob demanda. Valores de custo são `CustoResumo` (usd null = desconhecido, nunca 0). Canais `custo:*`. */
export interface ApiCusto {
  resumo(pedido: PedidoResumoCusto): Promise<CanaisInvoke["custo:resumo"]["saida"]>;
  relatorio(pedido: PedidoRelatorioCusto): Promise<RespostaRelatorioCusto>;
  estimativa(pedido?: PedidoEstimativaCusto): Promise<EstimativaCusto>;
  previsaoMissao(missionId: string): Promise<PrevisaoMissao>;
  previsaoPeriodo(workspaceId: string, inicio: string, fim: string): Promise<PrevisaoPeriodo>;
  sprint(workspaceId: string, sprintId: string): Promise<CustoSprint>;
  fontes(workspaceId?: string): Promise<FonteDeUsoEstado[]>;
  precosListar(): Promise<Preco[]>;
  precoGravar(pedido: PedidoGravarPreco): Promise<Preco>;
  precoApagar(id: string): Promise<{ ok: boolean }>;
  /** `simular: true` só conta quantos registros mudariam (a UI mostra e pede confirmação). */
  reprecificar(pedido?: { desde?: string; simular?: boolean }): Promise<{ registros_reprecificados: number }>;
  configLer(): Promise<ConfigCusto>;
  configGravar(config: ConfigCusto): Promise<ConfigCusto>;
  tetoGravar(missionId: string, tetoUsd: number | null): Promise<{ ok: true }>;
  reindexar(workspaceId?: string): Promise<{ iniciado: boolean; registros: number }>;
  diagnostico(): Promise<{ texto: string }>;
  assinar(cb: (e: EventoCusto) => void): Cancelar;
}
/** Board de cards (Fase 10): visão do método; nunca grava em `docs/**`. Canais `board:*`. */
export interface ApiBoard {
  snapshot(filtros: FiltrosBoard): Promise<BoardModelo>;
  cardDetalhe(pedido: PedidoDetalheCard): Promise<CardDetalhe>;
  abrirArquivo(pedido: PedidoDetalheCard): Promise<{ ok: boolean }>;
  delegarCard(pedido: PedidoDelegarCard): Promise<RespostaDelegarCard>;
  configLer(workspaceId: string): Promise<ConfigBoard>;
  configGravar(workspaceId: string, config: ConfigBoard): Promise<ConfigBoard>;
  assinar(cb: (e: EventoBoard) => void): Cancelar;
}

/** Executar projeto (D-430…): botão ▶/■ do cabeçalho, configurações, confiança e histórico. Canais `executar:*`. */
export interface ApiExecutar {
  listar(workspaceId: string): Promise<ListaExecucao>;
  estado(workspaceId: string): Promise<EstadoExecucao>;
  iniciar(workspaceId: string, configId?: string, confirmarHash?: string): Promise<ResultadoIniciar>;
  parar(workspaceId: string, configId?: string): Promise<{ ok: boolean }>;
  reiniciar(workspaceId: string, configId?: string): Promise<ResultadoIniciar>;
  gravarConfig(workspaceId: string, config: ConfigExecucaoIpc, confirmouShell: boolean): Promise<ListaExecucao>;
  removerConfig(workspaceId: string, configId: string): Promise<ListaExecucao>;
  definirPadrao(workspaceId: string, configId: string): Promise<ListaExecucao>;
  revogarConfianca(workspaceId: string, configId?: string): Promise<ListaExecucao>;
  historico(workspaceId: string): Promise<EntradaHistoricoExecutar[]>;
  abrirUrl(workspaceId: string): Promise<{ ok: boolean }>;
  assinar(cb: (e: EventoExecutar) => void): () => void;
  /** Assistente de execução com IA (D-582…): prévia do que será enviado, proposta (consentida), cancelar e salvar o que o usuário revisou. */
  assistentePrevia(workspaceId: string, cli?: CliAssistente): Promise<PreviaAssistente>;
  assistentePropor(workspaceId: string, cli: CliAssistente, dossieHash: string, consentimento: boolean): Promise<{ assistente_id: string }>;
  assistenteCancelar(workspaceId: string): Promise<{ ok: boolean }>;
  assistenteSalvar(workspaceId: string, assistenteId: string, configs: ConfigExecucaoIpc[], padraoId: string | null): Promise<ListaExecucao>;
  assistenteAssinar(cb: (e: EventoAssistente) => void): () => void;
}

/** Suíte ExpxDev (D-470…): instala/repara/atualiza o método no workspace atual, só por clique. Canais `suite:*`. */
export interface ApiSuite {
  estado(workspaceId: string): Promise<EstadoSuite>;
  requisitos(workspaceId: string): Promise<PlanoSuite>;
  instalar(workspaceId: string, modo: ModoInstalacao): Promise<{ instalacao_id: string }>;
  cancelar(workspaceId: string): Promise<{ ok: boolean }>;
  dispensar(workspaceId: string, dispensar: boolean): Promise<EstadoSuite>;
  assinar(cb: (e: EventoSuite) => void): () => void;
  /** Módulos da suíte: estado por projeto, ligar/desligar (a cascata só com confirmação), restaurar e o padrão global. */
  modulosEstado(workspaceId: string): Promise<EstadoModulosSuite>;
  modulosDefinir(workspaceId: string, modulo: string, ligado: boolean, confirmarCascata: boolean): Promise<ResultadoModulos>;
  modulosRestaurar(workspaceId: string): Promise<EstadoModulosSuite>;
  modulosPadrao(): Promise<PadraoModulos>;
  modulosPadraoDefinir(modulos: Record<string, boolean>): Promise<PadraoModulos>;
  assinarModulos(cb: (e: EventoModulosMudou) => void): () => void;
}

/** Medidor de CPU e memória (D-530…). */
export interface ApiSistema {
  /** liga/desliga a amostragem no main (zero timers com `false`). */
  assinar(ativo: boolean): Promise<{ ativo: boolean }>;
  /** detalhe do popover; `aberto: false` encerra (nulo). */
  detalhe(aberto: boolean): Promise<DetalheSistema | null>;
  aoAmostra(cb: (a: AmostraSistema) => void): () => void;
}

/** Bichinho do workspace (D-460…). */
export interface ApiBichinho {
  listar(workspaceIds: readonly string[]): Promise<BichinhoVisao[]>;
  obter(workspaceId: string): Promise<BichinhoVisao>;
  trocarEspecie(workspaceId: string, especie: EspecieId | null): Promise<BichinhoVisao>;
  renomear(workspaceId: string, apelido: string | null): Promise<BichinhoVisao>;
  atencao(workspaceId: string): Promise<BichinhoVisao>;
  usos(): Promise<UsoEspecie[]>;
  assinar(cb: (e: EventoBichinhoMudou) => void): () => void;
}

export interface ApiAde {
  /** Suíte ExpxDev (D-470…). Canais `suite:*`. */
  suite: ApiSuite;
  /** Executar projeto (D-430…). Canais `executar:*`. */
  executar: ApiExecutar;
  versao(): Promise<string>;
  tema: {
    ler(): Promise<CanaisInvoke["app:tema_ler"]["saida"]>;
    definir(preferencia: TemaPreferencia): Promise<CanaisInvoke["app:tema_definir"]["saida"]>;
    assinar(cb: (e: CanaisEvento["app:tema_mudou"]) => void): Cancelar;
  };
  menu: {
    assinar(cb: (e: CanaisEvento["app:menu"]) => void): Cancelar;
  };
  config: {
    ler(chave: string): Promise<unknown>;
    gravar(chave: string, valor: unknown): Promise<{ ok: true }>;
  };
  perf: {
    ler(): Promise<InfoPerf>;
    marcar(nome: string): void;
  };
  terminais: {
    listarFerramentas(forcar?: boolean): Promise<FerramentaDetectada[]>;
    selecionarExecutavel(ferramentaId: string): Promise<FerramentaDetectada | null>;
    abrir(pedido: PedidoAbrirSessao): Promise<RespostaAbrirSessao>;
    listarSessoes(): Promise<MetadadosSessao[]>;
    /** sessões que sobreviveram ao app (daemon): a saída acumulada chega por `assinarEventos`. */
    recuperar(): Promise<ResultadoRecuperacao>;
    encerrar(sessaoId: string): Promise<boolean>;
    /** fecha de vez: encerra o processo se vive e apaga sessão e histórico do disco. */
    descartar(sessaoId: string): Promise<boolean>;
    /** teclado e redimensionar não esperam resposta; falhas voltam por `assinarFalhas`. */
    escrever(sessaoId: string, dados: string): void;
    redimensionar(sessaoId: string, colunas: number, linhas: number): void;
    /** pausa: o main escolhe a tecla (ESC ou Ctrl+C) pela ferramenta; não encerra o processo. */
    interromper(sessaoId: string): void;
    confirmarConsumo(sessaoId: string, bytes: number): Promise<boolean>;
    anexar(sessaoId: string, itens: ItemAnexo[]): Promise<ResultadoAnexos>;
    /** o Electron 37 não expõe File.path; o caminho real vem do preload (webUtils). */
    caminhoDoArquivo(arquivo: File): string;
    /** Cmd/Ctrl+clique num link: o main revalida (http/https) e abre no navegador. */
    abrirLink(url: string): Promise<boolean>;
    lerLayout(workspaceId: string | null): Promise<LayoutTerminais | null>;
    gravarLayout(workspaceId: string | null, layout: LayoutTerminais): Promise<boolean>;
    diagnostico(): Promise<DiagnosticoTerminais>;
    conversas(): Promise<Record<string, string>>;
    assinarEventos(cb: (e: EventoTerminal) => void): Cancelar;
    assinarFalhas(cb: (f: FalhaTerminal) => void): Cancelar;
  };
  workspaces: {
    estado(): Promise<EstadoWorkspaces>;
    abrir(caminho: string | null): Promise<Workspace | null>;
    definirAtual(workspaceId: string): Promise<Workspace | null>;
    remover(workspaceId: string): Promise<boolean>;
    definirPermissao(workspaceId: string, permissao: Permissao): Promise<Workspace | null>;
    worktrees(workspaceId: string): Promise<WorktreeInfo[]>;
    assinar(cb: (e: EstadoWorkspaces) => void): Cancelar;
    /** Painel de workspaces (D-450…): visão agregada somente leitura; o painel só pede quando está fixado. */
    resumo(): Promise<ResumoWorkspaces>;
    ativarResumo(ativo: boolean): Promise<boolean>;
    encerrarAgente(workspaceId: string, sessaoId: string): Promise<ResultadoEncerrarAgente>;
    revelar(workspaceId: string): Promise<boolean>;
    /** Copia o caminho COMPLETO para a área de transferência (o main resolve pelo id; o renderer só recebe o caminho mascarado). */
    copiarCaminho(workspaceId: string): Promise<boolean>;
    assinarResumo(cb: (e: ResumoWorkspaces) => void): Cancelar;
    /** Modal "Adicionar workspace" (D-600…). O renderer nunca envia caminho: só tokens de pasta (`DestinoPai`) que o main emitiu e ids de achados. */
    adicionarDestinoPadrao(): Promise<DestinoPai>;
    adicionarEscolherPasta(lembrar: boolean): Promise<DestinoPai | null>;
    adicionarAvaliarDestino(p: PedidoAvaliarDestino): Promise<AvaliacaoDestino>;
    adicionarAbrirDestino(p: PedidoAvaliarDestino): Promise<Workspace | null>;
    adicionarClonar(p: PedidoClonar): Promise<ResultadoIniciarClone>;
    adicionarCancelarClone(cloneId: string): Promise<boolean>;
    adicionarBuscarProjetos(): Promise<{ busca_id: string }>;
    adicionarCancelarBusca(buscaId: string): Promise<boolean>;
    adicionarProjetoAchado(achadoId: string): Promise<Workspace | null>;
    adicionarGhEstado(forcar?: boolean): Promise<EstadoGhAdicionar>;
    adicionarListarRepos(consentimento: boolean): Promise<ResultadoRepos>;
    adicionarNovo(p: PedidoNovoProjeto): Promise<ResultadoNovoProjeto>;
    assinarAdicionarProgresso(cb: (e: EventoClone) => void): Cancelar;
    assinarAdicionarProjetos(cb: (e: LoteProjetos) => void): Cancelar;
  };
  provedores: {
    listar(forcar?: boolean): Promise<ProvedorInfo[]>;
    criarConta(provedor: string, rotulo: string): Promise<Conta>;
    habilitarConta(contaId: string, habilitada: boolean): Promise<Conta | null>;
    diagnostico(): Promise<DiagnosticoTerminais>;
  };
  missoes: {
    listar(workspaceId: string, estado?: EstadoMissao | null, depois?: string | null): Promise<Pagina<Mission>>;
    criar(pedido: PedidoCriarMissao): Promise<Mission>;
    detalhe(missionId: string): Promise<DetalheMissao | null>;
    encerrar(missionId: string): Promise<Mission | null>;
    abortar(missionId: string): Promise<Mission | null>;
    portoes(missionId: string): Promise<EstadoPortoes | null>;
    liberarPortao(missionId: string, portao: PortaoMissao): Promise<EstadoPortoes | null>;
    assinar(cb: (e: { workspace_id: string; mission_id: string | null }) => void): Cancelar;
  };
  metodo: {
    estado(workspaceId: string): Promise<IndiceProjeto | null>;
    rastro(workspaceId: string, trabalhoId: string, depois?: number): Promise<{ eventos: EventoRastro[]; proximo: number }>;
    comandoSugerido(workspaceId: string, trabalhoId: string | null, gesto: GestoMetodo, argumento?: string | null): Promise<ComandoSugerido>;
    disparar(pedido: PedidoDispararComando): Promise<ResultadoDisparo>;
    assinar(cb: (e: ResumoMudancaMetodo) => void): Cancelar;
  };
  limites: {
    snapshot(contaIds?: string[]): Promise<RespostaLimites>;
    atualizar(contaId?: string): Promise<RespostaLimites>;
    definirManual(contaId: string, janela: JanelaManual, usadoPct: number, reiniciaEm: string | null): Promise<AccountUsage>;
    limparManual(contaId: string, janela?: JanelaManual): Promise<AccountUsage>;
    historico(pedido: PedidoHistoricoLimites): Promise<AmostraLimite[]>;
    previsao(contaId: string): Promise<PrevisaoZerar[]>;
    eficiencia(semanas: number, contaId?: string): Promise<EficienciaSemana[]>;
    alertas(): Promise<AlertaLimite[]>;
    assinar(cb: (e: EventoLimites) => void): Cancelar;
  };
  harness: {
    lerConfig(workspaceId: string): Promise<ConfigHarness>;
    gravarConfig(config: ConfigHarnessEntrada): Promise<ConfigHarness>;
    listarTaskTypes(): Promise<TaskType[]>;
    gravarTaskType(tipo: TaskTypeEntrada): Promise<TaskType>;
    apagarTaskType(slug: string): Promise<boolean>;
    listarPoliticas(workspaceId: string | null): Promise<Politica[]>;
    gravarPolitica(politica: PoliticaEntrada): Promise<Politica>;
    restaurarSemente(workspaceId: string | null, taskType?: string): Promise<Politica[]>;
    lerEquivalencia(): Promise<EstadoEquivalencia>;
    gravarEquivalencia(provedores: TabelaEquivalencia): Promise<EstadoEquivalencia>;
    restaurarEquivalencia(): Promise<EstadoEquivalencia>;
    recomendar(workspaceId: string, descricao: string): Promise<ResultadoDeRota>;
    listarDecisoes(pedido?: PedidoListarDecisoes): Promise<PaginaDecisoes>;
    listarContasConfig(): Promise<ContaRoteamento[]>;
    gravarContaConfig(config: ContaRoteamentoEntrada): Promise<ContaRoteamento>;
    listarTrocas(pedido?: PedidoListarTrocas): Promise<PaginaTrocas>;
    decidirTroca(trocaId: string, acao: AcaoTroca): Promise<Troca>;
    moverPane(paneId: string, contaAlvoId?: string): Promise<ResultadoMoverPane>;
    lerDecisor(): Promise<ConfigDecisor>;
    gravarDecisor(config: ConfigDecisorEntrada): Promise<ConfigDecisor>;
    /** com `chave` o valor é usado uma vez e NÃO é gravado. */
    testarDecisor(chave?: string): Promise<ResultadoTesteDecisor>;
    classificarIntencao(texto: string, contexto: ContextoIntencao): Promise<ResultadoIntencao>;
    resolverPerfil(pedido: PedidoResolverPerfil): Promise<ResultadoDeRota>;
    assinar(cb: (e: EventoHarness) => void): Cancelar;
  };
  /** OpenRouter (seção da tela Provedores): canais `provedores:openrouter_*`. */
  openrouter: {
    estado(): Promise<EstadoOpenRouter>;
    consentir(versaoTexto: string): Promise<EstadoOpenRouter>;
    revogar(): Promise<EstadoOpenRouter>;
    /** a chave entra uma vez, vai direto ao cofre e nunca volta (só `ultimos4`). */
    gravarChave(rotulo: string, chave: string, contaId?: string): Promise<ContaOpenRouterEstado>;
    apagarChave(contaId: string): Promise<boolean>;
    /** `chave` = testar SEM salvar (usa uma vez; cofre e banco intactos). */
    testar(pedido: { conta_id?: string; chave?: string }): Promise<ResultadoTesteOpenRouter>;
    atualizarModelos(contaId?: string): Promise<ResultadoAtualizarModelos>;
    listarModelos(pedido?: PedidoListarModelosOpenRouter): Promise<PaginaModelosOpenRouter>;
    gravarModelo(pedido: PedidoGravarModeloOpenRouter): Promise<ModeloOpenRouter>;
    atualizarSaldo(contaId?: string): Promise<EstadoOpenRouter>;
  };
  cofre: {
    disponivel(): Promise<EstadoCofre>;
    listar(): Promise<EntradaCofre[]>;
    /** o valor atravessa uma vez; a resposta traz só metadados. */
    gravar(pedido: PedidoGravarCofre): Promise<EntradaCofre>;
    apagar(id: string): Promise<boolean>;
    definirSenhaMestra(senha: string): Promise<EstadoCofre>;
    desbloquear(senha: string): Promise<EstadoCofre>;
    bloquear(): Promise<EstadoCofre>;
  };
  /** Squads (Fase 14): CRUD de arquivos, fábrica, execução por prompt direto e portabilidade. Canais `squads:*`. */
  squads: {
    listar(pedido?: PedidoListarSquads): Promise<SquadResumo[]>;
    obter(slug: string): Promise<Squad>;
    gravar(pedido: PedidoGravarSquad): Promise<ResultadoGravarSquad>;
    validar(squad: Squad, workspaceId?: string | null): Promise<Achado[]>;
    duplicar(pedido: PedidoDuplicarSquad): Promise<Squad>;
    /** `confirmarSlug` precisa ser igual ao slug (confirmação digitada na UI). */
    apagar(slug: string, confirmarSlug: string): Promise<{ ok: true }>;
    fabricaAtualizacao(slug: string): Promise<FabricaAtualizacao>;
    /** `sobrescreverEditados`: membros `editado` aceitos após o diff lado a lado (sem isto, edição nunca é tocada). */
    fabricaAplicar(slug: string, membros: string[], sobrescreverEditados?: string[]): Promise<Squad>;
    fabricaDiff(pedido: PedidoFabricaDiff): Promise<FabricaDiff>;
    listarLixeira(): Promise<ItemLixeiraSquad[]>;
    restaurarDaLixeira(nome: string): Promise<Squad>;
    /** `plano.md`/`resultado.md` da execução (texto puro, lido do disco pelo main). */
    lerArquivoDaExecucao(pedido: PedidoArquivoExecucao): Promise<ResultadoArquivoExecucao>;
    preflight(slug: string, workspaceId: string): Promise<ResultadoPreflight>;
    enviarPrompt(pedido: PedidoEnviarPrompt): Promise<ResultadoEnviarPrompt>;
    listarExecucoes(pedido: PedidoListarExecucoes): Promise<PaginaExecucoes>;
    exportar(pedido: PedidoExportarSquad): Promise<ResultadoExportarSquad>;
    importarPrevia(pedido: PedidoImportarPrevia): Promise<PreviaImportacao>;
    importarConfirmar(previaId: string, slug?: string): Promise<Squad>;
    assinar(cb: (e: EventoSquad) => void): Cancelar;
  };
  /** Agentes = membros de squad (`agent_id = <squad>.<membro>`): prompt editável, perfil e modo livre. Canais `agentes:*`. */
  agentes: {
    listar(squad?: string): Promise<AgenteResumo[]>;
    lerPrompt(agentId: string): Promise<PromptLido>;
    gravarPrompt(pedido: PedidoGravarPrompt): Promise<ResultadoGravarPrompt>;
    previaPrompt(pedido: PedidoPreviaPrompt): Promise<ResultadoPreviaPrompt>;
    restaurarPrompt(agentId: string): Promise<{ hash: string }>;
    opcoesDePerfil(cli: string): Promise<OpcoesPerfilCli>;
    abrirPane(pedido: PedidoAbrirAgente): Promise<{ pane_id: string }>;
  };
  /** Painel livre que orquestra (D-420): interruptor "Orquestrar neste painel", preferência do workspace e abertura como Pane. Canais `painel_livre:*`. */
  painelLivre: {
    preferencia(workspaceId: string, ativa?: boolean, orquestradorEdita?: boolean, fecharWorkers?: boolean): Promise<PreferenciaPainelLivre>;
    ponteGrok(workspaceId: string, acao: AcaoPonteGrok): Promise<RespostaPonteGrok>;
    aprovacao(pedido: PedidoAprovacaoWorkers): Promise<PreferenciaAprovacaoWorkers>;
    aprovacaoDoPane(paneId: string): Promise<AprovacaoDoPane | null>;
    abrir(pedido: PedidoAbrirPainelLivre): Promise<RespostaPainelLivre>;
    orquestrar(pedido: PedidoOrquestrarPainel): Promise<RespostaOrquestrarPainel>;
  };
  /** Versionamento (Fase 6E): git, SVN e forge atrás de canais `vcs:*` (ver `compartilhado/vcs.ts`). */
  vcs: ApiVcs;
  /** Commit e push / Enviar PR (D-630..D-639): prepara e entrega a instrução ao agente; nunca executa git de escrita. */
  vcsPublicar: ApiVcsPublicar;
  /** Loja de MCPs (Fase 7B): catálogo curado, instalação isolada por consentimento, variáveis no cofre, habilitação por workspace. Canais `loja_mcp:*`. */
  lojaMcp: ApiLojaMcp;
  /** Catálogo (Fase 7): skills, agentes, comandos, hooks, regras e MCPs das CLIs; instalação por symlink; política por papel/agente/Missão. Canais `catalogo:*`. Sob demanda. */
  catalogo: ApiCatalogo;
  /** Gateway MCP (Fase 7C): endpoint único em loopback, filtro por Pane/papel/ferramenta, rate limit e auditoria. Canais `gateway:*`. */
  gateway: ApiGateway;
  /** Memória local (Fase 8): estado, configuração, listar/esquecer/purgar/exportar, prévia do brief, restaurar e preferências. Canais `memoria:*`. */
  memoria: ApiMemoria;
  /** Gestão ágil (Fase 18): backlog, estimativa (heurística + IA com consentimento), sprint, cerimônias, retrabalho e painel. Canais `agil:*`. */
  agil: ApiAgil;
  /** Documentação e relatórios de entrega (Fase 19): pacote técnico + do usuário (HTML/MD/CSV), divulgação com consentimento. Canais `relatorios:*`. */
  relatorios: ApiRelatorios;
  /** Mapa lógico do código (Fase 17): grafo, análises, raio de impacto, exportação e disparo do stackx/legadox. Canais `mapa:*`. Sob demanda: nada no boot. */
  mapa: ApiMapa;
  custo: ApiCusto;
  board: ApiBoard;
  /** Alertas, canais e Telegram (Fase 20). Canais `alertas:*`, `canais:*`, `telegram:*`. */
  alertas: ApiAlertas;
  /** Maestro (Fase 16): intenção -> plano -> um terminal por etapa. Canais `maestro:*`. */
  maestro: {
    pedir(pedido: PedidoPedirMaestro): Promise<RespostaPedirMaestro>;
    confirmar(pedido: PedidoConfirmarMaestro): Promise<PipelineResumo>;
    cancelar(id: string): Promise<{ ok: true }>;
    listarPipelines(pedido: PedidoListarPipelines): Promise<PipelineResumo[]>;
    detalhe(id: string): Promise<DetalhePipeline | null>;
    /** não existe ação de assinar/aprovar raio/merge: essas continuam humanas. */
    acao(pedido: PedidoAcaoPipeline): Promise<PipelineResumo>;
    listarRecibos(pedido: PedidoListarRecibos): Promise<ReciboMaestro[]>;
    lerConfig(workspaceId: string): Promise<ConfigMaestroDto>;
    gravarConfig(pedido: PedidoGravarConfigMaestro): Promise<ConfigMaestroDto>;
    assinar(cb: (e: EventoMaestro) => void): Cancelar;
  };
  /** Configuração por skill/etapa (matriz skill x etapa x perfil). Canais `pipelines:*`. */
  pipelines: {
    catalogo(): Promise<CatalogoPipelines>;
    listarConfig(workspaceId: string | null): Promise<EtapaConfigEfetiva[]>;
    gravarConfig(pedido: PedidoConfigGravar): Promise<ResultadoConfigGravar>;
    restaurarConfig(pedido: PedidoConfigRestaurar): Promise<EtapaConfigEfetiva[]>;
    validar(pedido: PedidoValidarConfigs): Promise<AchadoPipeline[]>;
    perfisProntos(): Promise<PerfilProntoDto[]>;
    aplicarPronto(pedido: PedidoAplicarPronto): Promise<EtapaConfigEfetiva[]>;
    exportar(pedido: PedidoExportarPipelines): Promise<ResultadoExportarPipelines>;
    importarPrevia(pedido: PedidoImportarPreviaPipelines): Promise<PreviaImportacaoPipelines>;
    importarConfirmar(pedido: PedidoImportarConfirmarPipelines): Promise<EtapaConfigEfetiva[]>;
  };
  /** Rigidez em 5 níveis (seletor do cabeçalho). Canais `rigidez:*`. */
  rigidez: {
    ler(pedido: PedidoLerRigidez): Promise<EstadoRigidez>;
    definir(pedido: PedidoDefinirRigidez): Promise<ResultadoDefinirRigidez>;
    matriz(): Promise<MatrizRigidezDto>;
    previaPlano(pedido: PedidoPreviaPlano): Promise<PlanoMaestro["etapas"]>;
    hooksEstado(pedido: PedidoHooksEstado): Promise<EstadoHooksDto>;
    hooksReverter(pedido: PedidoHooksEstado): Promise<{ revertidas: string[] }>;
    assinar(cb: (e: EventoRigidez) => void): Cancelar;
  };
  /** Conhecimento / RAG local (Fase 15): busca, fontes, grafo, aprendizados e backend de modelo. Canais `conhecimento:*`. */
  conhecimento: ApiConhecimento;
  /** Chat orquestrador (Fase 15): perguntar ao RAG e pedir ao orquestrador. Canais `chat:*`. */
  chat: ApiChat;
  /** Backend online opcional do RAG (Fase 15): provedores, consentimento, migração retomável. Canais `rag:*`. */
  rag: ApiRag;
  /** Captura de tela/janela/região e gravação por quadros (Fase 11): local, sob demanda, com permissão explícita. Canais `captura:*`. */
  captura: ApiCaptura;
  /** Ditado por voz no terminal (Fase 11): motor local por padrão, remoto só com consentimento e chave no cofre. Canais `voz:*`. */
  voz: ApiVoz;
  /** Decisor local laya (Fase 25, D-695..D-708): download consentido de pesos, serviço tipado choice/score/noul com fallback determinístico. Canais `laya:*`. */
  laya: ApiLaya;
  /** Bench (Fase 12): tarefas, alvos, estimativa, consentimento de uso único, execução isolada, julgamento cego, comparação e sugestão de política. Canais `bench:*`. */
  bench: Bn.ApiBench;
  /** Jarvis (Fase 13): assistente de comando por texto → ações tipadas; confirmação no app. Canais `jarvis:*`. */
  jarvis: ApiJarvis;
  /** Controle remoto local (Fase 13): servidor autenticado por dispositivo, opt-in explícito, desligado por padrão. Canais `remoto:*`. */
  remoto: ApiRemoto;
  /** Relay cego (Fase 22): acesso remoto estendido, EXPERIMENTAL, desligado por padrão, E2E. Canais `relay:*`. */
  relay: ApiRelay;
  /** Bichinho do workspace (D-460…): espécie, humor e maturidade por workspace. Canais `bichinho:*`. */
  bichinho: ApiBichinho;
  /** Medidor de CPU e memória da máquina (D-530…): amostra coalescida e detalhe do popover. Canais `sistema:*`. */
  sistema: ApiSistema;
  /** Painel de progresso da pipeline (D-660…): estado agregado por workspace, dispensar e fixar. Canais `progresso:*`. */
  progresso: ApiProgresso;
}

/** Nome enumerado das chaves da API — o teste do preload compara com isto. */
export const CHAVES_API_ADE = ["executar", "versao", "tema", "menu", "config", "perf", "terminais", "workspaces", "provedores", "missoes", "metodo", "limites", "harness", "openrouter", "cofre", "squads", "agentes", "painelLivre", "vcs", "vcsPublicar", "memoria", "lojaMcp", "catalogo", "gateway", "agil", "relatorios", "mapa", "custo", "board", "maestro", "pipelines", "rigidez", "conhecimento", "chat", "rag", "alertas", "captura", "voz", "bench", "jarvis", "remoto", "relay", "bichinho", "sistema", "progresso", "suite"] as const;

declare global {
  interface Window {
    ade?: ApiAde;
  }
}
