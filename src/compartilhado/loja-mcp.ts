// Contratos da Loja de MCPs (Fase 7B) entre main e renderer. Tipos PUROS (sem imports de runtime e sem `nucleo/loja-mcp`, que
// puxa módulos do Node): o main devolve os objetos do núcleo, que são estruturalmente iguais a estes.
// Regras que valem para todo canal `loja_mcp:*`: o valor de uma variável secreta atravessa UMA vez (`variavel_gravar`) e nunca
// volta; o renderer nunca envia caminho, comando nem URL (só ids do catálogo, ids de workspace e os hashes que consentiu).

export type CategoriaMcpDto =
  | "codigo_repositorios" | "documentacao_conhecimento" | "web_pesquisa" | "navegador_testes" | "bancos_dados" | "nuvem_infra"
  | "observabilidade_qualidade" | "gestao_comunicacao" | "raciocinio_memoria" | "execucao_sandbox" | "pagamentos_apis";
export type ClassificacaoMcpDto = "pre_instalado_habilitado" | "pre_configurado" | "opcional" | "descartado";
export type MetodoMcpDto = "npm" | "uvx" | "binario" | "docker" | "remoto";
export type NivelVerificacaoDto = "forte" | "padrao" | "remoto";
export type SeloGratuitoDto = "gratis" | "plano_gratis" | "pago" | "nao_confirmado";
export type EstadoInstalacaoMcp = "instalando" | "instalado" | "falhou" | "removendo";
export type AlvoHabilitacaoTipo = "workspace" | "missao" | "agente";
export type CliLojaMcp = "claude" | "codex" | "opencode" | "gemini";
export type NivelIsolamentoMcp = "duro" | "parcial" | "nenhum";

export interface SaudeMcp {
  estado: "ok" | "indisponivel" | "nao_testado";
  testado_em: string | null;
  latencia_ms: number | null;
  n_ferramentas: number | null;
  erro_codigo: string | null;
}

export interface InstaladoMcp {
  estado: EstadoInstalacaoMcp;
  versao: string;
  nivel_verificacao: NivelVerificacaoDto;
  erro_codigo: string | null;
  instalado_em: string;
  /** a entrada do catálogo mudou (versão, comando, host) depois do consentimento. */
  atualizacao_disponivel: boolean;
}

/** Cartão curto da grade (campos pequenos + estado local). */
export interface CartaoMcp {
  id: string;
  nome: string;
  descricao_pt: string;
  categoria: CategoriaMcpDto;
  classificacao: ClassificacaoMcpDto;
  mantenedor: "oficial" | "comunidade";
  mantenedor_nome: string;
  licenca_spdx: string | null;
  licenca_restritiva: boolean;
  selo_gratuito: SeloGratuitoDto;
  pede_chave: boolean;
  autenticacao: "nenhuma" | "chave_api" | "oauth" | "token";
  metodo: MetodoMcpDto;
  transporte: "stdio" | "streamable_http" | "sse";
  versao: string | null;
  riscos: string[];
  confirmado: boolean;
  instalavel: boolean;
  motivo_nao_instalavel: string | null;
  tools_principais: string[];
  /** `null` = não instalado. */
  instalado: InstaladoMcp | null;
  saude: SaudeMcp | null;
  /** faltam variáveis obrigatórias (botão `Configurar`). */
  precisa_configurar: boolean;
  no_kit: boolean;
}

export interface ListaLojaMcp {
  entradas: CartaoMcp[];
  seed_versao: string | null;
  gerado_em: string;
  /** catálogo adulterado ou ilegível: a Loja abre só em leitura. */
  somente_leitura: boolean;
  aviso: string | null;
}

export interface VariavelMcpEstado { nome: string; obrigatoria: boolean; secreta: boolean; definida: boolean }

export interface PermissoesMcpDto {
  comando_exato: string;
  versao_pinada: string | null;
  integridade: string | null;
  pasta: string | null;
  escrita_em_disco: string[];
  hosts_rede: { instalacao: string[]; execucao: string[]; execucao_livre: boolean };
  variaveis: Array<{ nome: string; obrigatoria: boolean; secreta: boolean; ajuda: string; onde_conseguir: string | null }>;
  riscos: string[];
  riscos_texto: string;
  nivel_verificacao: NivelVerificacaoDto;
  scripts_permitidos: boolean;
}

export interface PlanoInstalacaoDto {
  id: string;
  nome: string;
  versao: string | null;
  metodo: MetodoMcpDto;
  nivel_verificacao: NivelVerificacaoDto;
  passos: Array<{ id: string; rotulo: string; detalhe: string; aplicavel: boolean; requer_clique: boolean }>;
  /** o que o Pane executa; segredos só pelo nome. */
  comando_exato: string;
  /** o que o instalador executa, linha a linha (byte a byte o executado). */
  comando_instalacao: string[];
  pasta: string | null;
  permissoes: PermissoesMcpDto;
  /** a UI reenvia este hash em `instalar`: é o consentimento por versão. */
  comando_hash: string;
  avisos: Array<{ codigo: string; nivel: "info" | "atencao" | "alto"; texto: string }>;
}

export interface BloqueioPlanoDto { id: string; codigo: string; motivo: string; acao: string | null }

export interface ResultadoPlanoLoja { planos: PlanoInstalacaoDto[]; bloqueios: BloqueioPlanoDto[] }

export interface DetalheMcp extends CartaoMcp {
  permissoes: PermissoesMcpDto | null;
  /** por que não há permissões (ex.: comando inválido sem workspace). */
  permissoes_erro: string | null;
  variaveis: VariavelMcpEstado[];
  ferramentas: Array<{ nome: string; descricao: string | null }>;
  fontes: Array<{ url: string; consultado_em: string; para: string }>;
  links: { repo: string | null; docs: string | null };
  riscos_texto: string;
  observacoes: string | null;
  maturidade: { ultima_release: string | null; status: string; arquivado: boolean };
  plano_atualizacao_disponivel: boolean;
  clis: Array<{ cli: CliLojaMcp; nome_na_cli: string }>;
}

export interface ConsentimentoLoja { aceito: true; comando_hash: string }

export interface PedidoInstalarMcp {
  ids: string[];
  /** hash do plano que a pessoa viu, por id. */
  consentimento: { aceito: true; comando_hashes: Record<string, string> };
  workspace_id: string | null;
}

export interface DiffAtualizacaoMcp {
  disponivel: boolean;
  versao_de: string | null;
  versao_para: string | null;
  comando: { antes: string | null; depois: string };
  variaveis: { adicionadas: string[]; removidas: string[] };
  riscos: { adicionados: string[]; removidos: string[] };
  comando_hash: string;
}

export interface ResultadoAcaoMcp { ok: boolean; codigo: string | null; detalhe: string | null }

export interface ResultadoTesteMcp {
  estado: "ok" | "indisponivel";
  n_ferramentas: number;
  latencia_ms: number;
  erro: string | null;
  variaveis_faltando: string[];
}

export interface HabilitacaoMcp {
  id: string;
  servidor_id: string;
  alvo_tipo: AlvoHabilitacaoTipo;
  alvo_valor: string;
  habilitado: boolean;
  atualizado_em: string;
  isolamento: Record<CliLojaMcp, NivelIsolamentoMcp>;
}

export interface PreviaCliMcp { cli: CliLojaMcp; nome_na_cli: string; texto: string; avisos: string[] }
export interface ResultadoCliMcp { ok: boolean; codigo: string | null; motivo: string | null }

export interface LogMcp { em: string; nivel: "info" | "aviso" | "erro"; evento: string; detalhe: string }

export interface EstadoKitMcp {
  opt_out: boolean;
  itens: Array<{ id: string; nome: string; instalado: boolean; remoto: boolean }>;
  pendentes: string[];
}

export interface PlanoKitMcp {
  planos: PlanoInstalacaoDto[];
  bloqueios: BloqueioPlanoDto[];
  /** hash do CONJUNTO (um consentimento para os comandos listados). */
  comando_hash: string;
}

export interface DiagnosticoLojaMcp {
  npm: { ok: boolean; versao: string | null };
  node: { ok: boolean; versao: string | null };
  uv: { ok: boolean; versao: string | null };
  docker: { ok: boolean };
  cofre: { disponivel: boolean };
}

/** Evento main → renderer (`loja_mcp:evento`; progresso limitado a 10/s). Nunca carrega valor de segredo. */
export type EventoLojaMcp =
  | { tipo: "progresso"; instalacao_id: string; id: string; passo: number; rotulo: string }
  | { tipo: "estado"; id: string; estado: EstadoInstalacaoMcp | "removido" | "habilitacao"; erro_codigo: string | null }
  | { tipo: "saude"; id: string; estado: "ok" | "indisponivel"; n_ferramentas: number | null; latencia_ms: number | null };

/** Candidato do Registro Oficial (`loja_mcp:descobrir`): DADO de terceiro, nunca instalável nem curado, sem comando. */
export interface CandidatoMcpDto {
  nome: string;
  descricao: string;
  versao: string | null;
  repositorio: string | null;
  namespace_verificado: boolean;
  transportes: string[];
  curado: false;
  instalavel: false;
}

export interface ResultadoDescobertaMcp {
  candidatos: CandidatoMcpDto[];
  descartados: number;
  aviso: string | null;
}
