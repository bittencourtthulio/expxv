// Tipos do Método Expx (leitura). Tudo aqui é objeto simples (clonável por structuredClone), para
// atravessar a fronteira do worker sem adaptação. Contrato: docs/ade/05-CONTRATOS.md §6.

export const SCHEMA_SUPORTADO = 1;

export type Ferramenta = "sprintx" | "runx" | "prodx" | "buildx" | "mergex" | "designx" | "legadox" | "stackx" | "memox";

export type StatusTrabalho = "nao_iniciado" | "em_andamento" | "bloqueado" | "concluido";
export type StatusTask = "pendente" | "em_andamento" | "concluida" | "bloqueada";
export type SuiteTask = "verde" | "vermelha" | "parcial" | "nao_executada";
export type Severidade = "alta" | "media" | "baixa";
export type VereditoTexto = "sim" | "nao" | "aprovado" | "reprovado";

export type RejeicaoLeitura =
  | "sem_frontmatter"
  | "yaml_invalido"
  | "schema_maior"
  | "arquivo_grande"
  | "ilegivel";

/** Resultado de ler um arquivo de estado. Nunca lança: problemas viram `rejeicao`/`avisos`. */
export interface Artefato {
  /** caminho relativo à raiz do projeto, com `/`. */
  caminho: string;
  nome: string;
  ferramenta: string | null;
  /** kind do frontmatter; `desconhecido` quando ausente ou fora da lista. */
  kind: string;
  trabalho_id: string | null;
  dados: Record<string, unknown> | null;
  corpo: string;
  veredito: VereditoTexto | null;
  /** faixa do legadox/stackx lida por regex de `## FAIXA:` (minúscula). */
  faixa: string | null;
  rejeicao: RejeicaoLeitura | null;
  avisos: string[];
}

export interface EventoRastro {
  ts: string;
  expx_eventos: number;
  trabalho_id: string;
  ferramenta: string;
  origem: string;
  evento: string;
  fase: string | null;
  task: string | null;
  agente: string | null;
  resultado: string;
  detalhe: string;
  arquivos: string[];
  [chave: string]: unknown;
}

export type TipoViolacao =
  | "teste_ausente"
  | "regressao_ausente"
  | "concluida_sem_verde"
  | "paralela_com_dependencia"
  | "sem_criterio_saida"
  | "dependencia_inexistente"
  | "ciclo_dependencia"
  | "estagio_incoerente"
  | "bloqueio_antigo";

export interface Violacao {
  tipo: TipoViolacao;
  trabalho_id: string;
  /** id da task/fase/sprint/bloqueio/trabalho a que se refere. */
  alvo: string;
  arquivo: string;
  detalhe: string;
}

export interface Task {
  id: string;
  titulo: string;
  fase: string | null;
  status: StatusTask;
  depende_de: string[];
  paralelizavel: boolean;
  suite: SuiteTask;
  concluida_em: string | null;
  objetivo: string | null;
  criterio_aceite: string | null;
  teste_integracao: string | null;
  teste_funcional: string | null;
  teste_regressao: string | null;
  arquivo: string;
  /** tempo de parede observado no rastro (task_iniciada a task_concluida); nunca "esforço". */
  duracao_observada_ms: number | null;
}

export interface Fase {
  id: string;
  titulo: string;
  status: StatusTrabalho;
  criterio_saida: string | null;
  paralelizavel: boolean;
  paralela_com: string[];
  tasks: Task[];
  arquivo: string;
  /** false quando a fase só existe porque tasks a citam (nenhum arquivo a declara). */
  declarada: boolean;
}

export interface Sprint {
  id: string;
  titulo: string;
  status: StatusTrabalho;
  criterio_saida: string | null;
  fases: Fase[];
  arquivo: string;
}

export interface Bloqueio {
  id: string;
  task: string | null;
  aberto_em: string | null;
  resolvido_em: string | null;
  aberto: boolean;
  descricao: string;
  arquivo: string;
}

export interface Entrega {
  estado: string | null;
  branch: string | null;
  portao: string | null;
  pr_url: string | null;
  pr_estado: string | null;
  commits: number;
  arquivo: string;
}

export interface FeatureProjeto {
  id: string;
  titulo: string;
  slug: string | null;
  status: string;
  depende_de: string[];
  paralelizavel: boolean;
}

export type TipoTrabalho = "feature" | "ocorrencia" | "pedido" | "projeto";
export type Layout = "sprintx_features" | "legado" | "manutencao" | "pedido" | "projeto";

export type CorSinaleira = "verde" | "amarelo" | "vermelho" | "cinza";

export interface Sinaleira {
  cor: CorSinaleira;
  /** a cor nunca é o único dado: sempre há um motivo em texto. */
  motivo: string;
  motivos: string[];
}

export interface GrafoPlano {
  nos: { id: string; depende_de: string[]; fase: string | null; status: string | null }[];
  arestas: { de: string; para: string }[];
  ciclos: string[][];
  dependencias_inexistentes: { de: string; ate: string }[];
  caminho_critico: string[];
  /** pendentes cujas dependências estão todas concluídas. */
  prontas: string[];
}

export interface RaioLegado {
  faixa: string | null;
  aprovado: boolean;
}

export interface Trabalho {
  id: string;
  tipo: TipoTrabalho;
  ferramenta: Ferramenta;
  layout: Layout;
  origem_buildx: string | null;
  feature_id: string | null;
  titulo: string;
  tipo_ocorrencia: string | null;
  /** estágio deduzido pelo disco (f1..f6, e1..e5, p2..p5, b1..b6). */
  estagio: string;
  estagio_declarado: string | null;
  status: StatusTrabalho;
  /** pasta do trabalho, relativa à raiz. */
  pasta: string;
  worktree: string | null;
  sprints: Sprint[];
  bloqueios: Bloqueio[];
  veredito_auditoria: VereditoTexto | null;
  veredito_qa: VereditoTexto | null;
  entrega: Entrega | null;
  caminho_critico_declarado: string[];
  grafo: GrafoPlano;
  features: FeatureProjeto[];
  /** só prodx: veredito da avaliação e assinatura humana. */
  prodx: { veredito: string | null; assinado: boolean; briefing: boolean } | null;
  raio: RaioLegado | null;
  decisoes_pendentes: number;
  /** divergências entre rastro e disco (o disco venceu). */
  divergencias: { task: string; disco: string; rastro: string }[];
  ultima_atividade: string | null;
  eventos_total: number;
  sinaleira: Sinaleira;
  violacoes: Violacao[];
}

export interface Rejeicao {
  caminho: string;
  motivo: RejeicaoLeitura;
}

export interface CamadasProjeto {
  convencoes: boolean;
  perfil_legado: boolean;
  design_system: boolean;
  produto: boolean;
  hooks: boolean;
  lock: boolean;
  memoria: boolean;
}

export interface IndiceProjeto {
  raiz: string;
  gerado_em: string;
  duracao_ms: number;
  trabalhos: Trabalho[];
  violacoes: Violacao[];
  rejeicoes: Rejeicao[];
  avisos: string[];
  camadas: CamadasProjeto;
  artefatos_lidos: number;
}
