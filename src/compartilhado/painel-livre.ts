// Painel livre que orquestra (D-420 em diante): contrato entre main e renderer. O painel livre (terminal comum com uma CLI de IA) NÃO recebe o
// MCP de orquestração do app por padrão; com o interruptor "Orquestrar neste painel" ele passa a abrir workers como painéis visíveis na grade.
// Nada aqui carrega segredo: token, caminho absoluto e conteúdo de terminal nunca atravessam estes tipos.

/** Prefixo do título da Missão avulsa que o app cria sozinho para o painel que orquestra (a UI a reconhece por ele; o main, pela chave de config). */
export const TITULO_MISSAO_AVULSA = "Missão avulsa";

/** Limites rígidos (D-423). O 9º worker do painel e o 17º do workspace são recusados; o worker nunca abre worker (profundidade 1). */
export const LIMITES_PAINEL_LIVRE = {
  workers_por_painel: 8,
  workers_por_workspace: 16,
  /** `pane_spawn` por minuto, por painel */
  spawns_por_minuto: 12,
} as const;

/** Preferência por workspace "painéis livres podem abrir agentes". Padrão DESLIGADO. */
export interface PreferenciaPainelLivre {
  workspace_id: string;
  ativa: boolean;
  /** opt-out "orquestrador pode editar" (D-512): padrão DESLIGADO, o orquestrador só lê e delega. */
  orquestrador_edita: boolean;
  /** "Fechar workers ao terminar" (D-520): padrão LIGADO, o painel do worker fecha sozinho ~3 s depois da entrega; desligado, fica aberto para inspeção. */
  fechar_workers: boolean;
}

/** Ponte do Grok (D-514): arquivo de projeto que dá o MCP do app ao Grok, só com a autorização explícita do dono. */
export type AcaoPonteGrok = "estado" | "aplicar" | "remover";
export interface PedidoPonteGrok { workspace_id: string; acao: AcaoPonteGrok }
export interface RespostaPonteGrok {
  estado: "ausente" | "ativa" | "bloqueada";
  /** caminho RELATIVO do arquivo (relativo à raiz do projeto) */
  arquivo: string;
  /** conteúdo exato que será gravado (sem segredo: só referências a variáveis do ambiente da sessão) */
  conteudo: string;
  detalhe: string;
}

/** Abre um terminal como painel livre. `orquestrar` exige a preferência do workspace ligada (o main reconfere). */
export interface PedidoAbrirPainelLivre {
  workspace_id: string;
  ferramenta_id: string;
  orquestrar: boolean;
}

export interface RespostaPainelLivre {
  sessao_id: string;
  pane_id: string;
  /** Missão avulsa criada para o painel (`null` quando não orquestra). */
  missao_id: string | null;
  orquestrando: boolean;
  /** aviso curto e sem segredo (ex.: "a CLI não retoma a conversa; abriu uma sessão nova"). */
  aviso: string | null;
}

/** Liga/desliga a orquestração de um painel que já está aberto: reabre a CLI (com `resume` quando ela suporta) no lugar do painel. */
export interface PedidoOrquestrarPainel {
  workspace_id: string;
  sessao_id: string;
  ligar: boolean;
}

export interface RespostaOrquestrarPainel {
  /** sessão que fica no lugar do painel (a mesma, quando nada mudou) */
  sessao_id: string;
  /** `null` = painel comum sem Pane (nada mudou) */
  pane_id: string | null;
  missao_id: string | null;
  orquestrando: boolean;
  /** a conversa anterior foi retomada pela CLI (`resume`)? */
  retomado: boolean;
  aviso: string | null;
}

/** Tamanho mínimo legível de um painel na grade automática (px); abaixo disso o painel novo vai para outra aba. */
export const PAINEL_MINIMO_PX = { largura: 360, altura: 180 } as const;
/** Teto de painéis numa grade automática (o limite de workers por painel + o painel que pediu). */
export const PAINEIS_MAXIMOS_NA_GRADE = LIMITES_PAINEL_LIVRE.workers_por_painel + 1;

/** D-640: aprovação efetiva de um worker (o que o app aplicou ao lançá-lo). Sem segredo nem caminho. */
export interface AprovacaoDoPane {
  nivel: import("./aprovacao-workers").NivelAprovacaoWorker;
  /** nível configurado, antes dos rebaixamentos de segurança */
  nivel_pedido: import("./aprovacao-workers").NivelAprovacaoWorker;
  selo: import("./aprovacao-workers").SeloAprovacao;
  avisos: string[];
}
