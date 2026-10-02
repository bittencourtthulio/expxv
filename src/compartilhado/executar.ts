// Contratos de "Executar projeto" visíveis ao renderer (D-430…). Espelham `src/nucleo/executar/modelo.ts` sem importar o núcleo
// (o renderer não importa `nucleo/**`). Qualquer mudança aqui muda também `05-CONTRATOS.md` (seção Executar projeto).

export type TipoExecucao = "rodar" | "build" | "teste" | "outro";
export type FaseExecucao = "ocioso" | "preparando" | "rodando" | "parando" | "concluida" | "falhou" | "parada";

export interface PassoExecucaoIpc { executavel: string; argumentos: string[] }

/** Configuração como o renderer a envia (o main carimba `origem`). */
export interface ConfigExecucaoIpc {
  id: string;
  nome: string;
  tipo: TipoExecucao;
  executavel: string;
  argumentos: string[];
  cwd: string;
  ambiente: Record<string, string>;
  pre_passos: PassoExecucaoIpc[];
  porta: number | null;
  url: string | null;
  abrir_navegador: boolean;
  reiniciar_ao_salvar: boolean;
  grupo: string | null;
  shell: string | null;
}

/** Prechecagem sem executar nada (D-581): `node_modules` ausente, Python sem venv, Docker fora do PATH. `pre_passo` é só uma SUGESTÃO. */
export interface AvisoExecucaoIpc {
  codigo: "sem_node_modules" | "sem_venv" | "sem_docker" | "sem_programa";
  mensagem: string;
  pre_passo: PassoExecucaoIpc | null;
}

export interface ItemConfigExecucao extends ConfigExecucaoIpc {
  origem: "detectada" | "usuario";
  padrao: boolean;
  confiavel: boolean;
  comando: string;
  /** aditivo (D-581): ausente = sem aviso */
  avisos?: AvisoExecucaoIpc[];
}

export interface ListaExecucao {
  workspace_id: string;
  configuracoes: ItemConfigExecucao[];
  padrao_id: string | null;
  armazenamento: "arquivo" | "app" | "nenhum";
  vazio: boolean;
}

export interface EstadoExecucao {
  fase: FaseExecucao;
  workspace_id: string;
  execucao_id: string | null;
  config_id: string | null;
  nome: string | null;
  tipo: TipoExecucao | null;
  passo: number;
  passos_total: number;
  sessao_id: string | null;
  iniciado_em: number | null;
  terminado_em: number | null;
  porta: number | null;
  url: string | null;
  codigo: number | null;
  sinal: number | null;
  mensagem: string | null;
}

export type EventoExecutar =
  | { tipo: "estado"; estado: EstadoExecucao }
  | { tipo: "sessao"; workspace_id: string; sessao_id: string; anterior: string | null; focar: boolean; nome: string }
  | { tipo: "configuracoes"; workspace_id: string };

export interface PedidoConfirmacaoExecutar {
  config_id: string;
  nome: string;
  hash: string;
  linhas: string[];
  cwd: string;
  shell: boolean;
  ambiente: string[];
  corpo: string | null;
  motivo: "primeira_vez" | "comando_mudou";
}

export type ResultadoIniciar =
  | { resultado: "iniciado"; estado: EstadoExecucao }
  | { resultado: "confirmar"; pedido: PedidoConfirmacaoExecutar }
  | { resultado: "configurar" };

export interface EntradaHistoricoExecutar {
  execucao_id: string;
  config_id: string;
  nome: string;
  comando: string;
  iniciado_em: string;
  duracao_ms: number;
  codigo: number | null;
  sinal: number | null;
  resultado: "sucesso" | "falha" | "parada";
}
