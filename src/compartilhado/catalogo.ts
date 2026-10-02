// Contratos da Fase 7 (Catálogo de skills, agentes, comandos, hooks, regras e MCPs de usuário) e da Fase 7C (Gateway MCP).
// Compartilhado entre main, preload e renderer. Só tipos e constantes puras (D-30: o preload não importa runtime).
// O renderer NUNCA envia caminho: só `item_id`/`cli`/`escopo`. Valor de segredo nunca atravessa (o gateway só expõe NOMES).

export const CLIS_CATALOGO = ["claude", "codex", "opencode", "gemini", "portatil"] as const;
export type CliCatalogo = (typeof CLIS_CATALOGO)[number];
/** `agent` e `command` (D-371) estendem a lista do plano: agentes (`.claude/agents/*.md`) e comandos/templates de prompt (`.claude/commands/*.md`). */
export const TIPOS_CATALOGO = ["skill", "agent", "command", "mcp_server", "mcp_tool", "plugin", "hook", "rule"] as const;
export type TipoCatalogo = (typeof TIPOS_CATALOGO)[number];
export type OrigemCatalogo = "usuario" | "terceiro" | "embarcada" | "nativa" | "metodo";
export type EscopoCatalogo = "global" | "projeto";
export type MetodoInstalacao = "nativo" | "symlink" | "copia";
export type EstadoInstalacao = "presente" | "ausente" | "quebrado";
export type NivelIsolamento = "duro" | "parcial" | "nenhum";
export type PapelSugerido = "explorador" | "executor" | "revisor";
export type GatilhoVarredura = "boot" | "workspace" | "manual" | "tela";

export interface InstalacaoCatalogo {
  cli: CliCatalogo;
  escopo: EscopoCatalogo;
  workspace_id: string | null;
  base: "home" | "workspace";
  caminho_rel: string;
  metodo: MetodoInstalacao;
  estado: EstadoInstalacao;
  habilitada: boolean;
  criado_pelo_app: boolean;
  hash_conteudo: string | null;
  /** saneado; nunca env/headers/args/texto de comando */
  detalhe: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ItemCatalogo {
  id: string;
  tipo: TipoCatalogo;
  nome: string;
  nome_normalizado: string;
  plugin: string | null;
  autor: string | null;
  origem: OrigemCatalogo;
  /** ≤ 160 na lista; ≤ 600 no detalhe. Texto de terceiro = DADO, nunca instrução. */
  descricao: string | null;
  papel_sugerido: PapelSugerido | null;
  instalacoes: InstalacaoCatalogo[];
  /** hashes distintos entre CLIs */
  variantes: number;
  /** origem === "usuario" */
  editavel: boolean;
  atualizado_em: string;
}

export interface DetalheCatalogo extends ItemCatalogo {
  /** só para `mcp_server` verificado sob demanda: nomes saneados */
  ferramentas: Array<{ nome: string; descricao: string | null }>;
}

export type CodigoSaude =
  | "skill_inexistente"
  | "descricao_vazia"
  | "symlink_quebrado"
  | "politica_referencia_ausente"
  | "mcp_nao_verificado"
  | "variantes_divergentes"
  | "isolamento_parcial";
export interface AchadoSaude {
  nivel: "erro" | "aviso";
  codigo: CodigoSaude;
  item: string | null;
  detalhe: string;
}

export interface PoliticaSkills {
  id: string;
  workspace_id: string;
  alvo_tipo: "papel" | "agente" | "missao";
  alvo_valor: string;
  skills: string[];
  mcp_do_usuario: "nenhum" | "lista";
  servidores_mcp: string[];
  atualizado_em: string;
}
export interface PoliticaResolvida {
  /** `null` = sem filtro (painel `livre`) */
  skills: string[] | null;
  faltando: string[];
  mcp_do_usuario: "nenhum" | "lista";
  servidores_mcp: string[];
  isolamento: Record<CliCatalogo, NivelIsolamento>;
}

export type CodigoInstalar = "ja_instalado" | "conflito" | "erro" | "instalado";
export interface ResultadoInstalar {
  estado: "instalado" | "ja_instalado" | "conflito" | "erro";
  caminho_rel: string | null;
  codigo: string | null;
}
export interface EstadoEmbarcada {
  nome: string;
  versao_pacote: string;
  descricao: string;
  clis: Array<{ cli: CliCatalogo; instalada: boolean; versao: string | null; editada: boolean; opt_out: boolean }>;
}

// ---- eventos (um canal por evento; envelope com `versao: 1`) ----
export interface ProgressoCatalogo {
  versao: 1;
  varredura_id: string;
  cli: CliCatalogo | null;
  tipo: TipoCatalogo | null;
  feitos: number;
  total: number | null;
}
export interface ErroVarreduraCatalogo {
  cli: CliCatalogo | null;
  tipo: TipoCatalogo | null;
  codigo: string;
  mensagem: string;
}
export interface ConcluidoCatalogo {
  versao: 1;
  varredura_id: string;
  adicionados: number;
  atualizados: number;
  ausentes: number;
  duracao_ms: number;
  erros: ErroVarreduraCatalogo[];
}
export interface MudouCatalogo {
  versao: 1;
  tipos: TipoCatalogo[];
  /** ≤ 200; vazio = "recarregue" */
  item_ids: string[];
}
export type EventoCatalogo =
  | ({ tipo_evento: "progresso" } & ProgressoCatalogo)
  | ({ tipo_evento: "concluido" } & ConcluidoCatalogo)
  | ({ tipo_evento: "mudou" } & MudouCatalogo);

export interface PedidoVarrer {
  workspace_id: string | null;
  tipos: TipoCatalogo[] | null;
  clis: CliCatalogo[] | null;
}
export interface PedidoListarCatalogo {
  tipo: TipoCatalogo;
  workspace_id: string | null;
}
export interface ResultadoListarCatalogo {
  itens: ItemCatalogo[];
  truncado: boolean;
  ultima_varredura_em: string | null;
}
export interface PedidoInstalarCatalogo {
  item_id: string;
  de_cli: CliCatalogo;
  para_cli: CliCatalogo;
  modo: "symlink" | "copia";
}
export interface PedidoDesinstalarCatalogo {
  item_id: string;
  cli: CliCatalogo;
  escopo: EscopoCatalogo;
  workspace_id: string | null;
  modo: "remover_criado" | "lixeira";
}
export interface PedidoRevelarCatalogo {
  item_id: string;
  cli: CliCatalogo;
  escopo: EscopoCatalogo;
  workspace_id: string | null;
}
export interface PedidoPoliticaGravar {
  workspace_id: string;
  alvo_tipo: "papel" | "agente" | "missao";
  alvo_valor: string;
  skills: string[];
  mcp_do_usuario: "nenhum" | "lista";
  servidores_mcp: string[];
}
export interface PedidoPoliticaPrevia {
  workspace_id: string;
  modo: "livre" | "squad" | "agentico";
  papel: "piloto" | "executor" | "explorador" | "revisor";
  agente_id: string | null;
  mission_id: string | null;
  cli: CliCatalogo;
}
export interface ResultadoVerificarMcp {
  estado: "ok" | "indisponivel";
  ferramentas: number;
  erro: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fase 7C: Gateway MCP. Um único endpoint MCP em loopback (`POST /gateway`, mesma porta do servidor do app, D-370) que agrega os
// servidores da Loja habilitados para o Pane, com filtro por Pane/papel/escopo, token HMAC por Pane, rate limit e auditoria.
// ---------------------------------------------------------------------------------------------------------------------

/** `completo` expõe todas as tools permitidas; `reduzido` corta descrições e limita a `max_ferramentas`; `busca` expõe só `gateway_search` + `gateway_call`. */
export const MODOS_SUPERFICIE_GATEWAY = ["completo", "reduzido", "busca"] as const;
export type ModoSuperficieGateway = (typeof MODOS_SUPERFICIE_GATEWAY)[number];
export const PAPEIS_GATEWAY = ["piloto", "executor", "explorador", "revisor"] as const;
export type PapelGateway = (typeof PAPEIS_GATEWAY)[number];

export interface ConfigGateway {
  workspace_id: string;
  /** opt-in: desligado por padrão (a Loja segue injetando por Pane como antes) */
  ativo: boolean;
  modo_superficie: ModoSuperficieGateway;
  max_ferramentas: number;
  /** chamadas de tool por minuto por Pane (1..600) */
  limite_por_min: number;
  /** encerra servidor stdio sem chamada há N segundos (30..3600) */
  ocioso_s: number;
  atualizado_em: string | null;
}
export interface PedidoConfigGateway {
  workspace_id: string;
  ativo: boolean;
  modo_superficie: ModoSuperficieGateway;
  max_ferramentas: number;
  limite_por_min: number;
  ocioso_s: number;
}
export interface EstadoGateway {
  /** porta loopback do servidor do app, se estiver de pé */
  disponivel: boolean;
  panes_ativos: number;
  servidores_conectados: number;
  chamadas: number;
  bloqueadas: number;
  limitadas: number;
}
export interface FerramentaGateway {
  servidor_id: string;
  nome: string;
  descricao: string | null;
  /** efetiva para o papel consultado (política + filtro) */
  habilitada: boolean;
  /** `true` se há regra explícita gravada (senão herda o padrão) */
  explicita: boolean;
  /** heurística só informativa: nome sugere escrita/execução */
  risco: "leitura" | "escrita" | "desconhecido";
}
export interface PedidoFerramentasGateway {
  workspace_id: string;
  servidor_id: string;
  papel: PapelGateway;
}
export interface PedidoFiltroGateway {
  workspace_id: string;
  servidor_id: string;
  ferramenta: string;
  papel: PapelGateway;
  habilitada: boolean;
}
export type DecisaoAuditoriaGateway = "permitida" | "negada_filtro" | "negada_limite" | "negada_servidor" | "erro";
export interface EntradaAuditoriaGateway {
  id: string;
  em: string;
  workspace_id: string;
  pane_id: string;
  papel: string;
  servidor_id: string | null;
  ferramenta: string | null;
  decisao: DecisaoAuditoriaGateway;
  duracao_ms: number | null;
  /** nunca argumentos nem resultado: só tamanhos */
  bytes_entrada: number | null;
  bytes_saida: number | null;
}
export interface PedidoAuditoriaGateway {
  workspace_id: string | null;
  limite: number;
}
export type EventoGateway =
  | { versao: 1; tipo: "chamada"; pane_id: string; servidor_id: string | null; ferramenta: string | null; decisao: DecisaoAuditoriaGateway }
  | { versao: 1; tipo: "servidor_encerrado_ocioso"; servidor_id: string }
  | { versao: 1; tipo: "pane_revogado"; pane_id: string };

export interface ApiCatalogo {
  varrer(pedido: PedidoVarrer): Promise<{ varredura_id: string }>;
  listar(pedido: PedidoListarCatalogo): Promise<ResultadoListarCatalogo>;
  detalhe(itemId: string): Promise<DetalheCatalogo | null>;
  instalar(pedido: PedidoInstalarCatalogo): Promise<ResultadoInstalar>;
  desinstalar(pedido: PedidoDesinstalarCatalogo): Promise<{ ok: boolean; codigo: string | null }>;
  limparAusentes(tipo: TipoCatalogo): Promise<{ removidos: number }>;
  removerDoCatalogo(itemId: string): Promise<{ ok: boolean }>;
  revelar(pedido: PedidoRevelarCatalogo): Promise<boolean>;
  verificarMcp(itemId: string, confirmado: true): Promise<ResultadoVerificarMcp>;
  politicaLer(workspaceId: string): Promise<PoliticaSkills[]>;
  politicaGravar(pedido: PedidoPoliticaGravar): Promise<PoliticaSkills>;
  politicaPrevia(pedido: PedidoPoliticaPrevia): Promise<PoliticaResolvida>;
  saude(workspaceId: string | null): Promise<AchadoSaude[]>;
  embarcadasEstado(): Promise<EstadoEmbarcada[]>;
  embarcadasInstalar(nome: string | null, cli: CliCatalogo): Promise<{ instaladas: string[]; preservadas_editadas: string[] }>;
  embarcadasOptOut(nome: string, cli: CliCatalogo, valor: boolean): Promise<{ ok: true }>;
  assinar(cb: (e: EventoCatalogo) => void): () => void;
}

export interface ApiGateway {
  estado(): Promise<EstadoGateway>;
  configLer(workspaceId: string): Promise<ConfigGateway>;
  configGravar(pedido: PedidoConfigGateway): Promise<ConfigGateway>;
  ferramentas(pedido: PedidoFerramentasGateway): Promise<FerramentaGateway[]>;
  filtroDefinir(pedido: PedidoFiltroGateway): Promise<{ ok: boolean }>;
  auditoria(pedido: PedidoAuditoriaGateway): Promise<EntradaAuditoriaGateway[]>;
  revogarPane(paneId: string): Promise<{ ok: boolean }>;
  assinar(cb: (e: EventoGateway) => void): () => void;
}
