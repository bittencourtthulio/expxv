// Commit e push / Enviar PR (D-630..D-639): tipos do contrato `vcs:publicar_*`. O renderer manda só ids do app, texto de formulário e escolhas;
// nunca caminho, URL, cwd nem comando. Quem monta a instrução e a entrega ao agente é o main. Nenhum conteúdo de arquivo trafega aqui: só NOMES.

export type TipoPublicacao = "commit_push" | "pr";
export type EstadoGh = "ok" | "ausente" | "nao_autenticado" | "desconhecido";

/** `^[A-Za-z0-9._/-]{1,100}$`, sem `..`, sem `-` inicial (ver `nucleo/vcs/publicar/ramo.ts`). */
export const REGEX_RAMO_PUBLICAR = /^[A-Za-z0-9._/-]{1,100}$/;
export const LIMITES_PUBLICAR = { mensagem: 300, titulo: 200, descricao: 4_000, revisores: 10 } as const;

/** Fatos locais e baratos (sem rede): o renderer cruza com a tela atual para decidir os botões. */
export interface EstadoPublicacao {
  git: boolean;
  /** o remoto `origin` aponta para github.com (https ou ssh). Enterprise/outros hosts: false na v1. */
  remoto_github: boolean;
  /** `dono/repo`, sem credencial. */
  repo: string | null;
  gh: EstadoGh;
  branch: string | null;
  ramo_padrao: string | null;
  no_padrao: boolean;
  /** arquivos RASTREADOS alterados (modificados, staged, removidos, renomeados, em conflito), sem segredos nem a pasta do produto (D-691). */
  alteradas: number;
  /** arquivos/pastas NOVOS (não rastreados) no nível do `git status` normal: uma pasta nova conta 1, como no git; sem os da suíte nem segredos. */
  novas: number;
  /** o que é da suíte ExpxDev / do app e está não rastreado (`.expx/`, `.opencode/`, `.claude/` e a pasta do produto): fora da contagem; só nomes de topo. */
  suite: { itens: number; caminhos: string[] };
  /** commits que o branch está ATRÁS do upstream (do último fetch; 0 sem upstream). */
  atras: number;
  /** `origin/main` (sem credencial); null sem upstream. */
  upstream: string | null;
  /** commits à frente do upstream (0 sem upstream). */
  a_frente: number;
  /** commits à frente do branch padrão (null = não calculado). */
  a_frente_base: number | null;
  tem_upstream: boolean;
  operacao_em_curso: boolean;
  /** hash curto do HEAD (acompanhamento). */
  oid: string | null;
  /** só quando pedido (`consultar_pr`), depois do push: PR do branch atual. */
  pr: { numero: number; url: string; estado: string } | null;
}

export interface ArquivoPublicacao {
  caminho: string;
  situacao: "modificado" | "novo" | "removido" | "renomeado" | "conflito";
  /** arquivo de ambiente, chave ou credencial: NUNCA entra no commit. */
  sensivel: boolean;
}

export interface CliPublicacao { id: string; nome: string }

export interface PreparoPublicacao {
  tipo: TipoPublicacao;
  workspace_id: string;
  branch: string | null;
  remoto: string;
  repo: string;
  ramo_padrao: string;
  no_padrao: boolean;
  /** arquivos rastreados alterados (sem segredos). */
  total_arquivos: number;
  /** arquivos/pastas novos (não rastreados), sem a suíte e sem segredos. */
  novos: number;
  /** pastas/arquivos da suíte ExpxDev não rastreados (`incluiveis` = os que um commit pode levar; a pasta do produto nunca). */
  suite: { itens: number; caminhos: string[]; incluiveis: number };
  adicionadas: number;
  removidas: number;
  /** os primeiros 8 (nomes e situação; nunca conteúdo). */
  arquivos: ArquivoPublicacao[];
  mais: number;
  /** arquivos sensíveis na lista alterada (até 20 nomes): o agente é proibido de commitá-los. */
  sensiveis: string[];
  a_frente: number;
  tem_upstream: boolean;
  sugestao_ramo: string;
  clis: CliPublicacao[];
  cli_padrao: string | null;
  /** CLI do painel em foco (se for um painel de CLI de IA deste workspace). */
  cli_foco: string | null;
}

export interface TextoOuAgente { modo: "agente" | "manual"; texto: string | null }

export interface OpcoesPublicacao {
  criar_ramo: boolean;
  nome_ramo: string | null;
  incluir_nao_rastreados: boolean;
  /** "Incluir no commit" as pastas da suíte ExpxDev não rastreadas (padrão false, D-692). */
  incluir_suite: boolean;
  mensagem: TextoOuAgente;
  pr: { titulo: TextoOuAgente; descricao: TextoOuAgente; rascunho: boolean; base: string | null; revisores: string[] } | null;
  /** digitado em diálogo à parte quando o destino é o branch padrão: `push na <branch>`. */
  confirmar_padrao: string | null;
}

export interface PedidoEnviarInstrucao {
  workspace_id: string;
  tipo: TipoPublicacao;
  opcoes: OpcoesPublicacao;
  /** sessão do painel em foco na tela Terminais (o main confere que é um Pane de CLI de IA deste workspace). */
  sessao_foco: string | null;
  /** CLI escolhida no diálogo (id do catálogo); null = a do painel em foco, senão a padrão do workspace. */
  cli: string | null;
  /** `novo` = respondeu "Abrir um painel novo" à pergunta de agente ocupado. */
  modo_painel: "auto" | "novo";
}

export interface ResultadoEnviarInstrucao {
  /** `ocupado`: o painel em foco está trabalhando/aguardando; a UI pergunta antes de abrir um novo. */
  estado: "entregue" | "falhou" | "ocupado";
  motivo: string | null;
  pane_id: string | null;
  sessao_id: string | null;
  entrega: "prompt_inicial" | "escrita" | null;
  /** caminho RELATIVO do arquivo com a instrução (dentro da pasta do produto). */
  instrucao_rel: string | null;
}

// ---- Atualizar (pull) (D-693) ------------------------------------------------------------------------------------------------------------

/** `vcs:publicar_buscar_remoto`: `git fetch --prune` silencioso (no máximo a cada 60 s por workspace; `forcar` = clique do dono). */
export interface ResultadoBuscaRemoto { buscou: boolean; atras: number; erro: string | null }

export interface PreparoAtualizar {
  workspace_id: string;
  branch: string | null;
  /** `origin/main` (sem credencial). */
  upstream: string | null;
  remoto: string;
  repo: string;
  /** commits do upstream que faltam (`git rev-list --count HEAD..@{u}`). */
  commits: number;
  a_frente: number;
  /** quantos arquivos o upstream tocou (nunca conteúdo) e os 8 primeiros nomes. */
  arquivos_tocados: number;
  arquivos: string[];
  mais: number;
  /** até 5 assuntos dos commits que entram (dado do repositório; o renderer mostra como texto). */
  assuntos: string[];
  /** arquivos rastreados com alteração local que o upstream também mudou (o pull recusaria): até 8 nomes. */
  conflita: string[];
  /** o branch local também tem commits que o remoto não tem: `--ff-only` não avança. */
  divergiu: boolean;
  operacao_em_curso: boolean;
  clis: CliPublicacao[];
  cli_padrao: string | null;
  cli_foco: string | null;
}

export interface ResultadoAtualizar {
  /** `recusado`: guard rail do D-36 (árvore suja que conflita, merge em curso, sem upstream); `divergiu`: o fast-forward não é possível. */
  estado: "ok" | "ja_atualizado" | "recusado" | "divergiu" | "falhou";
  motivo: string | null;
  /** commits trazidos (0 fora de `ok`). */
  trouxe: number;
  /** o motivo se resolve commitando/guardando: a UI sugere. */
  sugerir_commitar: boolean;
}

export interface PedidoPedirMerge {
  workspace_id: string;
  sessao_foco: string | null;
  cli: string | null;
  modo_painel: "auto" | "novo";
}

export interface ResultadoIgnorarSuite {
  /** `nada`: não há pasta da suíte não rastreada (ou já estavam no exclude). */
  estado: "ok" | "nada";
  /** linhas acrescentadas em `.git/info/exclude` (só a contagem). */
  linhas: number;
}

export interface ApiVcsPublicar {
  estado(workspaceId: string, consultarPr?: boolean): Promise<EstadoPublicacao>;
  prepararCommitPush(workspaceId: string, sessaoFoco: string | null): Promise<PreparoPublicacao>;
  prepararPr(workspaceId: string, sessaoFoco: string | null): Promise<PreparoPublicacao>;
  enviarInstrucao(pedido: PedidoEnviarInstrucao): Promise<ResultadoEnviarInstrucao>;
  /** `git fetch --prune` seguro e silencioso (só remoto github.com); throttle de 60 s, `forcar` por clique. */
  buscarRemoto(workspaceId: string, forcar: boolean): Promise<ResultadoBuscaRemoto>;
  prepararAtualizar(workspaceId: string, sessaoFoco: string | null): Promise<PreparoAtualizar>;
  /** `git pull --ff-only` pelo executor do VCS (nunca por agente de CLI). */
  atualizar(workspaceId: string): Promise<ResultadoAtualizar>;
  /** o branch divergiu: entrega ao agente a instrução de MERGE (mesma entrega do Commit e push). */
  pedirMerge(pedido: PedidoPedirMerge): Promise<ResultadoEnviarInstrucao>;
  /** acrescenta as pastas da suíte ExpxDev não rastreadas em `.git/info/exclude` (local; nunca `.gitignore`). */
  ignorarSuite(workspaceId: string): Promise<ResultadoIgnorarSuite>;
  /** Abre no navegador só `https://github.com/...` (o main confere de novo). */
  abrirUrl(workspaceId: string, url: string): Promise<boolean>;
}
