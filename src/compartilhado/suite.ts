// Tipos de IPC da instalação da suíte ExpxDev (D-470…): estado por workspace, requisitos, progresso e resultado.
// Compartilhado por main e renderer. Nenhum caminho absoluto de máquina sai daqui: só texto com `~` e caminhos RELATIVOS ao workspace.

/** Estado da suíte num workspace (detecção local, somente leitura). */
export type EstadoSuiteId = "ausente" | "completa" | "incompleta" | "desatualizada" | "indisponivel";

export type ModoInstalacao = "instalar" | "reparar" | "atualizar";

export interface EstadoSuite {
  workspace_id: string;
  estado: EstadoSuiteId;
  /** frase curta em linguagem simples */
  motivo: string;
  versao_instalada: string | null;
  versao_pedida: string;
  skills_presentes: string[];
  skills_faltando: string[];
  /** "Agora não" lembrado para este workspace (só vale para `ausente`) */
  dispensado: boolean;
  /** há uma instalação em andamento neste workspace */
  instalando: boolean;
  instalacao_id: string | null;
}

export type SituacaoRequisito = "ok" | "falha" | "pendente" | "info";

export interface RequisitoSuite {
  id: "node" | "npm" | "internet" | "pasta" | "git";
  rotulo: string;
  situacao: SituacaoRequisito;
  detalhe: string;
  /** correção sugerida quando `falha` */
  correcao: string | null;
  /** `falha` bloqueia o botão "Instalar agora" */
  bloqueante: boolean;
}

/** Uma skill da suíte no passo 1 do modal (marcada por padrão; dá para desmarcar, mínimo 1). */
export interface SkillPlano {
  nome: string;
  /** descrição de uma linha */
  papel: string;
  /** já existe neste projeto (lock ou pasta) */
  instalada: boolean;
}

export interface ArquivosExistentes {
  pasta: string;
  quantidade: number;
}

/** O que o primeiro passo do modal mostra. */
export interface PlanoSuite {
  workspace_id: string;
  modo: ModoInstalacao;
  versao: string;
  skills: SkillPlano[];
  /** linhas do comando exato (cada linha um comando), em fonte mono */
  comando: string[];
  /** pasta alvo com `~` */
  pasta_alvo: string;
  pastas_gravadas: string[];
  existentes: ArquivosExistentes[];
  requisitos: RequisitoSuite[];
  pode_instalar: boolean;
  /** onde a rede é usada, em texto simples */
  rede: string;
  /** efeitos FORA do projeto (ex.: registrar o plugin no Claude Code da máquina), em texto simples */
  efeitos_fora: string[];
}

export type EtapaSuiteId = "requisitos" | "baixando" | "instalando" | "conferindo" | "pronto";
export type SituacaoEtapa = "pendente" | "ativa" | "ok" | "falhou" | "pulada";
export type FaseInstalacao = "rodando" | "concluida" | "falhou" | "cancelada";

export interface EtapaSuite {
  id: EtapaSuiteId;
  rotulo: string;
  situacao: SituacaoEtapa;
}

export type CausaFalhaSuite =
  | "sem_internet"
  | "registro_inacessivel"
  | "sem_permissao"
  | "node_ausente"
  | "git_ausente"
  | "versao_incompativel"
  | "comando_falhou"
  | "tempo_esgotado"
  | "sem_resposta"
  | "saida_excessiva"
  | "pacote_invalido"
  | "conferencia"
  /** o instalador recusou o pedido que o APP montou (flag que faltou/sobrou): defeito do app, não do usuário */
  | "defeito_do_app"
  | "interna";

export interface FalhaSuite {
  causa: CausaFalhaSuite;
  /** linguagem simples, sem stack nem caminho de máquina */
  mensagem: string;
  /** o que fazer */
  sugestao: string;
  codigo: number | null;
  etapa: EtapaSuiteId;
}

export interface ResumoSuite {
  versao: string;
  skills: string[];
  criados: string[];
  alterados: string[];
  removidos: string[];
  /** caminhos tocados FORA de .claude/.expx/.opencode (não esperado) */
  fora_do_esperado: string[];
  truncado: boolean;
  /** `ok`, `avisos` (doctor saiu com código ≠ 0) ou `indisponivel` */
  doctor: "ok" | "avisos" | "indisponivel";
  /** pasta da cópia de segurança dos arquivos que já existiam (com `~`); só existe quando algo que já existia foi alterado/removido */
  backup: string | null;
  /** como restaurar a partir da cópia de segurança, em texto simples (só quando há `backup`) */
  como_restaurar: string | null;
  /** arquivos de `.expx/` que o instalador trocou/removeu e o app devolveu (ex.: hooks.json) */
  restaurados: string[];
}

export interface ProgressoSuite {
  tipo: "progresso";
  instalacao_id: string;
  workspace_id: string;
  modo: ModoInstalacao;
  versao: string;
  fase: FaseInstalacao;
  etapas: EtapaSuite[];
  /** 0–100, determinístico por etapa */
  percentual: number;
  iniciado_em: number;
  decorrido_ms: number;
  /** cauda do log (limpa de ANSI, redigida, limitada) */
  log: string[];
  log_truncado: boolean;
  resumo: ResumoSuite | null;
  falha: FalhaSuite | null;
  /** o que a limpeza do cancelamento fez ou deixou */
  limpeza: string | null;
  /** em falha/cancelamento: o que ficou no projeto ("O projeto não foi alterado." ou o que ficou pela metade) */
  situacao_projeto: string | null;
  /** texto pronto para copiar, sem segredos e com o início do caminho mascarado */
  diagnostico: string | null;
}

export interface MudancaEstadoSuite {
  tipo: "estado";
  estado: EstadoSuite;
}

export type EventoSuite = ProgressoSuite | MudancaEstadoSuite;

// ---------------------------------------------------------------- módulos da suíte (ligar/desligar por projeto)
export type OrigemModulos = "arquivo" | "app" | "padrao";

export interface ModuloInfo {
  id: string;
  nome: string;
  /** uma linha */
  papel: string;
  ligado: boolean;
  /** vem desligado de fábrica (legadox) */
  padrao_desligado: boolean;
  /** `exige`: grupos de "um destes" que precisam estar ligados; `recomenda`: perde valor sem, mas funciona */
  exige: string[][];
  recomenda: string[][];
  /** módulos que exigem este */
  dependentes: string[];
  fonte: string;
}

export interface EstadoModulosSuite {
  workspace_id: string;
  modulos: ModuloInfo[];
  /** onde está guardado: `modulos.json` na pasta do produto do projeto, dados do app (pasta sem escrita) ou nada ainda (vale o padrão) */
  origem: OrigemModulos;
  arquivo: string;
  desligados: string[];
  /** avisos em linguagem simples: arquivo inválido, requisito quebrado, recomendação não atendida */
  avisos: string[];
  /** como o desligado vale em cada CLI (a UI mostra: o gate por Pane só existe onde a CLI permite) */
  isolamento: Array<{ cli: string; nome: string; efeito: "negado" | "parcial"; texto: string }>;
  /** a suíte está instalada neste projeto (o bloco só faz sentido assim) */
  suite_instalada: boolean;
}

export type ResultadoModulos =
  | { ok: true; estado: EstadoModulosSuite; mudou: string[] }
  | { ok: false; precisa_confirmar: { tipo: "desligar_dependentes" | "ligar_requisitos"; modulos: string[] }; estado: EstadoModulosSuite };

export interface PadraoModulos {
  modulos: Record<string, boolean>;
  /** o de fábrica (para "Restaurar padrões" no painel global) */
  fabrica: Record<string, boolean>;
}

export interface EventoModulosMudou {
  workspace_id: string | null;
}
