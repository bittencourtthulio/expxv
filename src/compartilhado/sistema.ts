// Medidor de CPU e memória da máquina (D-530…): contratos do canal `sistema:*`. Só números inteiros e nomes-base de executável:
// NUNCA argumento de linha de comando, caminho completo nem variável de ambiente (nada disso é lido do SO).

/** Intervalo único de amostragem (ms): uma amostra compartilhada, no máximo uma publicação por intervalo. */
export const INTERVALO_AMOSTRA_MS = 2_000;
/** Janela desfocada que ainda amostra antes da pausa total (ms). */
export const PAUSA_DESFOCADA_MS = 10_000;
/** Histórico do popover: 60 amostras × 2 s = 2 min. */
export const PONTOS_HISTORICO = 60;
/** Máximo de núcleos desenhados no popover ("e mais N" no resto). */
export const MAX_NUCLEOS_VISIVEIS = 16;
/** Limiares de tom (%): âmbar a partir de 80, vermelho a partir de 92. */
export const LIMIAR_AVISO = 80;
export const LIMIAR_ALERTA = 92;
/** Preferência (app:config_*): padrão LIGADO. O prefixo `sistema_` é reservado pelo main, por isso `medidor_`. */
export const CHAVE_MEDIDOR_MOSTRAR = "medidor_sistema_mostrar";
/** Preferência opcional (padrão DESLIGADO): emitir o evento de domínio `sistema.carga_alta`. */
export const CHAVE_MEDIDOR_ALERTA = "medidor_sistema_alerta";

export type TomSistema = "normal" | "aviso" | "alerta";

/** Tom de um uso em %: o número continua sempre visível, a cor é só reforço. */
export function tomDoUso(pct: number): TomSistema {
  return pct >= LIMIAR_ALERTA ? "alerta" : pct >= LIMIAR_AVISO ? "aviso" : "normal";
}

/** Payload do evento `sistema:amostra` (inteiros 0–100). */
export interface AmostraSistema {
  cpu: number;
  ram: number;
}

export type OrigemProcesso = "app" | "agente";

export interface ProcessoVisto {
  /** nome-base do executável ou rótulo fixo do processo do app (nunca caminho nem argumentos). */
  nome: string;
  origem: OrigemProcesso;
  /** rótulo da sessão de terminal dona do processo (agentes); nulo nos processos do app. */
  sessao: string | null;
  /** % de um núcleo (pode passar de 100 em processo multi-thread). */
  cpu: number;
  mem_mb: number;
}

export interface SessaoVista {
  rotulo: string;
  processos: number;
  cpu: number;
  mem_mb: number;
}

export interface DetalheSistema {
  cpu_total: number;
  nucleos: number[];
  ram: { pct: number; usada_mb: number; total_mb: number; disponivel_mb: number };
  swap: { usado_mb: number; total_mb: number } | null;
  app: { cpu: number; mem_mb: number; processos: ProcessoVisto[] };
  agentes: { cpu: number; mem_mb: number; sessoes: SessaoVista[] };
  top_cpu: ProcessoVisto[];
  top_mem: ProcessoVisto[];
}

/** Entrada de `sistema:amostra_assinar`: o renderer liga/desliga a amostragem (chip visível ou oculto pela preferência). */
export interface PedidoAssinarSistema { ativo: boolean }
/** Entrada de `sistema:detalhe`: `aberto: true` enquanto o popover está aberto; `false` encerra e devolve nulo. */
export interface PedidoDetalheSistema { aberto: boolean }
