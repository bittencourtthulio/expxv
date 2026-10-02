// Contratos da Fase 19 (documentação e relatórios de entrega). Tipos puros compartilhados entre núcleo, main e renderer: nada de runtime além de constantes.
// O renderer NUNCA envia caminho: pacotes, arquivos e destinos são identificados por id/nome; o main resolve tudo. Desconhecido é `null` (nunca 0).

export type EstadoPacote = "gerando" | "pronto" | "falhou" | "obsoleto";
export type RevisaoPacote = "rascunho" | "aprovado";
export type ModoRedacao = "template" | "llm" | "misto";
export type PublicoArquivo = "interno" | "cliente" | "gestao" | "maquina";
export type FormatoArquivo = "html" | "md" | "csv" | "json" | "txt";
export type EstadoDado = "exato" | "minimo" | "desconhecido";
export type RedacaoModoConfig = "auto" | "llm" | "template";
export type CanalDivulgacao = "telegram";
export type VarianteDivulgacao = "curta" | "media" | "longa";
export type EstadoEnvio = "rascunho" | "aprovado" | "enviado" | "falhou" | "cancelado";
export type ModoExportacao = "pasta" | "zip";

export const LIMITES_VARIANTE: Record<VarianteDivulgacao, number> = { curta: 280, media: 600, longa: 1200 };
export const CANAIS_DIVULGACAO: readonly CanalDivulgacao[] = ["telegram"];
/** versão do texto de consentimento de envio: mudar invalida os consentimentos antigos. */
export const VERSAO_CONSENTIMENTO_ENVIO = "2026-10-01.1";

export interface EscopoRelatorio { tipo: "sprint"; sprint_id: string }

export interface FonteRef { id: string; rotulo: string; tipo: "item" | "commit" | "pr" | "metrica" | "custo" | "sprint" | "mapa"; ref: string | null }
export interface Afirmacao { id: string; texto: string; fontes: string[] }
export interface Bloco { id: string; titulo: string; publico: "tecnico" | "usuario"; afirmacoes: Afirmacao[]; origem: "template" | "llm" | "humano"; precisa_revisao: boolean }
export interface ViolacaoVerificacao { regra: "V1" | "V2" | "V5" | "V7"; bloco: string; afirmacao_id: string | null; detalhe: string }
export interface Verificacao { ok: boolean; afirmacoes_total: number; com_fonte: number; violacoes: ViolacaoVerificacao[] }

export interface FatoItem {
  item_id: string;
  titulo: string;
  trabalho_id: string | null;
  task_ref: string | null;
  epico_id: string | null;
  categoria: string | null;
  risco: string | null;
  criticidade: string | null;
  pontos: number | null;
  estado_fluxo: string;
  resultado: "concluido" | "carregado" | "devolvido" | "descartado" | null;
  duracao_h: number | null;
  retrabalho: "primeira" | "retrabalho" | "em_observacao" | "indeterminado" | null;
  commits_qtd: number;
  pr_url: string | null;
  visivel_cliente: boolean;
  resumo_cliente: string | null;
  changelog_tipo: "added" | "changed" | "deprecated" | "removed" | "fixed" | "security" | null;
}
export interface FatoCommitRel { sha7: string; mensagem: string; item_id: string; ts: string | null }
export interface FatoPr { trabalho_id: string; url: string; estado: string | null }
export interface MetricasSprint {
  pontos_planejados: number | null;
  pontos_entregues: number | null;
  itens_entregues: number;
  itens_total: number;
  first_time_right: number | null;
  ir: number | null;
  ir_max: number | null;
  velocidade_media_movel: number | null;
  cycle_p50_h: number | null;
  cycle_p85_h: number | null;
  lead_p85_h: number | null;
  defeitos_escapados: number | null;
  bloqueio_h: number | null;
  meta_atingida: boolean | null;
}
export interface FatosCusto { tokens: number | null; usd: number | null; estado: EstadoDado }
export interface FatosMapa { modulos: { nome: string; arquivos: number }[]; ciclos: number | null; pontos_quentes: string[] }
export interface FatosSprint {
  versao_schema: 1;
  sprint: { id: string; nome: string; meta: string | null; inicio: string; fim: string; versao_lancamento: string | null; fechada_em: string | null };
  itens: FatoItem[];
  commits: FatoCommitRel[];
  prs: FatoPr[];
  metricas: MetricasSprint;
  custo: FatosCusto;
  mapa: FatosMapa | null;
  /** lacunas conhecidas ("custo desconhecido", "sem mapa de código"): viram avisos no pacote. */
  avisos: string[];
  fontes: FonteRef[];
}

export interface ArquivoPacote { nome: string; formato: FormatoArquivo; publico: PublicoArquivo; sha256: string; bytes: number; revisao: "rascunho" | "aprovado" | "na" }
export interface PacoteResumo {
  id: string;
  workspace_id: string;
  sprint_id: string;
  titulo: string;
  versao: number;
  versao_lancamento: string | null;
  estado: EstadoPacote;
  etapa: string | null;
  modo_redacao: ModoRedacao;
  revisao_usuario: RevisaoPacote;
  aprovado_em: string | null;
  avisos_qtd: number;
  bytes: number;
  gerado_em: string;
  /** relativo à raiz do workspace (`<pasta do produto>/relatorios/...`). */
  pasta_ref: string;
}
export interface PacoteDetalhe extends PacoteResumo {
  arquivos: ArquivoPacote[];
  avisos: string[];
  verificacao: Verificacao | null;
  metricas: Record<string, number | boolean | null>;
  motivo_falha: string | null;
  /** blocos do relatório do usuário (texto vigente), para a revisão humana. */
  blocos_usuario: { id: string; titulo: string; texto: string; origem: Bloco["origem"]; precisa_revisao: boolean; ajustado: boolean }[];
}

export interface ConfigRelatorios {
  gerar_ao_fechar: boolean;
  redacao_modo: RedacaoModoConfig;
  /** instante do consentimento para enviar fatos (sem código, sem segredo) à CLI de IA do usuário; `null` = nunca consentiu. */
  consentimento_llm_em: string | null;
  csv_bom: boolean;
  /** consentimento de envio por canal externo (`canal` -> instante e versão do texto). */
  consentimento_canais: Partial<Record<CanalDivulgacao, { aceito_em: string; versao_texto: string }>>;
  hashtags: string[];
  cta: string | null;
}

export interface SprintCandidata { id: string; nome: string; fechada_em: string | null; versao_lancamento: string | null; pacote_atual: { id: string; versao: number; estado: EstadoPacote } | null }
export interface FiltroPacotes { sprint_id?: string; estado?: EstadoPacote }
export interface OpcoesGerarRelatorio { redacao_modo?: RedacaoModoConfig; versao_lancamento?: string | null }
export interface PreviaPacote { conteudo: string; tipo: "html" | "texto"; bytes: number; integro: boolean }
export interface ResultadoExportarRel { cancelado: boolean; destino_rotulo: string | null; arquivos: string[]; bytes: number }

export interface EnvioDivulgacao {
  id: string;
  pacote_id: string;
  workspace_id: string;
  canal: CanalDivulgacao;
  variante: VarianteDivulgacao;
  texto: string;
  estado: EstadoEnvio;
  criado_em: string;
  enviado_em: string | null;
  erro: string | null;
}
export interface EstadoCanalDivulgacao { canal: CanalDivulgacao; disponivel: boolean; consentido: boolean; motivo: string | null }

export type EventoRelatoriosIpc =
  | { tipo: "gerando"; workspace_id: string; pacote_id: string; sprint_id: string; etapa: string | null; quando: string }
  | { tipo: "pronto"; workspace_id: string; pacote_id: string; sprint_id: string; versao: number; quando: string }
  | { tipo: "falhou"; workspace_id: string; pacote_id: string | null; sprint_id: string; motivo: string; quando: string }
  | { tipo: "aprovado"; workspace_id: string; pacote_id: string; quando: string }
  | { tipo: "divulgacao_mudou"; workspace_id: string; pacote_id: string; quando: string };

/** `window.ade.relatorios`: sob demanda, nada no boot. Erros chegam como `Error` com `[codigo] texto`. */
export interface ApiRelatorios {
  configLer(workspaceId: string): Promise<ConfigRelatorios>;
  configGravar(workspaceId: string, config: Partial<Pick<ConfigRelatorios, "gerar_ao_fechar" | "redacao_modo" | "csv_bom" | "hashtags" | "cta">>): Promise<ConfigRelatorios>;
  /** só uma ação humana na UI muda o consentimento; `consentido=false` revoga. */
  consentimentoLlm(workspaceId: string, consentido: boolean): Promise<ConfigRelatorios>;
  sprints(workspaceId: string): Promise<SprintCandidata[]>;
  listar(workspaceId: string, filtros?: FiltroPacotes): Promise<PacoteResumo[]>;
  ler(workspaceId: string, pacoteId: string): Promise<PacoteDetalhe>;
  gerar(workspaceId: string, escopo: EscopoRelatorio, opcoes?: OpcoesGerarRelatorio): Promise<{ pacote_id: string; reaproveitado: boolean }>;
  regenerar(workspaceId: string, pacoteId: string): Promise<{ pacote_id: string; reaproveitado: boolean }>;
  previa(workspaceId: string, pacoteId: string, nome: string): Promise<PreviaPacote>;
  ajusteGravar(workspaceId: string, sprintId: string, blocoId: string, textoMd: string | null): Promise<{ ok: true }>;
  aprovar(workspaceId: string, pacoteId: string, aprovar: boolean): Promise<PacoteResumo>;
  /** o main abre o diálogo do SO; o renderer nunca envia nem recebe caminho. */
  exportar(workspaceId: string, pacoteId: string, nomes: string[] | "todos", modo: ModoExportacao): Promise<ResultadoExportarRel>;
  divulgacaoEstado(workspaceId: string): Promise<EstadoCanalDivulgacao[]>;
  consentimentoCanal(workspaceId: string, canal: CanalDivulgacao, consentido: boolean): Promise<EstadoCanalDivulgacao[]>;
  divulgacaoFila(workspaceId: string, pacoteId: string): Promise<EnvioDivulgacao[]>;
  divulgacaoEnfileirar(workspaceId: string, pacoteId: string, canal: CanalDivulgacao, variante: VarianteDivulgacao): Promise<EnvioDivulgacao>;
  divulgacaoAprovar(workspaceId: string, envioId: string, aprovar: boolean): Promise<EnvioDivulgacao>;
  divulgacaoEnviar(workspaceId: string, envioId: string): Promise<EnvioDivulgacao>;
  divulgacaoCancelar(workspaceId: string, envioId: string): Promise<EnvioDivulgacao>;
  assinar(cb: (e: EventoRelatoriosIpc) => void): () => void;
}
