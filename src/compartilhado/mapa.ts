// Contratos da Fase 17 (mapa lógico do código) compartilhados entre núcleo, main, preload e renderer. Tipos puros + constantes.
// O renderer NUNCA envia caminho absoluto nem `cwd`: todo pedido leva `workspace_id` e o main resolve a raiz. Caminhos que
// aparecem aqui são SEMPRE relativos à raiz do workspace, com `/`. O mapa guarda nomes e posições, nunca o código-fonte.

export type EstadoMapaIpc = "vazio" | "parcial" | "pronto";
export type EstadoHistoriaIpc = "ok" | "parcial" | "indisponivel";
export type TipoNoIpc = "arquivo" | "modulo" | "simbolo" | "entrada" | "tabela" | "externo";
export type TipoArestaIpc = "importa" | "reexporta" | "chama" | "instancia" | "herda" | "implementa" | "referencia" | "aciona" | "le_tabela" | "escreve_tabela" | "testa";
export type ConfiancaIpc = "exata" | "heuristica";
export type FaixaRaioIpc = "BAIXO" | "MEDIO" | "ALTO";

export const NIVEIS_GRAFO = ["modulo", "arquivo", "simbolo"] as const;
export type NivelGrafo = (typeof NIVEIS_GRAFO)[number];
export const DIRECOES_VIZINHOS = ["saida", "entrada", "ambas"] as const;
export type DirecaoVizinhosIpc = (typeof DIRECOES_VIZINHOS)[number];
export const TIPOS_ANALISE_MAPA = ["ciclos", "camadas", "hotspots", "mortos", "sem_teste", "externas", "duplicacao", "dialetos", "zonas", "entradas", "dados"] as const;
export type TipoAnaliseMapa = (typeof TIPOS_ANALISE_MAPA)[number];
export const FORMATOS_EXPORTACAO_MAPA = ["mermaid", "dot", "svg", "json", "csv", "md"] as const;
export type FormatoExportacaoMapa = (typeof FORMATOS_EXPORTACAO_MAPA)[number];
export const ACOES_DISPARO_MAPA = ["stackx_detectar", "stackx_atualizar", "legadox_perfil", "legadox_raio", "legadox_divida"] as const;
export type AcaoDisparoMapa = (typeof ACOES_DISPARO_MAPA)[number];
export const FASES_PROGRESSO_MAPA = ["varrendo", "extraindo", "resolvendo", "historia", "analises"] as const;
export type FaseProgressoMapa = (typeof FASES_PROGRESSO_MAPA)[number];

/** Limites duros das respostas (a UI e o MCP dependem deles). */
export const LIMITE_GRAFO_MAX = 20_000;
export const LIMITE_VIZINHOS_MAX = 500;
export const LIMITE_BUSCA_MAX = 50;
export const LIMITE_RAIO_ARQUIVOS = 50;
export const CONFIRMACAO_APAGAR_MAPA = "APAGAR";

export interface ConfigMapa {
  habilitado: boolean;
  /** Atualiza o mapa em ocioso quando o VCS avisa de mudança (opt-in; padrão false: scan só por ação do usuário). */
  auto_atualizar: boolean;
  arquivo_max_bytes: number;
  total_max: number;
  /** 0 = automático (1 em segundo plano, até 3 em "Analisar agora"). */
  workers: number;
  historia_janela_dias: number;
  historia_max_commits: number;
  duplicacao: boolean;
  /** Globs extras a ignorar (relativos à raiz). */
  ignorar: string[];
  /** Opt-in: agentes (tools MCP `map_*`) podem consultar o mapa. Nomes, caminhos e linhas; nunca código. Padrão false. */
  expor_agentes: boolean;
}

export const CONFIG_MAPA_PADRAO: Readonly<ConfigMapa> = Object.freeze({
  habilitado: true,
  auto_atualizar: false,
  arquivo_max_bytes: 1_000_000,
  total_max: 150_000,
  workers: 0,
  historia_janela_dias: 730,
  historia_max_commits: 20_000,
  duplicacao: false,
  ignorar: [],
  expor_agentes: false,
});

export interface ProgressoMapaIpc {
  execucao_id: number;
  fase: FaseProgressoMapa;
  feito: number;
  total: number;
}

export interface ResumoMapaIpc {
  estado: EstadoMapaIpc;
  versao_mapa: number;
  analisado_em: string | null;
  arquivos: number;
  nos: number;
  linguagens: Array<{ linguagem: string; arquivos: number; loc: number }>;
  arestas: { exata: number; heuristica: number };
  historia: EstadoHistoriaIpc;
  ferramentas: { ctags: boolean; scc: boolean; dot: boolean };
  /** Arquivos mudaram desde a última análise (avisado pelo VCS); `null` = desconhecido (nunca verificado). */
  desatualizado: boolean | null;
  alterados_n: number;
  /** Arquivos em linguagem sem gramática (modo degradado). */
  degradadas: number;
  analisando: boolean;
  progresso: ProgressoMapaIpc | null;
  configuracao: ConfigMapa;
  /** Aviso de abertura do armazém (ex.: banco recriado) ou da última análise (ex.: truncado). */
  aviso: string | null;
  /** Último pacote de contexto gravado em `<pasta do produto>/mapa/<carimbo>/`. */
  pacote: { carimbo: string | null; caminho: string | null };
  /** Estimativa de arquivos a analisar antes da 1ª análise (só contagem leve), quando conhecida. */
  estimativa_arquivos: number | null;
}

// ---- grafo -----------------------------------------------------------------------------------

export interface NoGrafoMapa {
  id: string;
  /** Rótulo curto (nome do arquivo/símbolo/módulo). */
  r: string;
  t: TipoNoIpc;
  /** Grupo para agrupamento visual: módulo (pasta) do nó. */
  g: string;
  /** Peso para o tamanho do nó (LOC, ou nº de filhos no nível de módulo). */
  w: number;
  /** Linguagem (arquivos). */
  l?: string;
  /** id do ciclo (SCC) quando participa de um. */
  c?: number;
  /** Camada inferida (0 = base). */
  k?: number;
  /** PageRank normalizado 0..1. */
  p?: number;
}

/** `[índice_de, índice_para, tipo, exata(1)|heurística(0), peso]`: índices em `nos`. */
export type ArestaGrafoMapa = [number, number, TipoArestaIpc, 0 | 1, number];

export interface FiltroGrafoMapa {
  linguagens?: string[];
  /** Prefixo de pasta (relativo). */
  pasta?: string;
  tipos_aresta?: TipoArestaIpc[];
  min_confianca?: ConfiancaIpc;
  so_ciclos?: boolean;
  camada?: number;
}

export interface GrafoMapaIpc {
  nivel: NivelGrafo;
  nos: NoGrafoMapa[];
  arestas: ArestaGrafoMapa[];
  truncado: boolean;
  total_nos: number;
  total_arestas: number;
  versao_mapa: number;
}

export interface NoDetalheMapa {
  id: string;
  tipo: TipoNoIpc;
  subtipo: string | null;
  rotulo: string;
  caminho: string | null;
  linha_ini: number | null;
  linha_fim: number | null;
  exportado: boolean | null;
  /** Atributos sanitizados (assinatura sem literais, 1ª linha de doc redigida, complexidade). Nunca código-fonte. */
  atributos: Record<string, unknown> | null;
  arquivo: {
    linguagem: string;
    loc: number | null;
    loc_codigo: number | null;
    complexidade_max: number | null;
    complexidade_total: number | null;
    e_teste: boolean;
    e_gerado: boolean;
    degradado: boolean;
    modulo: string;
    camada: number | null;
    ciclo_id: number | null;
    pagerank: number | null;
    churn_total: number | null;
    churn_janela: number | null;
    autores_n: number | null;
    criado_git: string | null;
    ultima_alt: string | null;
    commits_correcao: number | null;
    cobertura_estado: string | null;
  } | null;
  chamadores: VizinhoMapa[];
  chamados: VizinhoMapa[];
  chamadores_total: number;
  chamados_total: number;
}

export interface VizinhoMapa {
  id: string;
  rotulo: string;
  tipo: TipoNoIpc;
  aresta: TipoArestaIpc;
  confianca: ConfiancaIpc;
  peso: number;
  /** Evidência `arquivo:linha`. */
  evidencia: string | null;
}

export interface VizinhosMapaIpc {
  origem: string;
  nos: NoGrafoMapa[];
  arestas: ArestaGrafoMapa[];
  truncado: boolean;
}

export interface NoFluxoMapa {
  id: string;
  rotulo: string;
  tipo: TipoNoIpc;
  nivel: number;
  tracejado: boolean;
  externo: boolean;
  em_ciclo: boolean;
  tabelas: string[];
  caminho: string | null;
  linha: number | null;
}

export interface FluxoMapaIpc {
  raiz: string;
  nos: NoFluxoMapa[];
  /** `[de, para, tipo, exata(1)|heurística(0), retorno(1)|0]`: ids. */
  arestas: Array<[string, string, TipoArestaIpc, 0 | 1, 0 | 1]>;
  tabelas: string[];
  externos: string[];
  truncado: boolean;
}

export interface ResultadoBuscaMapa {
  id: string;
  rotulo: string;
  tipo: TipoNoIpc;
  subtipo: string | null;
  caminho: string | null;
  linha: number | null;
}

// ---- análises --------------------------------------------------------------------------------

export interface CicloMapa {
  id: number;
  tamanho: number;
  /** Ids de nós (arquivos), no máximo 100. */
  nos: string[];
  quebrar: Array<{ de: string; para: string; peso: number }>;
}

export interface ModuloCamadaMapa {
  modulo: string;
  camada: number;
  camada_manual: string | null;
  ca: number;
  ce: number;
  instabilidade: number;
  ciclo_id: number | null;
  arquivos: number;
}

export interface ViolacaoMapa {
  origem: "inferida" | "manual" | "regra";
  de_modulo: string;
  para_modulo: string;
  evidencias: string[];
  motivo: string;
}

export interface HotspotMapa {
  caminho: string;
  score: number;
  faixa: "quente" | "morno" | "frio";
  churn_janela: number;
  complexidade_max: number;
  autores_n: number | null;
  idade_dias: number | null;
  commits_correcao: number | null;
  parceiros: Array<{ caminho: string; co_alteracoes: number; grau: number }>;
}

export interface CandidatoMortoMapa {
  id: string;
  tipo: "arquivo" | "simbolo";
  caminho: string;
  linha: number | null;
  confianca: "alta" | "media" | "baixa";
  motivos: string[];
}

export interface EntradaMapa {
  id: string;
  subtipo: string;
  chave: string;
  framework: string;
  caminho: string;
  linha: number;
  confianca: ConfiancaIpc;
}

export interface TabelaMapa {
  nome: string;
  definida_em: string[];
  le_n: number;
  escreve_n: number;
  toques: Array<{ de: string; operacao: "le" | "escreve"; confianca: ConfiancaIpc; evidencia: string | null }>;
}

export interface DadosAnaliseMapa {
  ciclos: { ciclos: CicloMapa[]; total: number };
  camadas: {
    modulos: ModuloCamadaMapa[];
    ciclos: Array<{ id: number; modulos: string[]; quebrar: Array<{ de: string; para: string; peso: number }> }>;
    violacoes: ViolacaoMapa[];
    dsm: { modulos: string[]; celulas: number[][]; truncado: boolean };
    regras_importadas: number;
  };
  hotspots: { disponivel: boolean; itens: HotspotMapa[] };
  mortos: { itens: CandidatoMortoMapa[]; rotulo: string };
  sem_teste: {
    itens: Array<{ caminho: string; estado: "existente" | "parcial" | "ausente"; fonte: "estimada" | "medida" }>;
    por_pasta: Array<{ pasta: string; total: number; sem_teste: number }>;
  };
  externas: {
    itens: Array<{ id: string; ecossistema: string; nome: string; versao: string | null; declarado: boolean; usado: boolean; dev: boolean; licenca: string | null; selo: string | null }>;
    aviso: string;
  };
  duplicacao: { habilitada: boolean; clones: Array<{ tokens: number; trechos: Array<{ caminho: string; linha_ini: number; linha_fim: number }> }> };
  dialetos: { eixos: Array<{ eixo: string; forca: string; destino: string; variantes: Array<{ nome: string; n: number; recente: boolean }> }> };
  zonas: { zonas: Array<{ categoria: string; pastas: string[]; arquivos: string[]; tabelas: string[]; quem_valida: string }> };
  entradas: { itens: EntradaMapa[]; por_categoria: Record<string, number> };
  dados: { tabelas: TabelaMapa[] };
}

export interface ResultadoAnaliseMapa<T extends TipoAnaliseMapa = TipoAnaliseMapa> {
  tipo: T;
  versao_mapa: number;
  truncado: boolean;
  dados: DadosAnaliseMapa[T];
}

export interface ParametrosAnaliseMapa {
  limite?: number;
  /** Prefixo de pasta para filtrar a lista. */
  pasta?: string;
  /** Para `dados`: nome de uma tabela específica. */
  tabela?: string;
}

// ---- raio e perfil ---------------------------------------------------------------------------

export interface SinalRaioMapa {
  id: number;
  nome: string;
  min: number | null;
  max: number | null;
  valor: string;
  metodo: string;
  pior_caso: boolean;
}

export interface RaioMapaIpc {
  arquivos: string[];
  sinais: SinalRaioMapa[];
  faixa: FaixaRaioIpc;
  faixa_pior_caso: FaixaRaioIpc;
  pior_caso: Array<{ sinal: number; motivo: string }>;
  candidatos_costura: string[];
  nota: string;
  chamadores: string[];
  alcance_transitivo: number;
}

export interface PerfilProvisorioMapa {
  /** Sempre presente: este perfil NÃO é o `PERFIL.md` (quem escreve é `/expx:legadox-perfil`). */
  nota: string;
  gerado_em: string;
  stack: { ecossistemas: string[]; manifestos: string[]; linguagens: Array<{ linguagem: string; arquivos: number; loc: number }> };
  entradas_por_categoria: Record<string, number>;
  camadas: { modulos: number; violacoes: number; ciclos: number };
  comandos: Array<{ nome: string; comando: string; fonte: string; linha: number | null }>;
  cobertura: { metodo: string; sem_teste: number; total: number };
  dialetos_conflitantes: Array<{ eixo: string; forca: string }>;
  zonas_candidatas: Array<{ categoria: string; pastas: string[]; quem_valida: string }>;
  divida: { ciclos: number; candidatos_mortos: number; hotspots_quentes: number };
}

// ---- exportação e disparo --------------------------------------------------------------------

export type VistaExportacaoMapa =
  | { tipo: "grafo"; nivel: NivelGrafo; filtro?: FiltroGrafoMapa }
  | { tipo: "fluxo"; entrada_id: string; profundidade?: number }
  | { tipo: "relatorio" };

/** O renderer nunca envia caminho: `padrao` = `<userData>/mapas/<ws>/exportacoes/`; `escolher` = diálogo nativo do main. */
export type DestinoExportacaoMapa = "padrao" | "escolher";

export interface ResultadoExportacaoMapa {
  /** Caminho do arquivo gravado (absoluto: o diálogo é do main; o renderer só exibe). */
  caminho: string;
  formato: FormatoExportacaoMapa;
  bytes: number;
}

export interface ResultadoDisparoMapa {
  /** Texto digitado no Pane (uma linha, ≤ 1 500 caracteres de argumento). */
  comando: string;
  carimbo: string;
  /** Caminho RELATIVO do pacote de contexto. */
  pacote: string;
}

export interface PedidoDisparoMapa {
  acao: AcaoDisparoMapa;
  pane_id: string;
  trabalho_id?: string;
  arquivos?: string[];
}

export interface EventoMapaIpc {
  tipo: "progresso" | "mudou" | "terminou" | "falhou";
  workspace_id: string;
  progresso?: ProgressoMapaIpc;
  versao_mapa?: number;
  nos_alterados_n?: number;
  erro?: string;
}

export interface ApiMapa {
  resumo(workspaceId: string): Promise<ResumoMapaIpc>;
  analisar(workspaceId: string, modo: "completo" | "incremental", historia?: boolean): Promise<{ execucao_id: number }>;
  cancelar(workspaceId: string): Promise<{ ok: true }>;
  apagar(workspaceId: string, confirmacao: string): Promise<{ ok: true }>;
  grafo(workspaceId: string, nivel: NivelGrafo, filtro?: FiltroGrafoMapa, limite?: number): Promise<GrafoMapaIpc>;
  vizinhos(workspaceId: string, noId: string, direcao?: DirecaoVizinhosIpc, profundidade?: number, limite?: number): Promise<VizinhosMapaIpc>;
  no(workspaceId: string, noId: string): Promise<NoDetalheMapa | null>;
  fluxo(workspaceId: string, entradaId: string, profundidade?: number, minConfianca?: ConfiancaIpc): Promise<FluxoMapaIpc>;
  analise<T extends TipoAnaliseMapa>(workspaceId: string, tipo: T, parametros?: ParametrosAnaliseMapa): Promise<ResultadoAnaliseMapa<T>>;
  raio(workspaceId: string, arquivos: string[], simbolos?: string[]): Promise<RaioMapaIpc>;
  perfil(workspaceId: string): Promise<PerfilProvisorioMapa>;
  buscar(workspaceId: string, texto: string, tipos?: TipoNoIpc[], limite?: number): Promise<ResultadoBuscaMapa[]>;
  exportar(workspaceId: string, formato: FormatoExportacaoMapa, vista: VistaExportacaoMapa, destino?: DestinoExportacaoMapa): Promise<ResultadoExportacaoMapa>;
  disparar(workspaceId: string, pedido: PedidoDisparoMapa): Promise<ResultadoDisparoMapa>;
  configLer(workspaceId: string): Promise<ConfigMapa>;
  configGravar(workspaceId: string, parcial: Partial<ConfigMapa>): Promise<ConfigMapa>;
  layoutLer(workspaceId: string, chave: string): Promise<{ nivel: string; posicoes: number[] } | null>;
  layoutGravar(workspaceId: string, chave: string, nivel: string, posicoes: number[]): Promise<{ ok: true }>;
  assinar(cb: (e: EventoMapaIpc) => void): () => void;
}
