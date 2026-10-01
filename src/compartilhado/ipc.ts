// Contrato de IPC entre main e renderer (05-CONTRATOS.md §2). Compartilhado pelos dois lados.
// Regra: canal só existe se estiver em `CanaisInvoke`/`CanaisEnvio`/`CanaisEvento` E tiver validador
// registrado no main (teste de contrato falha sem). O preload expõe uma API ENUMERADA — nunca
// `ipcRenderer` cru.

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
  OpcoesPerfilCli,
  PaginaExecucoes,
  PedidoAbrirAgente,
  PedidoApagarSquad,
  PedidoDuplicarSquad,
  PedidoEnviarPrompt,
  PedidoExportarSquad,
  PedidoFabricaAplicar,
  PedidoGravarPrompt,
  PedidoGravarSquad,
  PedidoImportarConfirmar,
  PedidoImportarPrevia,
  PedidoListarExecucoes,
  PedidoListarSquads,
  PedidoPreflight,
  PedidoPreviaPrompt,
  PreviaImportacao,
  PromptLido,
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
export type AcaoMenu = "abrir-projeto" | "paleta" | "tema" | "sobre";
export const ACOES_MENU: readonly AcaoMenu[] = ["abrir-projeto", "paleta", "tema", "sobre"];

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
}

/** Sem resposta (`ipcRenderer.send`): teclado, redimensionar… (preenchido pelas fases seguintes). */
export interface CanaisEnvio {
  "app:marca_perf": { entrada: { nome: string } };
  "terminais:escrever": { entrada: { sessao_id: string; dados: string } };
  "terminais:redimensionar": { entrada: { sessao_id: string; colunas: number; linhas: number } };
  "terminais:interromper": { entrada: { sessao_id: string } };
}

/** Eventos main → renderer. */
export interface CanaisEvento {
  "app:tema_mudou": { preferencia: TemaPreferencia; efetivo: TemaEfetivo };
  "app:menu": { acao: AcaoMenu };
  "terminais:evento": EventoTerminal;
  "terminais:falha": FalhaTerminal;
  "workspaces:mudou": EstadoWorkspaces;
  "missoes:mudou": { workspace_id: string; mission_id: string | null };
  "metodo:mudou": ResumoMudancaMetodo;
  "limites:evento": EventoLimites;
  "harness:evento": EventoHarness;
  "squads:evento": EventoSquad;
}

export type NomeInvoke = keyof CanaisInvoke;
export type NomeEnvio = keyof CanaisEnvio;
export type NomeEvento = keyof CanaisEvento;

export const CANAIS_INVOKE: readonly NomeInvoke[] = [
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
];
export const CANAIS_ENVIO: readonly NomeEnvio[] = [
  "app:marca_perf",
  "terminais:escrever",
  "terminais:redimensionar",
  "terminais:interromper",
];
export const CANAIS_EVENTO: readonly NomeEvento[] = [
  "app:tema_mudou",
  "app:menu",
  "terminais:evento",
  "terminais:falha",
  "workspaces:mudou",
  "missoes:mudou",
  "metodo:mudou",
  "limites:evento",
  "harness:evento",
  "squads:evento",
];

/**
 * Canais cujo payload carrega segredo (chave, valor de cofre, senha-mestra). O registro de IPC NUNCA
 * imprime o payload (nem o motivo detalhado da recusa) destes canais — sentinela testada em registro.test.ts.
 */
export const CANAIS_SENSIVEIS: readonly NomeInvoke[] = [
  "provedores:openrouter_chave_gravar",
  "provedores:openrouter_testar",
  "harness:decisor_testar",
  "cofre:gravar",
  "cofre:senha_mestra_definir",
  "cofre:desbloquear",
];

export type Cancelar = () => void;

/** API exposta ao renderer como `window.ade` (travada por preload.test.ts). */
export interface ApiAde {
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
    fabricaAplicar(slug: string, membros: string[]): Promise<Squad>;
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
}

/** Nome enumerado das chaves da API — o teste do preload compara com isto. */
export const CHAVES_API_ADE = ["versao", "tema", "menu", "config", "perf", "terminais", "workspaces", "provedores", "missoes", "metodo", "limites", "harness", "openrouter", "cofre", "squads", "agentes"] as const;

declare global {
  interface Window {
    ade?: ApiAde;
  }
}
