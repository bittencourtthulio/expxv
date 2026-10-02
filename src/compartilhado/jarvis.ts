// Contratos da Fase 13 (Jarvis e controle remoto) compartilhados entre núcleo, main, preload e renderer. Arquivo NOVO e aditivo.
// Jarvis = assistente de comando por linguagem natural (TEXTO) que traduz o pedido em AÇÕES TIPADAS de uma lista fechada, com níveis de risco. A LLM, se ligada, só
// classifica a intenção; nunca executa e nunca decide aprovação humana (D-21). Controle remoto = servidor local autenticado por dispositivo (opt-in explícito).

export const ACOES_JARVIS = ["status", "listar_missoes", "listar_paineis", "consultar_consumo", "abrir_pane", "enviar_prompt", "aprovar_gate", "pausar", "parar"] as const;
export type AcaoJarvis = (typeof ACOES_JARVIS)[number];

/** `leitura` e `escrita_leve` executam direto; `escrita` SEMPRE passa por confirmação de uso único atrelada a `args_hash`. */
export type ClasseRisco = "leitura" | "escrita_leve" | "escrita";
export const RISCO_DA_ACAO: Readonly<Record<AcaoJarvis, ClasseRisco>> = {
  status: "leitura",
  listar_missoes: "leitura",
  listar_paineis: "leitura",
  consultar_consumo: "leitura",
  abrir_pane: "escrita_leve",
  enviar_prompt: "escrita",
  aprovar_gate: "escrita",
  pausar: "escrita",
  parar: "escrita",
};

export type AtorJarvis = "jarvis" | "remoto";
export type PermissaoRemota = "leitura" | "mensagem_confirmada" | "mensagem_direta";
export const PERMISSOES_REMOTAS: readonly PermissaoRemota[] = ["leitura", "mensagem_confirmada", "mensagem_direta"];

/** Quem originou o PEDIDO. Só `fala_do_usuario`/`voz`/`ui`/`remoto` podem pedir escrita; `conteudo_externo` (painel, issue, web, saída de terminal) é DADO e nunca autoriza escrita. */
export type OrigemJarvis = "fala_do_usuario" | "voz" | "ui" | "remoto_confirmado" | "remoto_direto" | "conteudo_externo";

export type AcaoTipada =
  | { acao: "status" }
  | { acao: "listar_missoes" }
  | { acao: "listar_paineis" }
  | { acao: "consultar_consumo" }
  | { acao: "abrir_pane"; pane: string }
  | { acao: "enviar_prompt"; destino: "maestro" | "squad"; squad: string | null; texto: string }
  | { acao: "aprovar_gate"; gate_id: string; decisao: "aprovar" | "recusar" }
  | { acao: "pausar"; alvo: string }
  | { acao: "parar"; alvo: string };

export const TEXTO_MAX = 2000;
export const ALVO_MAX = 120;

export type CodigoRecusaJarvis =
  | "sem_intencao"
  | "gesto_proibido"
  | "origem_nao_confiavel"
  | "permissao_insuficiente"
  | "acao_fora_da_lista"
  | "acao_humana_so_no_desktop"
  | "so_no_desktop"
  | "confirmacao_expirada"
  | "confirmacao_invalida"
  | "plano_alterado"
  | "indisponivel"
  | "limite_de_taxa"
  | "duplicado"
  | "alvo_nao_encontrado"
  | "desligado"
  | "falhou";

export interface LinhaResposta {
  rotulo: string;
  detalhe?: string;
}
export interface RespostaJarvis {
  /** texto curto, redigido e sem HTML (renderizado por `textContent`/JSX). */
  texto: string;
  linhas: LinhaResposta[];
  /** conteúdo derivado de terceiros (painel, título de PR): sempre `true` quando há `linhas` de origem externa. */
  nao_confiavel: boolean;
}

export interface ConfirmacaoVisao {
  id: string;
  acao: AcaoJarvis;
  /** resumo exato do que SERÁ feito (alvo + texto), o mesmo que foi fixado em `args_hash`. */
  resumo: string;
  expira_em: string;
  ator: AtorJarvis;
  /** nome do dispositivo (remoto), `null` no Jarvis local. */
  dispositivo: string | null;
  dispositivo_id: string | null;
  /** quem pode resolver: sempre o desktop. */
  resolvivel_por: "desktop";
}

export type ResultadoJarvis =
  | { tipo: "resposta"; resposta: RespostaJarvis }
  | { tipo: "confirmacao"; confirmacao: ConfirmacaoVisao }
  | { tipo: "recusado"; codigo: CodigoRecusaJarvis; texto: string }
  | { tipo: "sem_intencao"; texto: string };

export interface TurnoJarvis {
  id: string;
  em: string;
  papel: "usuario" | "jarvis";
  texto: string;
  resultado: ResultadoJarvis["tipo"] | null;
}

export type FonteIntencao = "regra" | "llm";

export interface ConfigJarvis {
  ligado: boolean;
  /** LLM classificadora (só intenção). Desligada por padrão; ligar envia o TEXTO REDIGIDO ao provedor, então exige consentimento. */
  llm_ligado: boolean;
  llm_consentimento: boolean;
  confirmacao_ttl_s: number;
}
export const CONFIG_JARVIS_PADRAO: ConfigJarvis = { ligado: false, llm_ligado: false, llm_consentimento: false, confirmacao_ttl_s: 30 };

export interface EstadoJarvis {
  config: ConfigJarvis;
  confirmacoes: ConfirmacaoVisao[];
  turnos: TurnoJarvis[];
  acoes: Array<{ acao: AcaoJarvis; risco: ClasseRisco }>;
}

export interface EntradaAuditoriaJarvis {
  id: string;
  ts: string;
  ator: AtorJarvis | "sistema";
  dispositivo_id: string | null;
  evento: string;
  acao: string | null;
  risco: ClasseRisco | null;
  origem: OrigemJarvis | null;
  confirmado_por: "nenhum" | "ui" | "desktop";
  ok: boolean;
  codigo: string | null;
  args_hash: string | null;
  resumo: string | null;
  latencia_ms: number | null;
}

// ---- controle remoto
export type TransporteRemoto = "lan" | "loopback";
export interface EstadoTransporte {
  ligado: boolean;
  transporte: TransporteRemoto | null;
  endereco: string | null;
  porta: number | null;
  /** o servidor nunca religa sozinho: nasce desligado a cada início do app. */
  persistido: false;
  pareando: boolean;
  codigo_expira_em: string | null;
  conectados: number;
  ultimo_erro: string | null;
}
export interface DispositivoVisao {
  id: string;
  nome: string;
  permissao: PermissaoRemota;
  criado_em: string;
  ultimo_uso_em: string | null;
  ultimo_ip: string | null;
  expira_em: string;
  revogado_em: string | null;
  conectado: boolean;
}
export interface PedidoPendenteVisao {
  id: string;
  dispositivo: string;
  acao: AcaoJarvis;
  resumo: string;
  expira_em: string;
}
export interface ConfigRemoto {
  interface: string;
  porta: number;
  ocioso_min: number;
  validade_dispositivo_dias: number;
  /** nomes extras aceitos no cabeçalho Host (túnel do próprio usuário); vazio por padrão. */
  hosts_extras: string[];
  permitir_cgnat: boolean;
}
export const CONFIG_REMOTO_PADRAO: ConfigRemoto = { interface: "auto", porta: 0, ocioso_min: 60, validade_dispositivo_dias: 30, hosts_extras: [], permitir_cgnat: false };

export interface EstadoRemoto {
  transporte: EstadoTransporte;
  dispositivos: DispositivoVisao[];
  pendentes: PedidoPendenteVisao[];
  config: ConfigRemoto;
  /** SAS de 6 dígitos para conferir no desktop enquanto há um pareamento esperando decisão. */
  sas: string | null;
  interfaces: Array<{ nome: string; ip: string; privado: boolean }>;
}

export type ErroLigarRemoto = "sem_rede_privada" | "porta_ocupada" | "consentimento_ausente" | "ja_ligado" | "falhou";

export const TEXTO_CONSENTIMENTO_REMOTO_VERSAO = "remoto-v1";
export const TEXTO_CONSENTIMENTO_REMOTO =
  "Ligar o controle remoto abre uma porta nesta máquina. Só ligue em rede confiável. O celular não consegue provar a página que recebe e quem controla a rede pode tentar enganá-lo. Nada sai da máquina por padrão e o servidor desliga ao fechar o app.";

export interface EventoJarvisIpc {
  tipo: "estado" | "confirmacao_pendente" | "resolvida";
}
export interface EventoRemotoIpc {
  tipo: "mudou" | "sas" | "pedido_pendente";
}

export interface ApiJarvis {
  estado(): Promise<EstadoJarvis>;
  configGravar(patch: Partial<ConfigJarvis>): Promise<EstadoJarvis>;
  enviar(texto: string): Promise<ResultadoJarvis>;
  acao(acao: AcaoTipada): Promise<ResultadoJarvis>;
  confirmar(confirmacaoId: string, aprovado: boolean): Promise<{ ok: boolean; resultado: ResultadoJarvis | null; codigo: CodigoRecusaJarvis | null }>;
  historico(depois: string | null): Promise<{ itens: EntradaAuditoriaJarvis[]; proximo: string | null }>;
  limparConversa(): Promise<EstadoJarvis>;
  assinar(cb: (e: EventoJarvisIpc) => void): () => void;
  /** o main pede ao renderer para focar um painel (`abrir_pane`); `ref` é o display_id já validado no main. */
  assinarNavegacao(cb: (e: { ref: string }) => void): () => void;
}

export interface ApiRemoto {
  estado(): Promise<EstadoRemoto>;
  ligar(pedido: { transporte: TransporteRemoto; interface: string; consentimento_versao: string }): Promise<EstadoRemoto | { erro: ErroLigarRemoto }>;
  desligar(): Promise<EstadoRemoto>;
  configGravar(patch: Partial<ConfigRemoto>): Promise<EstadoRemoto>;
  parearIniciar(permissao: PermissaoRemota): Promise<{ codigo: string; expira_em: string } | { erro: ErroLigarRemoto }>;
  parearCancelar(): Promise<boolean>;
  parearConfirmarSas(pedido: { igual: boolean; confirmacao_permissao: string | null }): Promise<DispositivoVisao | null>;
  revogar(dispositivoId: string): Promise<boolean>;
  permissaoDefinir(pedido: { dispositivo_id: string; permissao: PermissaoRemota; confirmacao: string | null }): Promise<DispositivoVisao | null>;
  aprovarPedido(pedidoId: string, aprovado: boolean): Promise<boolean>;
  panico(): Promise<EstadoRemoto>;
  auditoria(depois: string | null): Promise<{ itens: EntradaAuditoriaJarvis[]; proximo: string | null }>;
  assinar(cb: (e: EventoRemotoIpc) => void): () => void;
}
