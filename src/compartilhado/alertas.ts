// Tipos da Fase 20 (alertas e comunicação). Arquivo NOVO e puro (sem imports de runtime): vale para main, núcleo e renderer.
// Nada aqui carrega segredo: o token do bot vive só no cofre (nome `TELEGRAM_BOT_TOKEN_<canal_id>`).

export const TIPOS_ALERTA = [
  "tarefa_iniciada",
  "tarefa_concluida",
  "tarefa_bloqueada",
  "tarefa_atrasada",
  "tarefa_tempo",
  "tarefa_tokens",
  "tarefa_story_points",
  "pane_aguardando",
  "pane_terminou",
  "qa_aprovado",
  "qa_reprovado",
  "pr_aberto",
  "pr_mesclado",
  "checks_falhando",
  "cota_atingida",
  "limite_consumo",
  "conta_trocada",
  "sprint_iniciada",
  "sprint_fechada",
  "sprint_em_risco",
  "relatorio_pronto",
  "missao_concluida",
  "missao_falhou",
  "missao_aguardando_aprovacao",
  "erro_sistema",
  "resumo_diario",
  "resumo_sprint",
  "agente_mensagem",
  "pedido_remoto",
  "plano_aguardando_aprovacao",
  "canal_erro",
] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

export const SEVERIDADES = ["info", "sucesso", "aviso", "critico"] as const;
export type Severidade = (typeof SEVERIDADES)[number];

export type FonteAlerta = "metodo" | "pane" | "missao" | "vcs" | "consumo" | "agil" | "relatorio" | "sistema" | "agente" | "remoto";
export type NivelTemplate = "minimo" | "padrao" | "completo";
export type TipoCanal = "so" | "toast" | "telegram" | "webhook";
export type EstadoCanal = "desligado" | "configurando" | "ativo" | "erro" | "conflito" | "pausado";

export type ValorDado = string | number | boolean | null | undefined;
/** Dados tipados e JÁ redigidos que acompanham o alerta. `null` = "sem fonte"/"sem estimativa" (nunca zero). */
export interface DadosAlerta {
  task_id?: string | null;
  missao?: string | null;
  cli?: string | null;
  modelo?: string | null;
  status?: string | null;
  tempo_trabalho_ms?: number | null;
  decorrido_ms?: number | null;
  tokens?: number | null;
  tokens_entrada?: number | null;
  tokens_saida?: number | null;
  usd_conhecido?: number | null;
  story_points?: number | null;
  estimativa_ms?: number | null;
  limite_ms?: number | null;
  atraso_ms?: number | null;
  espera_ms?: number | null;
  pergunta?: string | null;
  motivo?: string | null;
  pr_numero?: number | null;
  link?: string | null;
  terceiro?: boolean;
  [chave: string]: ValorDado;
}

export interface AlertaVisao {
  id: string;
  tipo: TipoAlerta;
  severidade: Severidade;
  fonte: FonteAlerta;
  workspace_id: string | null;
  mission_id: string | null;
  entidade_tipo: string | null;
  entidade_id: string | null;
  titulo: string;
  dados: DadosAlerta;
  dedupe_chave: string;
  contagem: number;
  criado_em: string;
  atualizado_em: string;
  lido_em: string | null;
  silenciado_ate: string | null;
  arquivado_em: string | null;
}

export interface EntradaAlerta {
  tipo: TipoAlerta;
  severidade?: Severidade;
  workspace_id?: string | null;
  mission_id?: string | null;
  entidade_tipo?: string | null;
  entidade_id?: string | null;
  titulo: string;
  dados?: DadosAlerta;
  /** estado que entra na chave de dedupe (ex.: `em_andamento`). */
  estado?: string;
}

export interface SilencioDef {
  /** "HH:MM" local. Sem `inicio`/`fim` = sem janela. A janela pode cruzar a meia-noite. */
  inicio?: string;
  fim?: string;
  /** 0 = domingo … 6 = sábado (dia em que a janela COMEÇA). Vazio/ausente = todos. */
  dias?: number[];
  excecao_critico?: boolean;
}

export type ModoAgrupamento = "imediato" | "lote" | "digest";
export interface AgrupamentoDef {
  modo: ModoAgrupamento;
  janela_s?: number;
  max?: number;
  /** "HH:MM" local do envio do digest. */
  hora_digest?: string;
}

export interface FiltrosRegra {
  workspace_ids?: string[];
  mission_ids?: string[];
  severidade_min?: Severidade;
  sp_min?: number;
  so_atrasadas?: boolean;
}

export interface Regra {
  id: string;
  nome: string;
  ativa: boolean;
  tipos: Array<TipoAlerta | "*">;
  canal_id: string;
  filtros: FiltrosRegra;
  silencio: SilencioDef;
  agrupamento: AgrupamentoDef;
  nivel: NivelTemplate;
  efemera_ate: string | null;
  origem: "usuario" | "padrao" | "pedido_remoto";
  /** só `pedido_remoto`: destino fixo (chat) da regra efêmera. */
  chat_ref?: string | null;
}

export interface ConsentimentoCanal {
  versao_texto: string;
  hash_texto: string;
  aceito_em: string;
  host: string;
  itens_enviados: string[];
}

export interface CanalRegistro {
  id: string;
  tipo: TipoCanal;
  nome: string;
  estado: EstadoCanal;
  saida_ligada: boolean;
  entrada_ligada: boolean;
  consentimento: ConsentimentoCanal | null;
  silenciado_ate: string | null;
  erro_codigo: string | null;
}

export type EstadoEntrega = "pendente" | "agrupado" | "enviado" | "falhou" | "descartado";
export interface EntregaRegistro {
  id: string;
  alerta_id: string;
  canal_id: string;
  regra_id: string | null;
  estado: EstadoEntrega;
  tentativas: number;
  proxima_tentativa_em: string | null;
  erro_codigo: string | null;
  lote_id: string | null;
  mensagem_externa_id: string | null;
  enviado_em: string | null;
  criado_em: string;
  nivel: NivelTemplate;
  chat_ref: string | null;
}

export interface ConfigAlertas {
  ligado: boolean;
  retencao_dias: number;
  atraso: { fator: number; folga_min: number; tabela_pontos_min: Record<string, number>; minimo_amostras: number };
  pane_aguardando_min: number;
  digest: { diario: { ligado: boolean; hora: string }; sprint: { ligado: boolean } };
  /** só IDs nos canais EXTERNOS: remove títulos, perguntas e textos de terceiros das mensagens (P-75, AB-28). Padrão `false`. */
  ocultar_titulos_externos?: boolean;
}

export const CONFIG_ALERTAS_PADRAO: ConfigAlertas = {
  ligado: true,
  retencao_dias: 90,
  atraso: { fator: 1.5, folga_min: 10, tabela_pontos_min: { "1": 15, "2": 30, "3": 60, "5": 120, "8": 240, "13": 480, "21": 960 }, minimo_amostras: 5 },
  pane_aguardando_min: 10,
  digest: { diario: { ligado: false, hora: "18:00" }, sprint: { ligado: true } },
};

// ---- Telegram (visão sem segredo) ----
export type ModoWorkspaceTelegram = "consulta" | "aprovar" | "direto";
export type EstadoPoller = "parado" | "ativo" | "erro" | "conflito" | "token_possivelmente_comprometido" | "pausado";
export type RaioPlano = "BAIXO" | "MEDIO" | "ALTO" | "desconhecido";

export interface AutorizadoVisao {
  id: string;
  canal_id: string;
  nome_exibicao: string;
  modo_padrao: ModoWorkspaceTelegram;
  texto_livre: boolean;
  com_pin: boolean;
  criado_em: string;
  ultimo_uso_em: string;
  expira_em: string;
  revogado_em: string | null;
}

/** Lista fechada de ações que um plano remoto pode conter (Fase 15). `encerrar_pane`/`abortar_missao` NÃO existem neste canal. */
export const ACOES_REMOTAS = ["criar_missao", "abrir_pane", "disparar_metodo", "enviar_ao_piloto"] as const;
export type AcaoRemota = (typeof ACOES_REMOTAS)[number];

export interface PlanoRemoto {
  plano_id: string;
  intencao: string;
  confianca: number;
  squad: { id: string; nome: string } | null;
  pipeline: { skill: string; etapas: Array<{ id: string; rotulo: string; perfil_resumo: string }> };
  workspace: string;
  /** id do workspace (a política, as consultas e a auditoria usam ESTE; `workspace` é o nome exibido). Ausente = `workspace` já é o id. */
  workspace_id?: string;
  branch_de_trabalho: string;
  branch_protegida: boolean;
  paineis_estimados: number;
  estimativa: { pontos: number | null; tempo_trabalho_ms: number | null };
  raio: RaioPlano;
  rigidez: 1 | 2 | 3 | 4 | 5;
  acoes: string[];
  destrutivo: boolean;
  /** `true` quando o plano exige gesto humano proibido por este canal (mergex-revisar, merge, assinatura do prodx, raio ALTO). */
  acao_humana?: boolean;
  workspace_automatico?: boolean;
  args_hash: string;
}

export interface Pagina<T> {
  itens: T[];
  proximo: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Fase 20, onda 2: contratos de IPC (`alertas:*`, `canais:*`, `telegram:*`) e a API `window.ade.alertas`. Nenhum segredo atravessa para o
// renderer: o token entra uma vez (`token_testar`/`token_salvar`) e volta só mascarado; o PIN entra uma vez e vira hash `scrypt` no main.
// ---------------------------------------------------------------------------------------------------------------------------------------

export interface MetaTipoVisao {
  tipo: TipoAlerta;
  rotulo: string;
  severidade: Severidade;
  fonte: FonteAlerta;
  agrupavel: boolean;
  /** `false` = nunca vai a canal externo por regra curinga (só por regra explícita pelo tipo). */
  externo_por_padrao: boolean;
  /** a fase dona ainda não expõe o evento: aparece cinza e nunca inventa dado. */
  fonte_indisponivel: boolean;
}

export interface CapacidadesCanalVisao {
  entrada: boolean;
  botoes: boolean;
  formato: "texto" | "html";
  precisa_consentimento: boolean;
}
export interface CanalVisao {
  id: string;
  tipo: TipoCanal;
  nome: string;
  estado: EstadoCanal;
  /** uma linha legível (ex.: `@meu_bot`, `Notificação do sistema`). */
  resumo: string;
  saida_ligada: boolean;
  entrada_ligada: boolean;
  consentimento: { versao_texto: string; aceito_em: string; host: string } | null;
  silenciado_ate: string | null;
  erro_codigo: string | null;
  capacidades: CapacidadesCanalVisao;
}

export interface ModeloVisao {
  tipo: TipoAlerta;
  canal_tipo: TipoCanal;
  nivel: NivelTemplate;
  corpo: string;
  editado: boolean;
  atualizado_em: string | null;
}
export interface PrevisaoModelo {
  texto: string;
  tamanho_visivel: number;
  erros: string[];
}

/** silêncio global: janela de horário + "silenciar tudo por X". */
export interface SilencioGlobalVisao {
  janela: SilencioDef;
  /** `null` = sem silêncio temporário. */
  temporario_ate: string | null;
  temporario_incluir_criticos: boolean;
}

export interface FiltroListaAlertas {
  estado?: "nao_lidos" | "todos" | "silenciados";
  tipos?: TipoAlerta[];
  severidade_min?: Severidade;
  workspace_id?: string;
  mission_id?: string;
  busca?: string;
  depois_id: string | null;
  limite?: number;
}

export type DestinoEntidade =
  | { tipo: "task" | "missao" | "pane" | "pr" | "componente" | "canal"; workspace_id: string | null; entidade_id: string | null }
  | null;

export interface BotVisao {
  id: number;
  username: string;
  nome: string;
}
export interface PareamentoVisao {
  estado: "inativo" | "aguardando" | "pedido" | "pareado" | "expirado" | "cancelado";
  expira_em: string | null;
  pedido: { pedido_id: string; nome: string; user_id: number } | null;
}
export interface WorkspaceTelegramVisao {
  workspace_id: string;
  modo: ModoWorkspaceTelegram;
  padrao: boolean;
}
export interface AutorizadoCompletoVisao extends AutorizadoVisao {
  workspaces: WorkspaceTelegramVisao[];
}
export interface TextoConsentimentoVisao {
  versao_texto: string;
  hash_texto: string;
  host: string;
  texto: string;
  itens: string[];
}
export interface EstadoTelegram {
  canal: CanalVisao;
  bot: BotVisao | null;
  /** `1234…:AA…xyz`; nunca o token. */
  token_mascarado: string | null;
  cofre_disponivel: boolean;
  texto_consentimento: TextoConsentimentoVisao;
  passos_botfather: string[];
  poller: { estado: EstadoPoller; ultimo_poll_em: string | null; conflito: boolean };
  pareamento: PareamentoVisao;
  autorizados: AutorizadoCompletoVisao[];
  contadores: { nao_autorizados: number; planos_pendentes: number };
}
export interface ResultadoTesteToken {
  ok: boolean;
  bot?: BotVisao;
  erro?: "formato" | "nao_autorizado" | "rede" | "webhook_ativo" | "cofre_indisponivel" | "consentimento";
  instrucao?: string;
}
export interface NaoAutorizadoVisao {
  user_id: number;
  primeiro_em: string;
  ultimo_em: string;
  contagem: number;
  bloqueado: boolean;
}
export interface AuditoriaTelegramVisao {
  id: string;
  ts: string;
  evento: string;
  user_id: number | null;
  workspace_id: string | null;
  plano_id: string | null;
  resultado: string | null;
  detalhe: Record<string, unknown>;
}
export interface PedidoConfigAutorizado {
  id: string;
  patch: {
    modo_padrao?: ModoWorkspaceTelegram;
    texto_livre?: boolean;
    workspaces?: WorkspaceTelegramVisao[];
    /** `string` define, `null` remove; o PIN entra uma vez e só o hash `scrypt` é gravado. */
    pin?: string | null;
  };
  /** `modo = direto` exige digitar `DIRETO`. */
  confirmacao?: string;
}

export type EventoPareamentoTelegram = { estado: PareamentoVisao["estado"]; pedido?: { pedido_id: string; nome: string; user_id: number } };
export type EventoTelegram = { tipo: "conflito" | "token_invalido" | "webhook_suspeito" | "rede" | "retomado" | "panico" | "entrada_expirou" | "parado" | "ativo" };
export interface PlanoPendenteDesktop {
  plano_id: string;
  resumo: string;
  args_hash: string;
  expira_em: string;
}

export interface ApiAlertas {
  catalogo(): Promise<MetaTipoVisao[]>;
  listar(f: FiltroListaAlertas): Promise<Pagina<AlertaVisao>>;
  contar(): Promise<{ nao_lidos: number; criticos: number }>;
  marcarLido(ids: string[]): Promise<{ n: number }>;
  marcarTodosLidos(filtro?: Omit<FiltroListaAlertas, "depois_id" | "limite">): Promise<{ n: number }>;
  silenciar(alvo: { tipo: TipoAlerta } | { entidade_tipo: string; entidade_id: string }, ate: string | null): Promise<{ ok: boolean }>;
  regrasListar(): Promise<Regra[]>;
  /** sem `id` = criar. */
  regraGravar(regra: Omit<Regra, "id"> & { id?: string }): Promise<Regra>;
  regraApagar(id: string): Promise<{ ok: boolean }>;
  regraPreset(preset: PresetRegraAlerta, canalId: string): Promise<Regra>;
  silencioLer(): Promise<SilencioGlobalVisao>;
  silencioGravar(s: SilencioGlobalVisao): Promise<SilencioGlobalVisao>;
  modelosListar(): Promise<ModeloVisao[]>;
  modeloGravar(m: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplate; corpo: string }): Promise<ModeloVisao | { erros: string[] }>;
  modeloRestaurar(m: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplate }): Promise<ModeloVisao>;
  modeloPrever(m: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplate; corpo: string }): Promise<PrevisaoModelo>;
  configLer(): Promise<ConfigAlertas>;
  configGravar(patch: Partial<ConfigAlertas>): Promise<ConfigAlertas>;
  abrirEntidade(alertaId: string): Promise<{ ok: boolean; destino: DestinoEntidade }>;
  canais: {
    listar(): Promise<CanalVisao[]>;
    consentir(canalId: string, versaoTexto: string, hashTexto: string): Promise<CanalVisao>;
    ligarSaida(canalId: string): Promise<CanalVisao>;
    desligarSaida(canalId: string): Promise<CanalVisao>;
    testeEnvio(canalId: string): Promise<{ ok: boolean; detalhe: string }>;
  };
  telegram: {
    estado(): Promise<EstadoTelegram>;
    tokenTestar(token: string | null): Promise<ResultadoTesteToken>;
    tokenSalvar(token: string): Promise<{ ok: boolean; token_mascarado?: string; bot?: BotVisao; erro?: ResultadoTesteToken["erro"]; instrucao?: string }>;
    tokenRemover(): Promise<{ ok: boolean }>;
    webhookLimpar(): Promise<{ ok: boolean }>;
    comandosConfigurar(): Promise<{ ok: boolean }>;
    parearIniciar(): Promise<{ codigo: string; link: string | null; expira_em: string }>;
    parearCancelar(): Promise<{ ok: boolean }>;
    parearDecidir(pedidoId: string, permitir: boolean): Promise<AutorizadoVisao | null>;
    autorizadoConfig(p: PedidoConfigAutorizado): Promise<{ ok: boolean; autorizado?: AutorizadoCompletoVisao; erro?: string }>;
    autorizadoRevogar(id: string): Promise<{ ok: boolean }>;
    naoAutorizadoListar(): Promise<NaoAutorizadoVisao[]>;
    naoAutorizadoBloquear(userId: number): Promise<{ ok: boolean }>;
    entradaLigar(ligada: boolean): Promise<{ ok: boolean; erro?: string; estado: EstadoTelegram }>;
    retomar(): Promise<EstadoTelegram>;
    panico(pararExecucoes: boolean): Promise<{ ok: boolean; revogados: number }>;
    planoDecidirDesktop(p: { plano_id: string; decisao: "aprovar" | "cancelar"; args_hash: string }): Promise<{ ok: boolean; motivo?: string }>;
    auditoriaListar(depois: string | null, limite?: number): Promise<Pagina<AuditoriaTelegramVisao>>;
    /** abre o diálogo de salvar no main; o destino nunca vem do renderer e nunca é `docs/**`. */
    auditoriaExportar(): Promise<{ ok: boolean; cancelado?: boolean }>;
  };
  assinarNovo(cb: (a: AlertaVisao) => void): () => void;
  assinarContagem(cb: (c: { nao_lidos: number; criticos: number }) => void): () => void;
  assinarMudou(cb: (e: { ids: string[] }) => void): () => void;
  assinarCanal(cb: (c: CanalVisao) => void): () => void;
  assinarPareamento(cb: (e: EventoPareamentoTelegram) => void): () => void;
  assinarTelegram(cb: (e: EventoTelegram) => void): () => void;
  assinarPlanoPendente(cb: (p: PlanoPendenteDesktop) => void): () => void;
}

export type PresetRegraAlerta = "tudo_no_app" | "atrasadas_e_erros_no_telegram" | "resumo_diario" | "tarefas_do_telegram";

// Constantes do canal Telegram que o main precisa conhecer SEM importar `nucleo/telegram` (P-143: o módulo só é carregado com o canal ativo).
/** versão do texto de consentimento: mudar o texto => nova versão => consentimento invalidado. */
export const VERSAO_TEXTO_CONSENTIMENTO_TELEGRAM = "tg-1";
export const HOST_TELEGRAM_API = "api.telegram.org";
export const ID_CANAL_SO = "canal_so";
export const ID_CANAL_TELEGRAM = "canal_telegram";
/** nome da entrada do cofre que guarda o token do bot deste canal. */
export const nomeSegredoTokenTelegram = (canal_id: string): string => `TELEGRAM_BOT_TOKEN_${canal_id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
