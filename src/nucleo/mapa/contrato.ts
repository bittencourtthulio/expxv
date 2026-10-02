import type { Aresta, Confianca, Linguagem, No, RaioProvisorio, TipoAresta, TipoNo } from "./tipos";

/*
 * CONTRATOS DO MAPA (Fase 17, §8 do plano) — para o coordenador copiar em `05-CONTRATOS.md`.
 *
 * §1b Armazém: `<userData>/mapas/<workspace_id>/mapa.db` (SQLite WAL; `PRAGMA user_version` = SCHEMA_VERSION = 1;
 *   DDL em `esquema.ts`). Cache reconstruível: versão maior ou banco corrompido => renomeia para
 *   `mapa.db.corrompido-<carimbo>` e recomeça. Guarda nomes, assinaturas sanitizadas, `arquivo:linha` e a
 *   1ª linha de comentário redigida (<= 160). Nunca o código-fonte (D-163, P-277). `docs/**` nunca é escrito (D-04).
 *
 * IPC `mapa:*` (lista fechada em src/compartilhado/ipc.ts; validador estrito por canal; o renderer NUNCA envia caminho
 *   absoluto nem cwd):
 *   mapa:resumo {workspace_id} -> {estado, versao_mapa, analisado_em, arquivos, linguagens[{linguagem,arquivos,loc}],
 *                                  arestas{exata,heuristica}, historia, ferramentas{ctags,scc,dot}, desatualizado, configuracao}
 *   mapa:analisar {workspace_id, modo:"completo"|"incremental", historia?} -> {execucao_id}
 *   mapa:cancelar {workspace_id} -> {ok}
 *   mapa:apagar {workspace_id, confirmacao:"APAGAR"} -> {ok}
 *   mapa:grafo {workspace_id, nivel:"modulo"|"arquivo"|"simbolo", filtro, limite<=20000} -> {nos[], arestas[], truncado}
 *   mapa:vizinhos {workspace_id, no_id, direcao, profundidade<=3, limite<=500}
 *   mapa:no {workspace_id, no_id} -> detalhe
 *   mapa:fluxo {workspace_id, entrada_id, profundidade<=10, min_confianca} -> {nos[], arestas[], truncado}
 *   mapa:analise {workspace_id, tipo, parametros?}
 *   mapa:raio {workspace_id, arquivos[<=50], simbolos?[]} -> RaioProvisorio
 *   mapa:buscar {workspace_id, texto, tipos?, limite<=50}
 *   mapa:exportar {workspace_id, formato, vista, destino?:null} -> {caminho}   (recusa <raiz>/docs/**)
 *   mapa:disparar {workspace_id, acao, pane_id, trabalho_id?, arquivos?[]} -> {comando, carimbo}
 *   mapa:config_ler / mapa:config_gravar (chaves `mapa.*`); mapa:layout_ler / mapa:layout_gravar
 *   evento mapa:progresso {execucao_id, fase:"varrendo"|"extraindo"|"resolvendo"|"historia"|"analises", feito, total}
 *   evento mapa:mudou {versao_mapa, nos_alterados_n}
 * Eventos de domínio: map.analysis_started|progress|finished|failed, map.updated.
 *
 * Tools MCP (somente leitura; resposta <= 32 KB com truncated:true): map_status, map_query, map_impact, map_evidence;
 *   erro `unavailable/map_not_ready`.
 *
 * Config: mapa.habilitado, mapa.auto_atualizar, mapa.arquivo_max_bytes (1 000 000), mapa.total_max (150 000; configurável,
 *   inclusive sem limite — P-274), mapa.workers, mapa.historia.janela_dias, mapa.historia.max_commits, mapa.duplicacao,
 *   mapa.ignorar, mapa.camadas_manual.
 */

export type EstadoMapa = "vazio" | "parcial" | "pronto";
export type EstadoHistoria = "ok" | "parcial" | "indisponivel";

export interface ResumoMapa {
  estado: EstadoMapa;
  versao_mapa: number;
  analisado_em: string | null;
  arquivos: number;
  linguagens: Array<{ linguagem: Linguagem; arquivos: number; loc: number }>;
  arestas: { exata: number; heuristica: number };
  historia: EstadoHistoria;
  desatualizado: boolean;
}

export type FaseProgresso = "varrendo" | "extraindo" | "resolvendo" | "historia" | "analises";

export interface ProgressoMapa {
  execucao_id: number;
  fase: FaseProgresso;
  feito: number;
  total: number;
}

export type DirecaoVizinhos = "saida" | "entrada" | "ambas";

export interface OpcoesVizinhos {
  direcao?: DirecaoVizinhos;
  tipos?: readonly TipoAresta[];
  min_confianca?: Confianca;
  limite?: number;
}

export interface Vizinho {
  aresta: Aresta;
  no: No;
}

export interface OpcoesBusca {
  tipos?: readonly TipoNo[];
  limite?: number;
  /** Também busca por trecho do nome/id (varredura, mais lenta). Sem isto só cai nela se o prefixo não achar nada. */
  trecho?: boolean;
}

export interface OpcoesAnalise {
  modo: "completo" | "incremental";
  /** Arquivos (relativos à raiz) a re-extrair no modo incremental. */
  arquivos?: readonly string[];
  historia?: boolean;
  signal?: AbortSignal;
}

/** A parte SOMENTE LEITURA que o MCP (Fase 17) e o grafo de conhecimento (Fase 15) consomem. */
export interface MapaLeitura {
  resumo(): ResumoMapa;
  no(id: string): No | undefined;
  vizinhos(id: string, opcoes?: OpcoesVizinhos): Vizinho[];
  buscar(texto: string, opcoes?: OpcoesBusca): No[];
}

export interface ServicoMapa extends MapaLeitura {
  estado(): EstadoMapa;
  analisar(opcoes: OpcoesAnalise): Promise<{ execucao_id: number }>;
  cancelar(): Promise<void>;
  raio(arquivos: readonly string[], simbolos?: readonly string[]): RaioProvisorio;
  exportar(formato: "mermaid" | "dot" | "svg" | "json" | "csv" | "md", vista: string, destino?: string | null): Promise<{ caminho: string }>;
  /** `mapa:apagar`: apaga mapa.db e o pacote de contexto. Exige a confirmação digitada. */
  apagar(confirmacao: string): Promise<void>;
  encerrar(): Promise<void>;
}
