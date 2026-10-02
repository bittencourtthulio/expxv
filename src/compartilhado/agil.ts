// Contratos da gestão ágil (Fase 18). SÓ tipos e constantes puras: sem imports de runtime, clonável por structuredClone,
// seguro para main, worker e renderer. Regras: desconhecido é `null` (nunca 0); duração em ms; datas de sprint AAAA-MM-DD;
// momentos UTC ISO. Os campos "origem" distinguem o que a IA sugeriu do que o humano decidiu (a IA nunca sobrescreve humano).

import type { Daily } from "../nucleo/agil/cerimonias/daily";
import type { Insights } from "../nucleo/agil/cerimonias/insights";
import type { Desperdicios } from "../nucleo/agil/praticas/lean";
import type { MetricaXp } from "../nucleo/agil/praticas/xp";
import type { EstadoChecklist } from "../nucleo/agil/praticas/checklists";
import type { ResultadoCriterio } from "../nucleo/agil/backlog/dod";
import type { AvisoPlanejamento } from "../nucleo/agil/sprint/planejamento";

export type OrigemAgil = "ia" | "humano";
export type MotorAgil = "heuristica" | "similaridade" | "llm" | "agente" | "manual" | "f35";
export type EstadoSugestao = "sugerida" | "aceita" | "ajustada" | "travada";
export type RiscoAgil = "baixo" | "medio" | "alto" | "critico";
export type CriticidadeAgil = "baixa" | "media" | "alta" | "critica";
export type OrigemItem = "ade" | "metodo" | "issue" | "retro" | "ocorrencia";
export type EstadoAde = "backlog" | "refinado" | "pronto" | "descartado";
export type EstadoFluxo = "backlog" | "pronto" | "em_andamento" | "concluida" | "validada" | "orfao";
export type Moscow = "must" | "should" | "could" | "wont";
export type SituacaoRetrabalho = "primeira" | "retrabalho" | "em_observacao" | "indeterminado";
export type EstadoSprint = "planejada" | "ativa" | "fechada" | "cancelada";
export type MetodoAgil = "scrum" | "xp" | "lean";
export type ModoEstimativa = "ia_sugere" | "so_heuristica" | "manual";

export const ESCALAS_PADRAO_IDS = ["fibonacci", "camisetas", "horas"] as const;
export const CATEGORIAS_PADRAO = ["feature", "bug", "refator", "infra", "doc", "spike", "teste", "divida"] as const;
export const TIPOS_TASK = ["config", "client", "dominio", "persistencia", "api", "ui", "integracao_externa", "teste", "infra", "refatoracao"] as const;
export const FATORES_RISCO = [
  "raio_alto", "zona_risco_historica", "sem_cobertura", "integracao_externa", "migracao_schema", "sensivel_dominio",
  "contrato_publico", "dependencias_muitas", "tamanho_grande", "historico_retrabalho_area", "lacuna_aberta", "sem_criterio_aceite",
] as const;
export type FatorRiscoId = (typeof FATORES_RISCO)[number];

// ---- escala e configuração ----
export interface ValorEscala { rotulo: string; valor: number }
export interface EscalaAgil { id: string; nome: string; valores: ValorEscala[] }

export interface LimiaresSaude {
  progresso_amarelo: number;
  progresso_vermelho: number;
  escopo_adicionado: number;
  ftr_queda_pontos: number;
  compromisso_vs_capacidade: number;
  risco_critico_max: number;
}

export interface CriterioConfig { codigo: string; descricao: string; auto: boolean }

export interface RegrasNatureza {
  prefixos_defeito: string[];
  prefixos_escopo: string[];
  prefixos_ruido: string[];
  palavras_defeito: string[];
  palavras_escopo: string[];
  palavras_ruido: string[];
}

export interface ConfigAgil {
  escala_id: string;
  escalas: EscalaAgil[];
  categorias: string[];
  pontos_base_tipo: Record<string, number>;
  risco_pesos: Record<string, number>;
  /** soma >= medio => medio; >= alto => alto; >= critico => critico. */
  risco_faixas: { medio: number; alto: number; critico: number };
  termos_sensiveis: string[];
  categorias_criticas: string[];
  dod: CriterioConfig[];
  dor: CriterioConfig[];
  wip: Record<string, number>;
  estimativa_modo: ModoEstimativa;
  estimativa_max_chamadas_dia: number;
  estimativa_lote: number;
  perfil_estimador: string;
  confianca_aceite_lote: number;
  janela_retrabalho_dias: number;
  /** dias da semana úteis, 0=domingo..6=sábado. */
  dias_uteis: number[];
  feriados: string[];
  limiares_saude: LimiaresSaude;
  padroes_teste: string[];
  natureza: RegrasNatureza;
  buffer_planejamento: number;
  horas_dia_padrao: number;
  fator_foco_padrao: number;
  commit_grande_linhas: number;
  fechar_automatico: boolean;
  amostra_minima: number;
}

// ---- estimativa e classificação ----
export interface FatorEstimativa { fator: string; direcao: "sobe" | "desce"; evidencia: string }
export interface FatorRisco { fator: string; peso: number; direcao: "sobe"; evidencia: string }

export interface Estimativa {
  id: string;
  item_id: string;
  versao: number;
  pontos: number | null;
  rotulo: string | null;
  escala_id: string;
  min_h: number | null;
  max_h: number | null;
  origem: OrigemAgil;
  motor: MotorAgil;
  confianca: number | null;
  fatores: FatorEstimativa[];
  estado: EstadoSugestao;
  ativa: boolean;
  nota: string | null;
  criado_em: string;
}

export interface Classificacao {
  id: string;
  item_id: string;
  versao: number;
  categoria: string;
  risco: RiscoAgil;
  criticidade: CriticidadeAgil;
  tipo_task: string | null;
  risco_fatores: FatorRisco[];
  origem: OrigemAgil;
  motor: MotorAgil;
  confianca: number | null;
  estado: EstadoSugestao;
  ativa: boolean;
  criado_em: string;
}

// ---- itens, épicos, membros ----
export interface ItemAgil {
  id: string;
  workspace_id: string;
  origem: OrigemItem;
  trabalho_id: string | null;
  task_ref: string | null;
  epico_id: string | null;
  titulo: string;
  descricao: string | null;
  criterios: string[];
  estado_ade: EstadoAde;
  valor: number | null;
  urgencia: number | null;
  reducao_risco: number | null;
  moscow: Moscow | null;
  ordem: number;
  dono_membro_id: string | null;
  par_membro_id: string | null;
  visibilidade_cliente: "auto" | "sim" | "nao";
  resumo_cliente: string | null;
  /** sempre `humano` quando há resumo (a Fase 19 consome). */
  resumo_cliente_origem: "humano" | null;
  changelog_tipo: "added" | "changed" | "deprecated" | "removed" | "fixed" | "security" | null;
  /** referência de origem (ex.: `{ proposto_por: "agente" }`, `{ oc_id }`, `{ retro_acao_id }`); nunca segredo. */
  origem_ref: Record<string, unknown> | null;
  descartado_motivo: string | null;
  /** task que sumiu do disco: item preservado. */
  orfao: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface EpicoAgil {
  id: string;
  workspace_id: string;
  titulo: string;
  descricao: string | null;
  estado: "aberto" | "concluido" | "arquivado";
  ordem: number;
  criado_em: string;
  atualizado_em: string;
}

export interface MembroAgil {
  id: string;
  workspace_id: string;
  tipo: "humano" | "agente";
  rotulo: string;
  squad_id: string | null;
  horas_dia: number | null;
  fator_foco: number;
  pontos_sprint_fixo: number | null;
  ativo: boolean;
  /** aliases: nome de agente do rastro, sessão, e-mail de commit, login. */
  aliases: { tipo: "agente" | "sessao" | "email" | "login"; valor: string }[];
}

// ---- fatos do método ----
export interface CommitFato { sha: string | null; mensagem: string; ts: string | null; linhas: number | null; labels: string[] }

export interface FatoTask {
  workspace_id: string;
  trabalho_id: string;
  task_ref: string;
  titulo: string;
  fase: string | null;
  depende_de: string[];
  criterio_aceite: string | null;
  tipo_task: string | null;
  status_visto: string;
  iniciada_em: string | null;
  concluida_em: string | null;
  concluida_ts_precisa: boolean;
  duracao_obs_ms: number | null;
  bloqueada_ms: number | null;
  reaberturas: number;
  reabertas_em: string[];
  /** soma (mínima) dos ciclos pós-reabertura, ms; null sem rastro. */
  retrabalho_ms: number | null;
  qa_reprovacoes: number;
  suite_final: string | null;
  /** autor ORIGINAL (primeira atividade): base da atribuição do retrabalho. */
  agente: string | null;
  membro_id: string | null;
  arquivos: string[];
  tdd_primeiro: boolean | null;
  vermelho_antes: boolean | null;
  commits: CommitFato[];
  validada_em: string | null;
  tem_rastro: boolean;
  /** intervalos em andamento (início, fim|null=aberto), para WIP. */
  intervalos: [string, string | null][];
  primeiro_evento_em: string | null;
  declarados: { integracao: boolean; funcional: boolean; regressao: boolean };
  versao_origem: string;
  atualizado_em: string;
}

export type FonteRetrabalho = "qa_reprovado" | "task_reaberta" | "commit_fix" | "regressao" | "regra_repetida" | "manual";
export type NaturezaRetrabalho = "defeito" | "escopo" | "ruido" | "pendente";

export interface EventoRetrabalho {
  id: string;
  workspace_id: string;
  trabalho_id: string;
  task_ref: string | null;
  item_id: string | null;
  fonte: FonteRetrabalho;
  forca: "forte" | "fraca";
  natureza: NaturezaRetrabalho;
  evidencia: Record<string, unknown>;
  chave_dedupe: string;
  ocorrido_em: string | null;
  detectado_em: string;
  confirmado_por: "automatico" | "humano" | null;
  motivo: string | null;
  ativo: boolean;
}

export interface TaskRetrabalho {
  workspace_id: string;
  trabalho_id: string;
  task_ref: string;
  situacao: SituacaoRetrabalho | null;
  eventos_defeito: number;
  eventos_pendentes: number;
  janela_ate: string | null;
  calculado_em: string;
}

export interface ResumoRetrabalho {
  ir: number | null;
  ir_max: number | null;
  first_time_right: number | null;
  avaliaveis: number;
  em_observacao: number;
  indeterminado: number;
  escopo_eventos: number;
  pontos_retrabalhados: number | null;
  horas_obs_retrabalho_min: number | null;
}

// ---- sprint ----
export interface SprintAgil {
  id: string;
  workspace_id: string;
  nome: string;
  meta: string | null;
  inicio: string;
  fim: string;
  estado: EstadoSprint;
  capacidade_pontos: number | null;
  compromisso_pontos: number | null;
  iniciada_em: string | null;
  fechada_em: string | null;
  versao_lancamento: string | null;
  resumo_fechamento: ResumoFechamento | null;
  criado_em: string;
  atualizado_em: string;
}

export interface SprintItemAgil {
  sprint_id: string;
  item_id: string;
  adicionado_em: string;
  removido_em: string | null;
  pontos_compromisso: number | null;
  no_compromisso_inicial: boolean;
  motivo: string | null;
  resultado: "concluido" | "carregado" | "devolvido" | "descartado" | null;
}

export interface ResumoFechamento {
  compromisso_inicial: number | null;
  concluido_pontos: number | null;
  concluidos: number;
  carregados: number;
  devolvidos: number;
  descartados: number;
  sem_estimativa: number;
  first_time_right: number | null;
  destino_pendentes: "backlog" | "proxima" | "descartar";
}

// ---- métricas ----
export interface PontoBurn { dia: string; escopo: number; concluido: number | null; restante: number | null; ideal: number }
export interface SerieBurn { unidade: "pontos" | "itens"; sprint_id: string | null; dias: PontoBurn[]; compromisso_inicial: number; sem_estimativa: number }
export interface PontoVelocidade { sprint_id: string; nome: string; compromisso: number | null; concluido: number; de_primeira: number | null; media_movel_3: number | null }
export interface DispersaoTempo { estado: "ok" | "poucos_dados"; n: number; p50: number | null; p85: number | null; p95: number | null; amostras: { ref: string; ms: number }[] }
export interface SerieDia { dia: string; valor: number }
export interface PontoCfd { dia: string; backlog: number; pronto: number; em_andamento: number; concluida: number; validada: number }
export interface SerieCfd { dias: PontoCfd[]; acumulado: PontoCfd[] }
export interface SerieWip { dias: SerieDia[]; limite: number | null; idade: { ref: string; idade_ms: number }[] }
export interface PrevisaoMC {
  estado: "ok";
  iteracoes: number;
  p50_dias: number;
  p85_dias: number;
  p95_dias: number;
  p50_data: string | null;
  p85_data: string | null;
  p95_data: string | null;
  prob_fechar_na_sprint: number | null;
  restante: number;
  amostra_dias: number;
}
export type PrevisaoEstado = PrevisaoMC | { estado: "dados_insuficientes" | "calculando" };
export interface IndicadorSaude { id: string; cor: "verde" | "amarelo" | "vermelho"; frase: string; fato: string }
export interface ErroEstimativaCategoria { categoria: string; n: number; vies: number | null; mdape: number | null }
export interface ErroEstimativaAgregado { por_categoria: ErroEstimativaCategoria[]; pontos: { item_id: string; previsto: number; observado_ms: number; razao: number | null }[]; vies: number | null; mdape: number | null }
export interface FiltrosAgil { sprint_id: string | null; membro_id: string | null; agente: string | null; squad_id: string | null; de: string | null; ate: string | null }
export interface PlanejadoEntregue {
  compromisso_inicial: number; entregue_do_compromisso: number; adicionado_meio: number; entregue_adicionado: number;
  removido: number; carregado: number; sem_estimativa: number;
}
export interface DefeitosEscapados { total: number; por_sprint: { sprint_id: string; n: number }[]; por_categoria: { categoria: string; n: number }[] }
export interface DistribuicaoAgil { risco: Record<string, number>; categoria: Record<string, number>; criticidade: Record<string, number>; sem_classificacao: number }
export interface ValorEsforcoPonto { item_id: string; valor: number; esforco: number; quadrante: "ganho_rapido" | "grande_aposta" | "preencher" | "evitar" }

export interface PainelAgil {
  filtros: FiltrosAgil;
  gerado_em: string;
  base: { tasks: number; itens: number; sprints: number; sem_estimativa: number; sem_rastro: number };
  burndown: SerieBurn | null;
  burnup: SerieBurn | null;
  velocidade: PontoVelocidade[];
  cfd: SerieCfd;
  cycle: DispersaoTempo;
  lead: DispersaoTempo;
  throughput: SerieDia[];
  wip: SerieWip;
  retrabalho: ResumoRetrabalho & { por_sprint: { sprint_id: string; resumo: ResumoRetrabalho }[]; por_categoria: { categoria: string; resumo: ResumoRetrabalho }[] };
  planejado_entregue: PlanejadoEntregue | null;
  defeitos_escapados: DefeitosEscapados;
  distribuicao: DistribuicaoAgil;
  previsao: PrevisaoEstado;
  saude: IndicadorSaude[];
  erro_estimativa: ErroEstimativaAgregado;
  valor_esforco: ValorEsforcoPonto[];
}

// ---- consultas do backlog ----
export interface ItemResumo {
  id: string; origem: OrigemItem; trabalho_id: string | null; task_ref: string | null; titulo: string; epico_id: string | null; estado_ade: EstadoAde; estado_fluxo: EstadoFluxo;
  pontos: number | null; categoria: string | null; risco: string | null; criticidade: string | null; ordem: number; wsjf: number | null;
  situacao_retrabalho: SituacaoRetrabalho | null; duracao_obs_ms: number | null; sprint_id: string | null; dono: string | null;
  estimativa_origem: OrigemAgil | null; estimativa_confianca: number | null;
}
export interface FiltrosBacklog { texto: string | null; epico_id: string | null; estado_fluxo: EstadoFluxo | null; categoria: string | null; risco: string | null; criticidade: string | null; sprint_id: string | null; sem_estimativa: boolean | null }

// ---- eventos de domínio (D-188; consumidos pelas Fases 19 e 20) ----
export type TipoEventoAgil =
  | "sprint.iniciada" | "sprint.fechada" | "sprint.em_risco" | "tarefa.atrasada"
  | "retrabalho.detectado" | "wip.excedido" | "acao_retro.vencida" | "agil.estimativa_pronta";

export interface EventoAgil {
  tipo: TipoEventoAgil;
  workspace_id: string;
  sprint_id: string | null;
  trabalho_id: string | null;
  task_ref: string | null;
  pontos: number | null;
  duracao_observada_ms: number | null;
  tokens: number | null;
  quando: string;
  dados: Record<string, unknown>;
}

export type CodigoErroAgil = "invalid_argument" | "not_found" | "rule_violation" | "conflict";

// =====================================================================================================================
// IPC `agil:*` (Fase 18, onda 2). TODO pedido leva `workspace_id` e o main confere que o id citado (item, sprint, cerimônia) pertence a ele
// (vazamento entre workspaces = achado ALTA da auditoria). O renderer nunca envia caminho. Erros de regra chegam como `Error` com a mensagem
// `[codigo/subcodigo] texto` (ver `ErroAgil`): ação humana forjada por agente nunca passa por aqui (estes canais SÃO a ação humana).
// =====================================================================================================================
export type { Daily, Insights, Desperdicios, MetricaXp, EstadoChecklist, ResultadoCriterio, AvisoPlanejamento };

export type TipoExportacaoAgil = "backlog" | "metricas" | "retro" | "daily";
export type FormatoExportacaoAgil = "csv" | "md" | "json";
export type AcaoRetrabalhoAgil = "marcar_retrabalho" | "marcar_primeira" | "confirmar" | "descartar" | "natureza";
export type FormatoRetroAgil = "comecar_parar_continuar" | "4ls";
export type DestinoPendentesAgil = "backlog" | "proxima" | "descartar";
export type OrdenacaoBacklogAgil = "ordem" | "wsjf" | "valor_esforco";

/** Página de itens do backlog (`ItemResumo` + contagens por estado de fluxo). */
export interface PaginaBacklogAgil { itens: ItemResumo[]; proximo: string | null; total: number; contagens: Record<string, number> }

export interface EstadoAgilApp {
  workspace_id: string;
  sincronizando: boolean;
  ultima_sincronizacao: string | null;
  /** erro da última sincronização (texto curto, sem caminho). */
  erro_sincronizacao: string | null;
  base: { tasks: number; itens: number; sprints: number; membros: number };
  ia: { consentimento: boolean; modo: ModoEstimativa; chamadas_hoje: number; teto_dia: number; perfil: string | null; disponivel: boolean };
  sprint_ativa: { id: string; nome: string; inicio: string; fim: string } | null;
}

export interface NovoItemAgilPedido { titulo: string; descricao?: string | null; criterios?: string[]; epico_id?: string | null; origem?: "ade" | "issue" | "retro" | "ocorrencia" }
export interface EdicaoItemAgilPedido {
  titulo?: string; descricao?: string | null; criterios?: string[]; epico_id?: string | null; valor?: number | null; urgencia?: number | null; reducao_risco?: number | null; moscow?: Moscow | null;
  dono_membro_id?: string | null; par_membro_id?: string | null; visibilidade_cliente?: "auto" | "sim" | "nao"; resumo_cliente?: string | null;
  changelog_tipo?: ItemAgil["changelog_tipo"]; estado_ade?: "backlog" | "refinado" | "pronto";
}

export interface ItemDetalheAgil {
  item: ItemAgil;
  resumo: ItemResumo;
  estimativas: Estimativa[];
  classificacoes: Classificacao[];
  dod: ResultadoCriterio[];
  fato: FatoTask | null;
  retrabalho: { situacao: SituacaoRetrabalho | null; eventos: EventoRetrabalho[] };
  erro_estimativa: { razao: number | null; observado_ms: number | null; previsto: number } | null;
  /** trabalhos do método que parecem ser este item (só sugestão: o vínculo é humano). */
  vinculos_sugeridos: { trabalho_id: string; titulo: string; similaridade: number }[];
  sprint_id: string | null;
}

export interface ResultadoEstimarAgil { heuristicas_aplicadas: number; preservados_humano: number; job_id: string | null; ia: { consentimento: boolean; motivo_sem_ia: string | null } }
export interface PedidoEstimativaAgil { item_id: string; pontos?: number; rotulo?: string; estado?: "aceita" | "ajustada" | "travada"; nota?: string | null }
export interface PedidoClassificacaoAgil { item_id: string; categoria?: string; risco?: RiscoAgil; criticidade?: CriticidadeAgil; estado?: "aceita" | "ajustada" | "travada" }

export interface SprintComResumoAgil extends SprintAgil { itens: SprintItemAgil[] }
export interface NovaSprintAgilPedido { nome: string; meta?: string | null; inicio: string; fim: string; capacidade_pontos?: number | null }
export interface CapacidadeLinhaAgil { membro_id: string; rotulo: string; tipo: "humano" | "agente"; dias_uteis: number; ausencias_dias: number; pontos: number | null; base: "horas" | "mediana_3" | "fixo" | "sem_base"; aviso: string | null }
export interface CapacidadeSprintAgil { sprint_id: string; linhas: CapacidadeLinhaAgil[]; total: number | null; sem_base: string[] }
export interface SugestaoPlanejamentoAgil { itens: string[]; pontos: number; capacidade: number | null; limite: number | null; avisos: AvisoPlanejamento[]; itens_detalhe: { item_id: string; titulo: string; pontos: number | null }[] }
export interface ResultadoFecharSprintAgil { resumo: ResumoFechamento; ja_fechada: boolean }

export interface DailyAgil extends Daily { cerimonia_id: string | null }
export interface ItemReviewAgil { item_id: string; titulo: string; pontos: number | null; criterios: string[]; commits: number; dod: ResultadoCriterio[]; demo: { resultado: "aceito" | "ajustar" | "rejeitado"; nota: string | null; em: string | null } | null }
export interface RetroAgil {
  cerimonia: { id: string; sprint_id: string | null; formato: FormatoRetroAgil | string | null; data: string; insights: Insights | null };
  itens: { id: string; coluna: string; texto: string; votos: number; dado: unknown; autor_membro_id: string | null }[];
  acoes: { id: string; texto: string; dono_membro_id: string | null; prazo: string | null; estado: "aberta" | "feita" | "cancelada"; item_id: string | null; vencida: boolean }[];
  colunas: string[];
}
export interface PedidoMarcarRetrabalhoAgil { trabalho_id: string; task_ref: string; acao: AcaoRetrabalhoAgil; evento_id?: string; natureza?: NaturezaRetrabalho; motivo: string }
export interface RetrabalhoListaAgil { eventos: EventoRetrabalho[]; situacoes: { trabalho_id: string; task_ref: string; situacao: SituacaoRetrabalho | null; item_id: string | null; titulo: string | null }[] }
export interface PraticasAgil { xp: MetricaXp[]; lean: Desperdicios; checklists: EstadoChecklist[]; sprint_id: string | null }
export interface MembroAgilPedido { id?: string; tipo: "humano" | "agente"; rotulo: string; squad_id?: string | null; horas_dia?: number | null; fator_foco?: number; pontos_sprint_fixo?: number | null; ativo?: boolean; aliases?: MembroAgil["aliases"] }
export interface ResultadoPrevisaoAgil { job_id: string | null; previsao: PrevisaoEstado }
export interface ResultadoExportarAgil { caminho_ref: string }

export type EventoAgilIpc =
  | { tipo: "sincronizado"; workspace_id: string; trabalhos: number; itens_criados: number; quando: string }
  | { tipo: "sincronizacao_falhou"; workspace_id: string; motivo: string; quando: string }
  | { tipo: "estimativa_pronta"; workspace_id: string; job_id: string; itens: number; quando: string }
  | { tipo: "retrabalho_detectado"; workspace_id: string; novos: number; quando: string }
  | { tipo: "metricas_atualizadas"; workspace_id: string; quando: string }
  | { tipo: "sprint_mudou"; workspace_id: string; sprint_id: string | null; quando: string }
  | { tipo: "previsao_pronta"; workspace_id: string; job_id: string; quando: string };

/** `window.ade.agil`: a UI da gestão ágil. Ver os canais `agil:*` em `ipc.ts`. */
export interface ApiAgil {
  estado(workspaceId: string): Promise<EstadoAgilApp>;
  configLer(workspaceId: string): Promise<ConfigAgil>;
  configGravar(workspaceId: string, parcial: Partial<ConfigAgil>): Promise<ConfigAgil>;
  /** consentimento explícito: o TEXTO das tasks vai ao provedor da CLI do usuário. Sem isto a IA nunca é chamada. */
  consentimentoIa(workspaceId: string, consentido: boolean): Promise<{ consentimento: boolean }>;
  sincronizar(workspaceId: string, forcar?: boolean): Promise<{ iniciado: boolean }>;
  membroListar(workspaceId: string): Promise<MembroAgil[]>;
  membroGravar(workspaceId: string, membro: MembroAgilPedido): Promise<MembroAgil>;
  backlogListar(pedido: { workspace_id: string; filtros?: Partial<FiltrosBacklog>; ordenar?: OrdenacaoBacklogAgil; cursor?: string | null; limite?: number }): Promise<PaginaBacklogAgil>;
  itemLer(workspaceId: string, itemId: string): Promise<ItemDetalheAgil>;
  itemCriar(workspaceId: string, item: NovoItemAgilPedido): Promise<ItemAgil>;
  itemAtualizar(workspaceId: string, itemId: string, campos: EdicaoItemAgilPedido): Promise<ItemAgil>;
  itemDescartar(workspaceId: string, itemId: string, motivo: string): Promise<ItemAgil>;
  itemReordenar(workspaceId: string, itemId: string, antesId: string | null): Promise<{ ordem: number }>;
  /** só devolve o comando (`/expx:...`); quem digita no terminal é o fluxo `metodo:disparar` (D-20). */
  itemPromover(workspaceId: string, itemId: string, destino: "prodx" | "sprintx" | "runx"): Promise<{ comando: string }>;
  itemVincular(workspaceId: string, itemId: string, trabalhoId: string | null, taskRef?: string | null): Promise<ItemAgil>;
  epicoListar(workspaceId: string): Promise<EpicoAgil[]>;
  epicoGravar(workspaceId: string, epico: { id?: string; titulo: string; descricao?: string | null; estado?: EpicoAgil["estado"] }): Promise<EpicoAgil>;
  epicoApagar(workspaceId: string, epicoId: string): Promise<{ ok: true }>;
  estimar(workspaceId: string, itemIds: string[] | "sem_estimativa"): Promise<ResultadoEstimarAgil>;
  estimativaGravar(workspaceId: string, pedido: PedidoEstimativaAgil): Promise<{ estimativa: Estimativa; ajustado_a_escala: boolean }>;
  classificacaoGravar(workspaceId: string, pedido: PedidoClassificacaoAgil): Promise<Classificacao>;
  estimativaAceitarLote(workspaceId: string, itemIds: string[], confiancaMin?: number): Promise<{ aceitas: number; restantes: number; restantes_ids: string[] }>;
  sprintListar(workspaceId: string): Promise<SprintComResumoAgil[]>;
  sprintCriar(workspaceId: string, sprint: NovaSprintAgilPedido): Promise<SprintAgil>;
  sprintAtualizar(workspaceId: string, sprintId: string, campos: Partial<Pick<SprintAgil, "nome" | "meta" | "inicio" | "fim" | "capacidade_pontos">>): Promise<SprintAgil>;
  sprintIniciar(workspaceId: string, sprintId: string): Promise<SprintAgil>;
  sprintCancelar(workspaceId: string, sprintId: string): Promise<SprintAgil>;
  sprintItemMover(workspaceId: string, sprintId: string, itemId: string, acao: "adicionar" | "remover", motivo?: string | null): Promise<SprintItemAgil>;
  sprintFechar(workspaceId: string, sprintId: string, destino: DestinoPendentesAgil, versaoLancamento?: string | null): Promise<ResultadoFecharSprintAgil>;
  capacidadeLer(workspaceId: string, sprintId: string): Promise<CapacidadeSprintAgil>;
  capacidadeGravar(workspaceId: string, sprintId: string, membroId: string, ausenciasDias: number): Promise<CapacidadeSprintAgil>;
  planejamentoSugerir(workspaceId: string, sprintId: string | null, buffer?: number): Promise<SugestaoPlanejamentoAgil>;
  dailyGerar(workspaceId: string, sprintId?: string | null): Promise<DailyAgil>;
  dailySalvar(workspaceId: string, cerimoniaId: string, observacoes: { ref: string; observacao: string }[]): Promise<{ ok: true }>;
  reviewLer(workspaceId: string, sprintId: string): Promise<ItemReviewAgil[]>;
  reviewGravar(workspaceId: string, sprintId: string, itemId: string, resultado: "aceito" | "ajustar" | "rejeitado", nota?: string | null, devolver?: boolean): Promise<{ devolvido_item_id: string | null }>;
  retroLer(workspaceId: string, sprintId: string): Promise<RetroAgil>;
  retroItemGravar(workspaceId: string, cerimoniaId: string, pedido: { coluna: string; texto: string } | { item_id: string; voto: 1 | -1 }): Promise<RetroAgil>;
  retroAcaoGravar(workspaceId: string, cerimoniaId: string, pedido: { texto: string; dono_membro_id?: string | null; prazo?: string | null } | { acao_id: string; estado: "aberta" | "feita" | "cancelada" }): Promise<RetroAgil>;
  retroAcaoParaItem(workspaceId: string, acaoId: string): Promise<ItemAgil>;
  retrabalhoListar(workspaceId: string, limite?: number): Promise<RetrabalhoListaAgil>;
  /** AÇÃO HUMANA: o motivo (≥ 5 caracteres) é auditado já redigido. Agente (MCP) recebe `human_only`. */
  retrabalhoMarcar(workspaceId: string, pedido: PedidoMarcarRetrabalhoAgil): Promise<EventoRetrabalho>;
  painel(workspaceId: string, filtros?: Partial<FiltrosAgil>): Promise<PainelAgil>;
  previsao(workspaceId: string, filtros?: Partial<FiltrosAgil>, iteracoes?: number): Promise<ResultadoPrevisaoAgil>;
  praticas(workspaceId: string, sprintId?: string | null): Promise<PraticasAgil>;
  checklistGravar(workspaceId: string, sprintId: string, codigo: string, estado: EstadoChecklist["estado"], nota?: string | null): Promise<{ ok: true }>;
  exportar(workspaceId: string, tipo: TipoExportacaoAgil, formato: FormatoExportacaoAgil, escopo?: { sprint_id?: string | null }): Promise<ResultadoExportarAgil>;
  assinar(cb: (e: EventoAgilIpc) => void): () => void;
}
