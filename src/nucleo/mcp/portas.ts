/**
 * Portas injetadas no servidor MCP: o que ele precisa do app, sem importar missoes/*, provedores/*,
 * banco ou terminais. O main implementa cada interface sobre os serviços reais (ver index.ts).
 * Vocabulário das portas é o do domínio (PT, sem acento); a tradução para o contrato externo
 * (inglês) acontece nas tools.
 */
import type { EstadoMissao, EstadoPane, ModoMissao, Papel, StatusHandoff } from "../dominio";
import type { Executor, Faixa, PropositoDecisao } from "../../compartilhado/harness";
import type { AccountUsage, CotaGeral } from "../../compartilhado/limites";
import type { EstadoFechado, FechadoPor } from "../orquestracao/ciclo-worker";

export type Portao = "direction" | "content" | "build" | "qa";
export const PORTOES: readonly Portao[] = ["direction", "content", "build", "qa"];

export interface PaneInfo {
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  provedor: string;
  papel: Papel;
  estado: EstadoPane;
  task_id: string | null;
  eh_piloto: boolean;
}

/** Worker que já saiu da grade (D-520), lembrado só em memória por ~10 min: o orquestrador ainda lê a cauda da saída e decide. */
export interface PaneFechadoInfo {
  pane_id: string;
  provedor: string;
  papel: Papel;
  task_id: string | null;
  estado: EstadoFechado;
  fechado_por: FechadoPor;
  codigo: number | null;
  /** ISO 8601 */
  fechado_em: string;
  /** só nos `falhou`: final da saída, redigido */
  ultimo_trecho?: string;
}

/** `handoff_read`: o que o worker entregou (resumo e relatório, este lido da pasta do produto, redigido e cortado). */
export interface RelatorioDoWorker {
  pane_id: string;
  task_ref: string | null;
  status: string;
  resumo: string;
  relatorio_path: string | null;
  relatorio: string | null;
  truncado: boolean;
}

export interface PedidoSpawn {
  workspace_id: string;
  mission_id: string | null;
  /** quem pediu (pane do token) */
  pedido_por_pane_id: string;
  provedor: string;
  /** Fase 9 (T-09.28): CLI a lançar quando `provedor` é `openrouter` (`pane_spawn.cli`); `null` = a primeira CLI compatível. */
  cli?: string | null;
  modelo: string | null;
  conta_id: string | null;
  papel: Papel;
  agente_id: string | null;
  briefing_path: string | null;
  cwd: string | null;
  /** Fase 9: skills sugeridas pela política (só texto no prompt inicial; `skills_aplicadas=false`). */
  skills?: string[];
  /**
   * Fase 10 (T-10.19): referência EXPLÍCITA do card (`T-NN.MM` do método) quando o pedido vem do board (`board:delegar_card`). Ausente = o main numera `t-N`. Com ela o main
   * reaproveita a linha de `task` `aberta` criada pela delegação (nunca duplica) e o índice `ux_task_ref` continua dando `conflict` se o card já foi delegado.
   */
  task_ref?: string | null;
  /** D-421: o que o worker deve fazer (o main grava como briefing do card dentro da pasta do produto quando não há `briefing_path`). Texto do próprio agente: nunca vira instrução de sistema. */
  prompt?: string | null;
  /** D-421: nome curto da tarefa (título do card, mostrado no cabeçalho do painel). */
  titulo?: string | null;
  /** D-421: `true` = worktree próprio para o worker (workspace git); `false` = mesma árvore; ausente = padrão do main (só executor em git). */
  isolar?: boolean | null;
  /** D-640: nível de aprovações pedido pelo orquestrador; só ABAIXA o configurado pelo dono (`perguntar` | `automatico_seguro`), nunca eleva; `total` não existe aqui. */
  aprovacao?: "perguntar" | "automatico_seguro" | null;
}

export interface PortaPanes {
  /** Cria o Pane (visível na UI) e devolve só o id. Falha de infraestrutura: lance qualquer erro (vira `unavailable`). */
  spawn(pedido: PedidoSpawn): Promise<{ pane_id: string }>;
  /** Panes vivos do workspace; `mission_id` null = panes fora de Missão. Encerrados não entram. */
  listar(filtro: { workspace_id: string; mission_id: string | null }): Promise<PaneInfo[]>;
  obter(pane_id: string): Promise<PaneInfo | null>;
  /** Últimas `ultimas` linhas da tela (já limitadas pelo chamador). De um worker fechado há pouco, a cauda guardada (`fechado` diz como terminou). */
  ler(pane_id: string, ultimas: number): Promise<{ linhas: string[]; estado: EstadoPane; fechado?: { estado: EstadoFechado; fechado_por: FechadoPor; codigo: number | null } } | null>;
  /** D-520: workers da Missão que fecharam nos últimos ~10 min (memória do main). Ausente = nenhum. */
  fechados?(filtro: { workspace_id: string; mission_id: string | null }): Promise<PaneFechadoInfo[]>;
  /** D-520: `handoff_read` — resumo e relatório entregues pelo worker. `null` = sem handoff. */
  relatorio?(pane_id: string): Promise<RelatorioDoWorker | null>;
  /** Digita no Pane. `enviar` resolve false se o Pane não aceita entrada. */
  enviar(pane_id: string, texto: string, submeter: boolean): Promise<boolean>;
  fechar(pane_id: string, motivo: string): Promise<boolean>;
}

export interface AgenteDoSquad {
  agente_id: string;
  papel: Papel;
}

export interface MissaoInfo {
  mission_id: string;
  workspace_id: string;
  modo: ModoMissao;
  estado: EstadoMissao;
  titulo: string;
  piloto_pane_id: string | null;
  /** Portões de intake já liberados pelo usuário. */
  portoes_liberados: readonly Portao[];
  /** Agentes do squad (modo squad/agentico com squad); `null` = sem restrição de squad. */
  agentes_do_squad: readonly AgenteDoSquad[] | null;
}

export interface PortaMissoes {
  obter(mission_id: string): Promise<MissaoInfo | null>;
  listar(filtro: { workspace_id: string; estado?: EstadoMissao }): Promise<MissaoInfo[]>;
  /** Conclui a Missão (transição para `concluida`). */
  concluir(mission_id: string): Promise<void>;
}

export interface ProvedorInfo {
  provedor: string;
  cli: string;
  contas: string[];
  habilitado: boolean;
  /** `openrouter`: CLIs compatíveis instaladas (T-09.28). */
  clis?: string[];
  /** `openrouter` desabilitado: por que (vira o subcode de `pane_spawn`/`model_list`). */
  motivo_desabilitado?: "openrouter_not_consented" | "model_not_enabled";
}

export interface ModeloInfo {
  modelo: string;
  /** o padrão da própria CLI (sem `--model`). */
  padrao?: boolean;
  niveis_esforco: string[];
  /** `openrouter`: faixa que o dono classificou (T-09.28). */
  faixa?: string;
}

export interface PortaProvedores {
  /** Todos os provedores conhecidos com o flag de habilitação; o MCP só expõe os habilitados. */
  listar(workspace_id: string): Promise<ProvedorInfo[]>;
  modelos(provedor: string): Promise<ModeloInfo[]>;
}

export interface PedidoHandoff {
  workspace_id: string;
  mission_id: string | null;
  /** Pane que entrega e seu papel: vêm do token. */
  pane_id: string;
  papel: Papel;
  task_id: string;
  resumo: string;
  relatorio_path: string;
  artefatos: string[];
  status: StatusHandoff;
}

export interface HandoffRegistrado {
  handoff_id: string;
  relatorio_path: string | null;
  status: StatusHandoff;
}

/** Implementada por orquestracao/handoff.ts (relatório → banco → wake). */
export interface PortaHandoff {
  registrar(pedido: PedidoHandoff): Promise<{ handoff_id: string }>;
  /** Último handoff registrado pelo Pane (stop hook). */
  doPane(pane_id: string): Promise<HandoffRegistrado | null>;
  /** A Missão tem handoff `ok` de um Pane de papel revisor? (mission_complete) */
  temRevisorOk(mission_id: string): Promise<boolean>;
}

export interface PortaRelogio {
  /** ms desde a época. */
  agora(): number;
}

export const relogioReal: PortaRelogio = { agora: () => Date.now() };

/** Resposta de um gancho (hook) para o script: o corpo JSON que o script imprime e o código de saída. */
export interface RespostaGancho {
  saida: Record<string, unknown> | null;
}

export interface ContextoGancho {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
}

/** Implementada por orquestracao/hooks/claude.ts. Só é chamada com token de Pane válido. */
export interface PortaGanchos {
  tratar(evento: string, contexto: ContextoGancho, corpo: unknown): Promise<RespostaGancho>;
}

// ---------------------------------------------------------------- Fase 9: harness e limites (T-09.17)
// O main implementa estas portas sobre o roteador, a política, as decisões e o serviço de limites. A thread do MCP só as chama
// (por RPC) e traduz para o contrato externo. NENHUMA delas devolve segredo, caminho de dado das CLIs nem valor de cofre.

export interface PoliticaInfo {
  task_type: string;
  categoria: string;
  rotulo: string;
  executor: Executor;
  alternativas: Executor[];
  fallback: Executor[];
  habilitada: boolean;
}

export interface RecomendacaoInfo {
  task_type: string;
  /** 0..1 */
  confianca: number;
  executor: Executor | null;
  conta_id: string | null;
  fonte: "decisor" | "heuristica" | "regra";
  recibo: string;
  /** erro nominal do roteamento (`no_capacity`, `unknown_task_type`…) quando não há rota. */
  erro: string | null;
}

export interface PedidoDefinirPolitica {
  workspace_id: string;
  /** Pane do piloto que pediu (só para a trilha de auditoria). */
  pedido_por_pane_id: string;
  task_type: string;
  provedor: string;
  cli: string | null;
  modelo: string | null;
  faixa: Faixa | null;
  esforco: string | null;
  /** `null` = mantém o fallback atual (ou usa o próprio executor se não havia política). */
  fallback: Executor[] | null;
}

export type ResultadoDefinirPolitica =
  | { ok: true; politica: PoliticaInfo; avisos: string[] }
  | { ok: false; erro: string; mensagem: string };

export interface DecisaoInfo {
  id: string;
  criado_em: string;
  proposito: PropositoDecisao;
  escolhida: string;
  fonte: string;
  recibo: string;
  custo_usd: number | null;
}

export interface PortaHarness {
  /** Política efetiva do workspace; só executores de provedores habilitados. */
  listar(workspace_id: string, categoria: string | null): Promise<PoliticaInfo[]>;
  /** Não cria Pane. */
  recomendar(workspace_id: string, descricao: string): Promise<RecomendacaoInfo>;
  /** Grava um override do workspace (atualizado_por `mcp`). Erros nominais voltam em `ok:false`. */
  definir(pedido: PedidoDefinirPolitica): Promise<ResultadoDefinirPolitica>;
  /** `harness_workspace.piloto_edita_politica` (relido a cada chamada: o opt-in pode ser desligado a qualquer hora). */
  pilotoEditaPolitica(workspace_id: string): Promise<boolean>;
  decisoes(filtro: { workspace_id: string; desde: string | null; proposito: PropositoDecisao | null; limite: number }): Promise<{ decisoes: DecisaoInfo[]; total: number; custo_usd: number | null }>;
}

export type JanelaDeEscolha = "five_hour" | "weekly" | "auto";
export type EstrategiaDeEscolha = "expires_first" | "max_slack";

export interface ResultadoEscolhaConta {
  conta_id: string;
  /** 100 − uso do gargalo; `null` = sem medida (nunca 0 por omissão). */
  folga_pct: number | null;
  motivo: string;
}

export interface PortaLimites {
  limites(provedor: string | null): Promise<{ contas: AccountUsage[]; geral: CotaGeral }>;
  /** Delega a `pickAccount` (única implementação de escolha de conta). `null` = nenhuma conta disponível. */
  escolher(pedido: { workspace_id: string; provedor: string; janela: JanelaDeEscolha; estrategia: EstrategiaDeEscolha; modelo: string | null }): Promise<ResultadoEscolhaConta | null>;
}

// ---------------------------------------------------------------- Fase 9: rota do `pane_spawn` sem provedor e troca de conta (T-09.16, T-09.20)
/** Pedido de rota para um Pane novo: nunca carrega segredo; a `descricao` serve só ao classificador e NÃO é gravada. */
export interface PedidoRotaSpawn {
  workspace_id: string;
  mission_id: string | null;
  pedido_por_pane_id: string;
  papel: Papel;
  agente_id: string | null;
  task_type: string | null;
  descricao: string | null;
  faixa: Faixa | null;
}

export interface RotaDoSpawn {
  provedor: string;
  cli: string;
  modelo: string | null;
  esforco: string | null;
  conta_id: string | null;
  faixa: Faixa | null;
  task_type: string;
  /** frase curta (≤ 240) do porquê da escolha. */
  recibo: string;
  decisoes: string[];
  /** skills da política (hoje só entram como lista no prompt inicial: `skills_aplicadas=false`). */
  skills: string[];
  decisao_id: string | null;
}

export type ResultadoRotaSpawn = ({ ok: true } & RotaDoSpawn) | { ok: false; erro: string; mensagem: string };

export interface PortaRota {
  /** `harness_workspace.nivel` (1..4). Nível 1 nunca roteia. */
  nivel(workspace_id: string): Promise<number>;
  /** O mesmo `rotear` do harness; nunca cria Pane. */
  rotear(pedido: PedidoRotaSpawn): Promise<ResultadoRotaSpawn>;
  /** Grava `pane_rota` do Pane recém-criado (perfil efetivo, task_type, decisão, saltos 0). */
  gravar(pane_id: string, rota: RotaDoSpawn, agente_id: string | null): Promise<void>;
}

export interface PedidoTrocaDeConta {
  pane_id: string;
  target_account_id: string | null;
  reason: string | null;
  force: boolean;
}
export interface ResultadoTrocaDeConta {
  new_pane_id: string;
  from: { conta_id: string | null; provedor: string; modelo: string | null };
  to: { conta_id: string | null; provedor: string; modelo: string | null };
}
/** O MESMO caminho do botão "mover" do app. Erros nominais voltam como `ErroMcp` (not_at_limit, provider_mismatch, no_capacity…). */
export interface PortaTroca {
  mover(pedido: PedidoTrocaDeConta): Promise<ResultadoTrocaDeConta>;
}

// ---------------------------------------------------------------- Fase 14: squads e agentes (T-14.13)
// A lógica inteira roda NO MAIN (`squads/invocacao.ts`); a thread do MCP só traduz o contrato externo e chama por RPC. Só dados clonáveis.

/** Um agente listado ao orquestrador: NUNCA carrega o texto do prompt. */
export interface AgenteListado {
  agent_id: string;
  role: string;
  label: string;
  description: string;
  tier: string;
  max_instances: number;
  in_flight: number;
}

/** Identidade do chamador, SEMPRE do token (nunca dos argumentos). */
export interface ClaimsDeSquad {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
  role: Papel;
  mode: ModoMissao;
}

export interface PedidoInvocarAgente {
  agent_id: string;
  briefing_path?: string;
  /** ≤ 4000 caracteres. */
  prompt?: string;
}

/** Erros nominais voltam como `ErroMcp` (`forbidden_role`, `gate_pending`, `limit_reached`, `provider_disabled`, `not_in_mission`, `not_found`, `invalid_argument`). */
export interface PortaSquads {
  listar(mission_id: string): Promise<{ agents: AgenteListado[] }>;
  invocar(claims: ClaimsDeSquad, args: PedidoInvocarAgente): Promise<{ pane_id: string; invocation_id: string }>;
}

// ---------------------------------------------------------------- Fase 8: memória local
export const NOMES_TOOLS_MEMORIA = ["memory_write", "memory_search", "memory_checkpoint", "memory_brief", "memory_forget"] as const;
export type NomeToolMemoria = (typeof NOMES_TOOLS_MEMORIA)[number];

/**
 * A lógica inteira roda NO MAIN (`servico.memory_*(paneIdDoToken, args)`); a thread do MCP só valida o formato, descarta campos de identidade e chama
 * por RPC. A identidade (`pane_id`) vem SEMPRE do token. Erros nominais voltam como `ErroMcp` (`memory_disabled`, `too_large`, `invalid_argument`,
 * `unauthorized`, `not_found`; `limit_reached`/`rate_limited` = `rule_violation`/`limit_reached`).
 */
export interface PortaMemoria {
  chamar(tool: NomeToolMemoria, pane_id: string, args: Record<string, unknown>): Promise<unknown>;
  /** `mission_complete`: o piloto gravou algum `aprendizado` ativo na Missão? */
  temAprendizado(mission_id: string): Promise<boolean>;
}

// ---------------------------------------------------------------- Fase 7B: segredos da Loja de MCPs (rota loopback `/loja/segredos`)
/**
 * A lógica roda NO MAIN: política do Pane (snapshot no lançamento), cofre, limite de 5 chamadas/min/Pane e a montagem do comando do servidor.
 * A thread do MCP só autentica o token (HMAC), extrai o `pane_id` DELE (nunca do corpo) e responde `status`/`corpo` sem logar nada.
 */
export interface PortaLoja {
  segredos(pane_id: string, servidor: unknown): Promise<{ status: number; corpo: unknown }>;
  /**
   * `mcp_store_list` (D-138): só os servidores HABILITADOS e configurados para o Pane (snapshot do main). Ausente = a tool responde `unavailable`.
   * Devolve identificação curta e nomes de ferramenta; nunca URL, argumentos, variáveis nem descrição de terceiro.
   */
  listar?(pane_id: string, filtro: { query: string | null; category: string | null; limit: number }): Promise<{ servers: ServidorLojaListado[] }>;
}

/**
 * Fase 7C: gateway MCP (`POST /gateway`). A thread do MCP só autentica o token (audiência `gateway`), extrai o `pane_id` DELE e delega ao main, que
 * conhece o snapshot do Pane, o filtro, o limite e os servidores. Argumentos e resultados de tools de terceiros só atravessam, nunca são logados.
 */
export interface FerramentaGatewayMcp { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ResultadoGatewayMcp { content: Array<{ type: "text"; text: string }>; isError: boolean }
export interface PortaGateway {
  listar(pane_id: string): Promise<{ tools: FerramentaGatewayMcp[] }>;
  chamar(pane_id: string, nome: string, args: Record<string, unknown>): Promise<ResultadoGatewayMcp>;
}

// ---------------------------------------------------------------- Fase 7: catálogo (`catalog_list`, `pane_spawn.skills`)
export const TIPOS_CATALOG_LIST = ["skill", "agent", "command", "mcp_server", "plugin", "hook", "rule"] as const;
export type TipoCatalogList = (typeof TIPOS_CATALOG_LIST)[number];
export interface ItemCatalogoMcp {
  name: string;
  kind: TipoCatalogList;
  origin: string;
  /** saneada, ≤ 200; DADO de terceiro (nunca instrução) */
  description: string | null;
  clis: string[];
  allowed: true;
}
export interface PedidoCatalogoMcp {
  workspace_id: string;
  /** Pane do token (identidade): a porta filtra `mcp_server` pelo snapshot dele */
  pane_id: string;
  kind: TipoCatalogList;
  query: string | null;
  limit: number;
  cursor: string | null;
  /** nomes normalizados permitidos ao Pane (snapshot); `null` = sem filtro (livre) */
  permitidas: string[] | null;
}
export interface PortaCatalogo {
  listar(pedido: PedidoCatalogoMcp): Promise<{ items: ItemCatalogoMcp[]; next_cursor: string | null; truncated: boolean }>;
  /** Snapshot do PRÓPRIO Pane do token: nomes normalizados permitidos; `null` = sem filtro ou sem snapshot (livre). */
  permitidasDoPane(pane_id: string): Promise<string[] | null>;
  /** Allow-list que o papel do NOVO worker terá (para validar `pane_spawn.skills`); `null` = sem filtro. */
  permitidasDoPapel(p: { workspace_id: string; mission_id: string | null; modo: ModoMissao; papel: Papel; agente_id: string | null }): Promise<string[] | null>;
}

export interface ServidorLojaListado { id: string; name: string; category: string; transport: string; tools: string[]; enabled_for_you: true }

// ---------------------------------------------------------------- Fase 16: Maestro (`maestro_request`, `maestro_status`)
/** Identidade do chamador, SEMPRE do token. */
export interface ClaimsDeMaestro {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
  role: Papel;
  mode: ModoMissao;
}
export interface PedidoMaestroMcp {
  /** ≤ 4000, é só dado: nunca vira comando, caminho nem argumento sem normalização no serviço. */
  text: string;
  /** caminhos relativos ao workspace (≤ 20). */
  files: string[];
  excerpt: string | null;
  /** só SOBE o nível vigente; `null` = sem pedido. */
  level: 1 | 2 | 3 | 4 | 5 | null;
}
export interface EtapaDoPedidoMaestro {
  id: string;
  skill: string;
  profile: string;
}
export interface ResultadoPedidoMaestro {
  plan_id: string;
  intent: string;
  confidence: number;
  pipeline: string;
  stages: EtapaDoPedidoMaestro[];
  state: "proposed" | "running";
  needs_user_confirmation: boolean;
  message: string;
}
export interface PipelineDoStatusMaestro {
  id: string;
  state: string;
  current_stage: string | null;
  stages: Array<{ id: string; state: string }>;
  level: number;
}
/**
 * A lógica roda NO MAIN (`ServicoMaestro`); a thread do MCP só valida o formato e chama por RPC. Erros nominais voltam como `ErroMcp`
 * (`rule_violation/loop_guard`, `rule_violation/limit_reached` para a taxa, `invalid_argument`, `unavailable`). Ausente = as tools respondem `unavailable`.
 */
export interface PortaMaestroMcp {
  pedir(claims: ClaimsDeMaestro, pedido: PedidoMaestroMcp): Promise<ResultadoPedidoMaestro>;
  status(claims: ClaimsDeMaestro, plan_id: string | null): Promise<{ pipelines: PipelineDoStatusMaestro[] }>;
  /** Reconferência a CADA chamada: `false` para Pane de etapa/Missão do Maestro (o main também a usa ao emitir o token). */
  permitido(pane_id: string): Promise<boolean>;
}

// ---------------------------------------------------------------- Fase 18: gestão ágil (`backlog_*`, `estimate_*`, `sprint_status`, `rework_list`, `metrics_get`)
export const NOMES_TOOLS_AGIL = ["backlog_list", "backlog_get", "backlog_propose", "estimate_get", "estimate_propose", "sprint_status", "rework_list", "metrics_get"] as const;
export type NomeToolAgil = (typeof NOMES_TOOLS_AGIL)[number];

/** Identidade do chamador, SEMPRE do token (nunca dos argumentos). `workspace_id` delimita tudo o que a tool enxerga. */
export interface ClaimsDeAgil {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
  role: Papel;
  mode: ModoMissao;
}

/**
 * A lógica roda NO MAIN (`ServicoAgil.portaMcp`); a thread do MCP só valida o formato, descarta campos de identidade e chama por RPC. O agente LÊ e PROPÕE:
 * nunca decide (estimativa humana prevalece: `applied:false, reason:"humano_prevalece"`), nunca confirma retrabalho, nunca inicia/fecha sprint. Tentar uma ação humana
 * volta como `rule_violation/human_only`. Escritas (`backlog_propose`, `estimate_propose`) só do piloto em `squad`/`agentico`, reconferido a cada chamada.
 */
export interface PortaAgilMcp {
  chamar(tool: NomeToolAgil, claims: ClaimsDeAgil, args: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------- Fase 10: board e custo (`task_list`, `task_get`, `cost_report`) — SOMENTE LEITURA
export const NOMES_TOOLS_CUSTO = ["task_list", "task_get", "cost_report"] as const;
export type NomeToolCusto = (typeof NOMES_TOOLS_CUSTO)[number];

/** Identidade do chamador, SEMPRE do token (nunca dos argumentos): a Missão e o workspace do token delimitam tudo o que as tools enxergam. */
export interface ClaimsDeCusto {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
  role: Papel;
  mode: ModoMissao;
}
/** Card leve do `task_list` (vocabulário do domínio; a tool traduz). `usd: null` = desconhecido (nunca 0 por omissão). */
export interface CardLeveMcp {
  task_id: string;
  titulo: string;
  coluna: "backlog" | "a_fazer" | "em_andamento" | "em_revisao" | "concluido" | "validado";
  pronta: boolean;
  custo: { usd: number | null; incompleto: boolean };
}
export interface DetalheTaskMcp {
  task_id: string;
  titulo: string;
  coluna: CardLeveMcp["coluna"];
  depende_de: string[];
  contrato: { objetivo: string | null; criterio_aceite: string | null; teste_integracao: string | null; teste_funcional: string | null; teste_regressao: string | null };
  janela: { inicio: string; fim: string | null; origem: "banco" | "rastro" } | null;
  custo: { usd: number | null; incompleto: boolean; aproximado: boolean };
  custo_por_modelo: Array<{ modelo: string | null; tokens_entrada: number; tokens_saida: number; usd: number | null; aproximado: boolean }>;
  panes: Array<{ pane_id: string; cli: string; modelo: string | null; papel: string }>;
  handoffs: Array<{ id: string; status: string; resumo: string; criado_em: string }>;
}
export interface LinhaCustoMcp {
  chave: string;
  usd: number | null;
  incompleto: boolean;
  aproximado: boolean;
  tokens_entrada: number;
  tokens_saida: number;
}
/**
 * A lógica roda NO MAIN (`ServicoBoard`/`ServicoCusto`); a thread do MCP valida o formato, descarta campos de identidade e chama por RPC. Nenhum método ESCREVE: não existe
 * entrada de custo/tokens (D-104). A Missão do token é o escopo: `trabalho_id` de outra Missão ⇒ `not_found`.
 */
export interface PortaCustoMcp {
  listarTasks(claims: ClaimsDeCusto, p: { trabalho_id: string | null; coluna: CardLeveMcp["coluna"] | null; limite: number; cursor: string | null }): Promise<{ itens: CardLeveMcp[]; proximo: string | null }>;
  obterTask(claims: ClaimsDeCusto, p: { task_id: string; trabalho_id: string | null }): Promise<DetalheTaskMcp>;
  relatorio(claims: ClaimsDeCusto, p: { agrupar: "task" | "modelo" | "conta" | "pane" | "dia"; desde: string | null; ate: string | null }): Promise<{ linhas: LinhaCustoMcp[]; total: Omit<LinhaCustoMcp, "chave"> }>;
}

// ---------------------------------------------------------------- Fase 15: RAG local (`rag_search`, `rag_context`, `rag_learn`, `rag_feedback`)
export const NOMES_TOOLS_RAG = ["rag_search", "rag_context", "rag_learn", "rag_feedback"] as const;
export type NomeToolRag = (typeof NOMES_TOOLS_RAG)[number];

/**
 * DECISÃO DE ASSINATURA: o servidor MCP roda em worker thread e a porta chega por RPC (`rag.*`, como as demais). Por isso `ativo` e `politica`,
 * síncronos no rascunho da fase, são `Promise` aqui (RPC é sempre assíncrono). `ativo` é reconferido a CADA chamada (`rag_disabled`); o main também a usa
 * ao emitir o token (`opcoes.rag`). A lógica inteira roda NO MAIN (`ServicoConhecimento`); a thread do MCP só valida o formato, descarta campos de
 * identidade e traduz o contrato externo (EN) para este vocabulário (PT). A identidade (workspace/missão/task/pane) vem SEMPRE do token. Erros nominais
 * voltam como `ErroMcp` (`rule_violation/limit_reached`, `rag_disabled`, `unavailable/rag_unavailable`, `invalid_argument`). Ausente = as tools respondem
 * `unavailable` e nem aparecem no `tools/list` (token sem `rag`).
 */
export interface PortaRag {
  /** conhecimento_config.ativo && global, reconferido a cada chamada. */
  ativo(workspaceId: string): Promise<boolean>;
  buscar(p: { workspace_id: string; mission_id: string | null; task_ref: string | null; pane_id: string; consulta: string; escopo: "projeto" | "missao" | "usuario" | "equipe"; tipos: string[] | null; desde: string | null; limite: number; modo: "hibrido" | "lexical" | "semantico"; fontes: ("rag" | "memox")[] }): Promise<import("../../compartilhado/conhecimento").RespostaBusca>;
  contexto(p: { workspace_id: string; mission_id: string | null; task_ref: string | null; pane_id: string; tarefa: string; arquivos: string[]; orcamento_chars: number }): Promise<import("../../compartilhado/conhecimento").RespostaContexto>;
  aprender(p: { workspace_id: string; mission_id: string | null; task_ref: string | null; pane_id: string; cli: string | null; tipo: "decisao" | "causa_raiz" | "armadilha" | "padrao" | "correcao" | "fato"; titulo: string; texto: string; arquivos: string[]; substitui: string | null }): Promise<{ id: string; status: "candidate" | "active" | "merged"; merged_into?: string }>;
  feedback(p: { workspace_id: string; pane_id: string; consulta_id: string | null; alvo_id: string; valor: "util" | "inutil" | "errado"; nota: string | null }): Promise<{ ok: boolean }>;
  /** a (Missão, task) consultou o RAG nos últimos 30 min? `taskRef` vazio = qualquer task da Missão. */
  consultouRecentemente(missionId: string, taskRef: string): Promise<boolean>;
  /** consulta_obrigatoria do workspace: off|aviso|bloqueio, e hook_prompt ligado? */
  politica(workspaceId: string): Promise<{ consulta_obrigatoria: "off" | "aviso" | "bloqueio"; hook_prompt: boolean; contexto_chars: number }>;
  /** contexto injetado no despacho/hook (≤150ms, nunca lança; "" se nada). Registra rag_consulta(origem). */
  contextoParaInjecao(p: { workspace_id: string; mission_id: string | null; task_ref: string | null; pane_id: string | null; tarefa: string; arquivos: string[]; origem: "injecao" | "hook" }): Promise<string>;
}

// ---------------------------------------------------------------- Fase 20: alertas (`alert_raise`)
/** Identidade do chamador, SEMPRE do token (nunca dos argumentos). */
export interface ClaimsDeAlerta {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
  role: Papel;
  mode: ModoMissao;
}
/**
 * A lógica roda NO MAIN (`LigacaoAlertas.alertRaise`: limite de 3/hora/Pane, redação, `agente_mensagem` só no app); a thread do MCP valida o formato e chama por RPC. Erros nominais voltam como
 * `ErroMcp` (`invalid_argument`, `rule_violation/limit_reached` para a taxa, `rule_violation/forbidden_role`). Nenhuma tool lê alertas, envia ao Telegram nem mexe em canais (D-138).
 */
export interface PortaAlertasMcp {
  levantar(claims: ClaimsDeAlerta, args: { kind: "info" | "attention" | "blocked" | "done"; title: string; detail?: string; task_id?: string }): Promise<{ alert_id: string; queued: boolean }>;
}

// ---------------------------------------------------------------- Fase 17: mapa lógico do código (`map_status`, `map_query`, `map_impact`, `map_evidence`)
export const NOMES_TOOLS_MAPA = ["map_status", "map_query", "map_impact", "map_evidence"] as const;
export type NomeToolMapa = (typeof NOMES_TOOLS_MAPA)[number];

export const TIPOS_CONSULTA_MAPA = ["search", "neighbors", "callers", "callees", "dependents", "cycles", "entrypoints", "tables", "hotspots", "layers", "unused", "externals"] as const;
export type TipoConsultaMapa = (typeof TIPOS_CONSULTA_MAPA)[number];
export const TOPICOS_EVIDENCIA_MAPA = ["tests", "layers", "errors", "config", "dialects", "entrypoints", "data_access", "commands"] as const;
export type TopicoEvidenciaMapa = (typeof TOPICOS_EVIDENCIA_MAPA)[number];

export interface StatusMapaMcp {
  state: "empty" | "partial" | "ready";
  generated_at: string | null;
  files: number;
  languages: Array<{ language: string; files: number; loc: number }>;
  edges: { exact: number; heuristic: number };
  /** `null` = nunca verificado. */
  stale: boolean | null;
  history: "ok" | "partial" | "unavailable";
}
export interface ItemMapaMcp {
  id: string;
  kind: string;
  label: string;
  /** Relativo à raiz do workspace; `null` para nós sem arquivo (tabela, externo). */
  path: string | null;
  line: number | null;
  confidence: "exact" | "heuristic" | null;
  metrics?: Record<string, number | string | boolean | null>;
}
export interface ImpactoMapaMcp {
  files: string[];
  signals: Array<{ id: number; name: string; min: number | null; max: number | null; value: string; method: string; worst_case: boolean }>;
  band: "LOW" | "MEDIUM" | "HIGH";
  band_worst_case: "LOW" | "MEDIUM" | "HIGH";
  worst_case: Array<{ signal: number; reason: string }>;
  seam_candidates: string[];
  callers: string[];
  note: string;
}
export interface FatoMapaMcp {
  fact: string;
  /** Até 5 evidências `caminho:linha`. */
  evidence: string[];
  /** `UNÂNIME`, `MAJORITÁRIO n/m`, `CONFLITO`, `ÚNICO CASO`, `AUSENTE`… */
  strength: string;
  counts: Record<string, number>;
}
/**
 * CONTRATO da porta do mapa (a lógica inteira roda NO MAIN; a thread do MCP só valida o formato e chama por RPC, `mapa.*`).
 * O `workspaceId` vem SEMPRE do token, nunca de argumento. Todos os métodos são assíncronos (RPC).
 *  - `disponivel(ws)`: mapa habilitado E opt-in `expor_agentes` no workspace; reconferido a CADA chamada. `false` => a tool responde `unavailable/map_not_ready`
 *    (e o token nem recebe `map_*` quando `opcoes.mapa` não é emitido).
 *  - `status(ws)`: resumo leve; `state: "empty"` quando não há análise => as demais tools respondem `unavailable/map_not_ready`.
 *  - `query/impact/evidence`: SOMENTE LEITURA, respostas já sem código-fonte (nomes, caminhos relativos, linhas). Erros nominais voltam como `ErroMcp`.
 *  Os argumentos chegam validados: caminhos relativos, sem `..`, sem NUL, sem arquivo de ambiente; `limit` <= 100; `depth` <= 5.
 * Agentes NÃO disparam análise: não existe método de escrita nesta porta.
 */
export interface PortaMapaMcp {
  disponivel(workspaceId: string): Promise<boolean>;
  status(workspaceId: string): Promise<StatusMapaMcp>;
  query(workspaceId: string, a: { kind: TipoConsultaMapa; target: string | null; depth: number; limit: number; min_confidence: "exact" | "heuristic" }): Promise<{ items: ItemMapaMcp[]; truncated?: boolean }>;
  impact(workspaceId: string, a: { files: string[]; symbols: string[] }): Promise<ImpactoMapaMcp>;
  evidence(workspaceId: string, a: { topic: TopicoEvidenciaMapa; scope: string | null; limit: number }): Promise<{ facts: FatoMapaMcp[] }>;
}
