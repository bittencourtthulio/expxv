// Tipos de fio do modal "Adicionar workspace" (D-600…). Canais `workspaces:adicionar_*`.
// O renderer NUNCA envia caminho de destino: só tokens opacos (`DestinoPai.token`) que o main emitiu depois do diálogo nativo
// ou da pasta de projetos padrão. Caminhos aparecem no renderer só mascarados (`~/…`).
import type { Workspace } from "./dominio";

export type SecaoAdicionar = "pasta" | "clonar" | "novo";
export const SECOES_ADICIONAR: readonly SecaoAdicionar[] = ["pasta", "clonar", "novo"];

/** Pasta pai autorizada: o main guarda o caminho real; a UI vê só o token e o texto mascarado. */
export interface DestinoPai {
  token: string;
  exibicao: string;
}

export type CodigoErroAdicionar =
  | "origem_invalida"
  | "destino_invalido"
  | "colisao"
  | "sem_internet"
  | "sem_acesso"
  | "nao_encontrado"
  | "sem_permissao"
  | "disco_cheio"
  | "branch_inexistente"
  | "host_ssh"
  | "git_ausente"
  | "gh_ausente"
  | "cancelado"
  | "timeout"
  | "ocupado"
  | "consentimento"
  | "nome_invalido"
  | "interno";

/** Ação que a UI pode oferecer junto do erro. Nunca executa nada sozinha (login é sempre do dono). */
export type AcaoErroAdicionar = "login_gh" | "escolher_outro_nome" | "abrir_existente" | null;

export interface ErroAdicionar {
  codigo: CodigoErroAdicionar;
  mensagem: string;
  acao: AcaoErroAdicionar;
  /** nome de pasta livre sugerido (colisão). */
  sugestao: string | null;
}

// ---- destino ---------------------------------------------------------------------------------------
export interface PedidoAvaliarDestino {
  destino_token: string;
  nome: string;
}
export interface AvaliacaoDestino {
  ok: boolean;
  situacao: "livre" | "vazio" | "ocupado" | "invalido";
  /** destino exato, mascarado (`~/…`). */
  caminho_exibicao: string;
  motivo: string | null;
  sugestao: string | null;
  /** a pasta existente já é um workspace conhecido. */
  ja_workspace: boolean;
}

// ---- clonar ----------------------------------------------------------------------------------------
export interface PedidoClonar {
  entrada: string;
  permitir_local: boolean;
  destino_token: string;
  nome: string;
  /** vazio/null = a padrão do repositório. */
  branch: string | null;
  raso: boolean;
  submodulos: boolean;
  /** o dono confirmou "isto baixa o repositório para o seu computador" (a UI só envia true depois do clique em Clonar). */
  consentimento: boolean;
}
export type ResultadoIniciarClone = { ok: true; clone_id: string } | { ok: false; erro: ErroAdicionar };

export type FaseClone = "preparando" | "conectando" | "contando" | "comprimindo" | "recebendo" | "resolvendo" | "extraindo" | "submodulos" | "concluido" | "falhou" | "cancelado";
export interface EventoClone {
  clone_id: string;
  fase: FaseClone;
  /** 0–100 da fase atual (null = indeterminado). */
  percentual: number | null;
  bytes: number | null;
  velocidade_bps: number | null;
  mensagem: string;
  /** só em `concluido`: o workspace já adicionado e atual. */
  workspace: Workspace | null;
  erro: ErroAdicionar | null;
  /** destino mascarado (informativo). */
  destino_exibicao: string;
  /** o projeto foi marcado como NÃO confiável para execução até o dono confiar. */
  nao_confiavel: boolean;
}

// ---- encontrar projetos ------------------------------------------------------------------------------
export interface AchadoProjeto {
  id: string;
  nome: string;
  /** pasta mascarada (`~/…`). */
  exibicao: string;
  branch: string | null;
  e_git: boolean;
  /** primeiro manifesto encontrado (package.json…); null para repositório git puro. */
  manifesto: string | null;
  ja_workspace: boolean;
}
export interface LoteProjetos {
  busca_id: string;
  itens: AchadoProjeto[];
  visitados: number;
  fim: boolean;
  cancelada: boolean;
  limite_atingido: boolean;
}

// ---- meus repositórios (gh) ---------------------------------------------------------------------------
export interface EstadoGhAdicionar {
  instalado: boolean;
  autenticado: boolean;
  usuario: string | null;
}
export interface RepoRemoto {
  nome: string;
  nome_com_dono: string;
  descricao: string;
  privado: boolean;
  atualizado_em: string | null;
  url: string;
}
export type ResultadoRepos = { ok: true; repos: RepoRemoto[]; truncado: boolean } | { ok: false; erro: ErroAdicionar };

// ---- novo projeto -------------------------------------------------------------------------------------
export const TEMPLATES_PROJETO = ["vazio", "node", "python", "docs"] as const;
export type TemplateProjeto = (typeof TEMPLATES_PROJETO)[number];
export interface PedidoNovoProjeto {
  nome: string;
  destino_token: string;
  git: boolean;
  gitignore: boolean;
  commit_inicial: boolean;
  readme: boolean;
  template: TemplateProjeto;
  instalar_suite: boolean;
}
export type ResultadoNovoProjeto =
  | { ok: true; workspace: Workspace; avisos: string[]; instalar_suite: boolean }
  | { ok: false; erro: ErroAdicionar };
