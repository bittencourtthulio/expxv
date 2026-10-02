// Contratos de squads e agentes (Fase 14, T-14.01). Tipos puros + conjuntos fechados; sem I/O.
// As squads do usuário vivem em ARQUIVOS (D-201): o SQLite guarda só execução e auditoria. O texto do prompt de um
// membro NUNCA viaja em `Squad` (só o caminho relativo `membros/<slug>.md`); ele passa apenas por `agentes:prompt_*`.
import type { Faixa, PerfilAgente } from "./harness";
import type { EstadoMissao, PortaoMissao } from "./dominio";

export type { Faixa, PerfilAgente, PortaoMissao };

// ---- conjuntos fechados ----
export const PAPEIS_SQUAD = ["orchestrator", "scout", "executor", "reviewer"] as const;
export type PapelSquad = (typeof PAPEIS_SQUAD)[number];
/** Mapa 1:1 do papel externo (arquivo) para o papel interno do domínio (Pane/token MCP). */
export const PAPEL_INTERNO = { orchestrator: "piloto", scout: "explorador", executor: "executor", reviewer: "revisor" } as const satisfies Record<PapelSquad, string>;

export const ESCOPOS_SQUAD = ["desenvolvimento", "qualidade", "seguranca", "documentacao", "devops", "pesquisa", "outro"] as const;
export type EscopoSquad = (typeof ESCOPOS_SQUAD)[number];

export const ORIGENS_SQUAD = ["fabrica", "usuario", "importada"] as const;
export type OrigemSquad = (typeof ORIGENS_SQUAD)[number];

/** P-02 / D-232: três perfis por agente; `null` = herda da Missão e do workspace. Nunca o bypass total de sandbox. */
export const PERMISSOES_MEMBRO = ["seguro", "equilibrado", "automatico"] as const;
export type PermissaoMembro = (typeof PERMISSOES_MEMBRO)[number];

export const NIVEIS_RIGIDEZ = [1, 2, 3, 4, 5] as const;
export type NivelRigidez = (typeof NIVEIS_RIGIDEZ)[number];

/** CLIs do catálogo + `auto` (a faixa escolhe; Fase 9). O IPC só recusa formato; `cli_desconhecida` é achado (T-14.04). */
export const CLIS_CATALOGO = ["claude", "codex", "opencode", "gemini", "aider", "qwen", "kilo", "grok"] as const;
/** O orquestrador exige CLI com contrato de intake (D-203). */
export const CLIS_COM_INTAKE = ["claude", "codex", "opencode"] as const;
export const CLI_AUTO = "auto";

/** Esforço aceito no arquivo: neutro (por faixa) ou nível nativo de alguma CLI (`NIVEIS_POR_CLI`, T-14.05). */
export const ESFORCOS_NEUTROS = ["baixo", "medio", "alto"] as const;
export const ESFORCOS_NATIVOS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const ESFORCOS_CONHECIDOS: readonly string[] = [...ESFORCOS_NEUTROS, ...ESFORCOS_NATIVOS];
export type ModoEsforco = "flag" | "config" | "indicativo" | "nenhum";
export const MODOS_ESFORCO: readonly ModoEsforco[] = ["flag", "config", "indicativo", "nenhum"];

/** Variáveis do prompt do membro (conjunto FECHADO). As três primeiras são não confiáveis (bloco `DADO`, D-202). */
export const VARIAVEIS_NAO_CONFIAVEIS = ["objetivo", "contexto_rag", "arquivos"] as const;
export const VARIAVEIS_PROMPT = [...VARIAVEIS_NAO_CONFIAVEIS, "squad", "membro", "rotulo", "missao", "card", "pasta", "rigor"] as const;
export type VariavelPrompt = (typeof VARIAVEIS_PROMPT)[number];

// ---- limites (um lugar só; validadores e núcleo leem daqui) ----
export const LIMITES_SQUAD = {
  slug_max: 40,
  agent_id_max: 80,
  membros_min: 3,
  membros_max: 12,
  rotulo_max: 40,
  descricao_squad_max: 280,
  descricao_membro_max: 140,
  prompt_max_bytes: 16 * 1024,
  objetivo_max: 4000,
  instancias_min: 1,
  instancias_max: 8,
  /** P-233: padrão de terminais paralelos por squad (configurável até o limite global `max_parallel_panes`). */
  paralelas_padrao: 6,
  tempo_min_max: 1440,
  lista_permitidos_max: 64,
  busca_max: 80,
  execucoes_limite_max: 100,
} as const;
/** `^[a-z0-9][a-z0-9-]{0,39}$` — slug de squad e de membro (nunca caminho). */
export const PADRAO_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const caminhoPromptDe = (membroSlug: string): string => `membros/${membroSlug}.md`;
export const agentIdDe = (squadSlug: string, membroSlug: string): string => `${squadSlug}.${membroSlug}`;

// ---- modelo ----
/** P-233: soft (avisa e oferece continuar/encerrar) ou rígido (aborta). Padrão soft (D-210). */
export type ModoOrcamento = "soft" | "rigido";
export interface OrcamentoSquad {
  tempo_min: number | null;
  tokens: number | null;
  modo: ModoOrcamento;
}
export interface PerfilMembro {
  cli: string;
  modelo: string | null;
  esforco: string | null;
  faixa: Faixa;
}
export interface Membro {
  slug: string;
  papel: PapelSquad;
  /** rótulo livre 1..40 (nome exibido); o `papel` é o contrato. */
  rotulo: string;
  descricao: string;
  /** caminho RELATIVO ao `squad.json`: sempre `membros/<slug>.md`. O texto do prompt nunca está aqui. */
  prompt: string;
  perfil: PerfilMembro;
  skills_permitidas: string[];
  mcps_permitidos: string[];
  hooks: string[];
  max_instancias: number;
  orcamento: OrcamentoSquad;
  rigidez: NivelRigidez | null;
  permissao: PermissaoMembro | null;
}
export interface FabricaRef {
  id: string;
  versao: number;
}
export interface Squad {
  slug: string;
  nome: string;
  descricao: string;
  escopo: EscopoSquad;
  rigidez_padrao: NivelRigidez | null;
  max_instancias_paralelas: number;
  orcamento: OrcamentoSquad;
  /** `null` = derivar de `politicaDePortoes`; senão o subconjunto a deixar PENDENTE. */
  portoes: PortaoMissao[] | null;
  fabrica: FabricaRef | null;
  origem: OrigemSquad;
  membros: Membro[];
}

/** Proveniência de uma cópia de fábrica (`origem.json`): sha256 do ORIGINAL por arquivo, para a comparação em 3 vias (D-206). */
export interface ProvenienciaFabrica {
  fabrica_id: string;
  versao: number;
  /** caminho relativo (`squad.json`, `membros/x.md`) → sha256 do original. Nunca caminho absoluto. */
  arquivos: Record<string, string>;
}
export type EstadoMembroFabrica = "igual" | "atualizavel" | "editado" | "novo" | "removido";

export interface SquadResumo {
  slug: string;
  nome: string;
  escopo: EscopoSquad;
  origem: OrigemSquad;
  membros: number;
  clis: string[];
  valida: boolean;
  atualizacao_de_fabrica: boolean;
  em_uso: boolean;
  hash: string;
}

// ---- achados de validação (T-14.04) ----
export type SeveridadeAchado = "erro" | "aviso";
export const CODIGOS_ACHADO = [
  "sem_orquestrador",
  "orquestrador_duplicado",
  "sem_revisor",
  "poucos_membros",
  "muitos_membros",
  "slug_invalido",
  "slug_duplicado",
  "cli_desconhecida",
  "cli_sem_intake",
  "cli_nao_instalada",
  "modelo_invalido",
  "esforco_invalido",
  "esforco_indicativo",
  "faixa_invalida",
  "variavel_desconhecida",
  "prompt_grande",
  "prompt_com_segredo",
  "skill_desconhecida",
  "mcp_desconhecido",
  "limite_invalido",
  "revisor_igual_ao_executor",
  "fabrica_somente_leitura",
  "membro_sem_prompt",
  "permissao_acima_do_workspace",
] as const;
export type CodigoAchado = (typeof CODIGOS_ACHADO)[number];
export interface Achado {
  severidade: SeveridadeAchado;
  codigo: CodigoAchado;
  /** campo afetado, ex.: `membros[2].perfil.cli`. */
  caminho: string;
  mensagem: string;
}

// ---- gravação ----
export type ErroGravarSquad = "fabrica_somente_leitura" | "conflito_de_hash" | "invalida";
export interface PedidoGravarSquad {
  squad: Squad;
  /** hash lido antes de editar; `null` = squad nova. Evita sobrescrever edição externa concorrente (CT-14.10). */
  hash_esperado: string | null;
}
export type ResultadoGravarSquad = { ok: true; squad: Squad; hash: string; achados: Achado[] } | { ok: false; erro: ErroGravarSquad; achados: Achado[] };

export interface PedidoListarSquads {
  busca?: string;
  origem?: OrigemSquad;
}
export interface PedidoDuplicarSquad {
  slug: string;
  novo_slug?: string;
  novo_nome?: string;
}
export interface PedidoApagarSquad {
  slug: string;
  /** precisa ser igual ao `slug` (confirmação digitada na UI). */
  confirmar_slug: string;
}
export interface FabricaAtualizacao {
  versao_nova: number | null;
  membros: Array<{ membro: string; estado: EstadoMembroFabrica }>;
}
export interface PedidoFabricaAplicar {
  slug: string;
  membros: string[];
  /**
   * Membros `editado` que o usuário aceitou sobrescrever depois de ver o diff lado a lado (subconjunto de `membros`). Sem isto
   * o `editado` nunca é tocado; `removido` continua intocável. Aditivo (Fase 14, onda 6).
   */
  sobrescrever_editados?: string[];
}
/** Lado a lado de UM membro entre a cópia do usuário e a fábrica nova (prompt + configuração); vazio = não existe naquele lado. */
export interface PedidoFabricaDiff {
  slug: string;
  /** slug do membro ou `@squad` (campos da squad). */
  membro: string;
}
export interface FabricaDiff {
  membro: string;
  estado: EstadoMembroFabrica;
  atual: string;
  fabrica: string;
}

// ---- lixeira (apagar nunca remove de verdade) ----
export interface ItemLixeiraSquad {
  /** nome da pasta na lixeira (`<slug>-<AAAAMMDDHHMMSS>-<hex>`); é o identificador para restaurar. */
  nome: string;
  slug: string;
  /** ISO aproximado extraído do nome; `null` se ilegível. */
  apagada_em: string | null;
}
export interface PedidoRestaurarLixeira {
  nome: string;
}

// ---- execução (caixa de prompt) ----
export interface PedidoPreflight {
  slug: string;
  workspace_id: string;
}
export interface SubstituicaoCli {
  membro: string;
  de: string;
  para: string;
}
export interface ResultadoPreflight {
  ok: boolean;
  avisos: string[];
  substituicoes: SubstituicaoCli[];
}
export interface PedidoEnviarPrompt {
  workspace_id: string;
  squad_slug: string;
  /** ≤ 4 000; texto do usuário (redigido antes de gravar). */
  objetivo: string;
  /** `null` = padrão (config `squads.plano_antes_padrao`, D-209). */
  plano_antes: boolean | null;
  rigidez: NivelRigidez | null;
  /** `null` = o da squad; limitado pelo global (`max_parallel_panes`). */
  max_paralelos: number | null;
}
export interface ResultadoEnviarPrompt {
  execucao_id: string;
  mission_id: string;
  pane_id: string;
  avisos: string[];
}
/** Arquivos que o orquestrador grava na pasta da Missão e a UI lê (somente leitura, sempre texto). */
export const ARQUIVOS_EXECUCAO = ["plano", "resultado"] as const;
export type ArquivoExecucao = (typeof ARQUIVOS_EXECUCAO)[number];
export interface PedidoArquivoExecucao {
  execucao_id: string;
  arquivo: ArquivoExecucao;
}
export interface ResultadoArquivoExecucao {
  existe: boolean;
  /** conteúdo (≤ 256 KiB, sem controles, segredos redigidos); `null` quando não existe. Nunca vira HTML na UI. */
  texto: string | null;
  truncado: boolean;
}
export const LIMITE_ARQUIVO_EXECUCAO_BYTES = 256 * 1024;

/** Estado de uma execução, derivado do estado da Missão e dos portões (não é coluna do banco). */
export const ESTADOS_EXECUCAO_SQUAD = ["intake", "plano", "executando", "revisando", "concluida", "falhou", "abortada"] as const;
export type EstadoExecucaoSquad = (typeof ESTADOS_EXECUCAO_SQUAD)[number];
export interface SquadExecucao {
  id: string;
  squad_slug: string;
  squad_hash: string;
  workspace_id: string;
  mission_id: string | null;
  objetivo: string;
  plano_antes: boolean;
  nivel_rigidez: NivelRigidez | null;
  criado_em: string;
  estado: EstadoExecucaoSquad;
}
export interface PedidoListarExecucoes {
  workspace_id: string;
  cursor?: string;
  limite: number;
}
export interface PaginaExecucoes {
  itens: SquadExecucao[];
  proximo: string | null;
}
/** Estado da Missão → estado exibido: plano pendente (portão `build` fechado) vale "plano"; o resto espelha a Missão. */
export function estadoDaExecucao(missao: EstadoMissao | null, planoPendente: boolean): EstadoExecucaoSquad {
  if (missao === null) return "intake";
  if (planoPendente && (missao === "intake" || missao === "planejando")) return "plano";
  return missao === "planejando" ? "plano" : missao;
}

// ---- portabilidade ----
export type DestinoExportar = "repo" | "arquivo";
export interface PedidoExportarSquad {
  slug: string;
  destino: DestinoExportar;
  workspace_id?: string;
}
export interface ResultadoExportarSquad {
  /** relativo à raiz do workspace (`repo`) ou `null` (arquivo escolhido pelo seletor nativo do main). Nunca absoluto. */
  caminho_relativo: string | null;
}
export interface PedidoImportarPrevia {
  origem: DestinoExportar;
  workspace_id?: string;
  /** slug da pasta de squads exportada no repositório quando `origem = "repo"`. */
  nome?: string;
}
export interface PreviaImportacao {
  previa_id: string;
  squad: Squad;
  achados: Achado[];
  mcps_removidos: string[];
  skills_removidas: string[];
  /** membro (slug) → texto COMPLETO do prompt, já validado (≤ 16 KiB, sem segredo): a UI o mostra antes de confirmar. */
  prompts: Record<string, string>;
}
export interface PedidoImportarConfirmar {
  previa_id: string;
  slug?: string;
}
export type TipoEventoSquad = "gravada" | "apagada" | "externa";
export interface EventoSquad {
  slug: string;
  tipo: TipoEventoSquad;
}

// ---- agentes (membros) ----
export interface AgenteResumo {
  agent_id: string;
  squad: string;
  rotulo: string;
  papel: PapelSquad;
  perfil: PerfilMembro;
  /** invocações abertas agora (`invocacao_agente.encerrada_em IS NULL`). */
  vivos: number;
}
export interface PromptLido {
  texto: string;
  hash: string;
  /** difere do original de fábrica. */
  editado: boolean;
}
export interface PedidoGravarPrompt {
  agent_id: string;
  texto: string;
  hash_esperado: string;
}
export type ResultadoGravarPrompt = { ok: true; hash: string; achados: Achado[] } | { ok: false; erro: "conflito_de_hash" | "invalida" | "fabrica_somente_leitura"; achados: Achado[] };
export interface ExemploPrompt {
  objetivo: string;
  arquivos: string[];
}
export interface PedidoPreviaPrompt {
  agent_id: string | null;
  texto?: string;
  exemplo?: ExemploPrompt;
}
export interface ResultadoPreviaPrompt {
  renderizado: string;
  variaveis_usadas: string[];
  achados: Achado[];
}
export interface ModeloOpcao {
  modelo: string;
  padrao?: boolean;
}
export interface OpcoesPerfilCli {
  modelos: ModeloOpcao[];
  niveis_esforco: string[];
  esforco_modo: ModoEsforco;
  instalada: boolean;
}
export interface PedidoAbrirAgente {
  workspace_id: string;
  agent_id: string;
  objetivo?: string;
}

// ---- pontes para as Fases 9, 15 e 16 (portas; implementação direta nas ondas seguintes) ----
export interface PerfilEfetivoMembro {
  cli: string;
  modelo: string | null;
  esforco: string | null;
  esforco_modo: ModoEsforco;
  conta_id: string | null;
  faixa: Faixa;
  recibo: string | null;
  avisos: string[];
}
