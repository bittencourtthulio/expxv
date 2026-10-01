/** Enums do contrato (docs/ade/05-CONTRATOS.md §1). Valores minúsculos, sem acento. */
export const ACESSOS_EXTERNOS = ["nenhum", "leitura", "leitura_escrita"] as const;
export type AcessoExterno = (typeof ACESSOS_EXTERNOS)[number];

export const PERMISSOES = ["seguro", "automatico"] as const;
export type Permissao = (typeof PERMISSOES)[number];

export const MODOS_MISSAO = ["livre", "squad", "agentico"] as const;
export type ModoMissao = (typeof MODOS_MISSAO)[number];

export const ORIGENS_MISSAO = ["livre", "feature", "ocorrencia", "pedido", "projeto"] as const;
export type OrigemMissao = (typeof ORIGENS_MISSAO)[number];

export const ESTADOS_MISSAO = ["intake", "planejando", "executando", "revisando", "concluida", "falhou", "abortada"] as const;
export type EstadoMissao = (typeof ESTADOS_MISSAO)[number];

export const TIPOS_PANE = ["cli", "shell"] as const;
export type TipoPane = (typeof TIPOS_PANE)[number];

export const PAPEIS = ["piloto", "executor", "explorador", "revisor", "nenhum"] as const;
export type Papel = (typeof PAPEIS)[number];

export const ESTADOS_PANE = ["iniciando", "pronto", "trabalhando", "aguardando", "bloqueado", "encerrado"] as const;
export type EstadoPane = (typeof ESTADOS_PANE)[number];

export const ESTADOS_TASK = ["aberta", "reivindicada", "entregue", "validada", "descartada"] as const;
export type EstadoTask = (typeof ESTADOS_TASK)[number];

export const STATUS_HANDOFF = ["ok", "parcial", "bloqueado", "falhou"] as const;
export type StatusHandoff = (typeof STATUS_HANDOFF)[number];

export const RESUMO_HANDOFF_MAX = 400;

/**
 * Transições válidas da Missão. Estados terminais (concluida, falhou, abortada) não saem.
 * Um estado ativo pode ir para falhou/abortada em qualquer ponto.
 */
export const TRANSICOES_MISSAO: Readonly<Record<EstadoMissao, readonly EstadoMissao[]>> = {
  intake: ["planejando", "falhou", "abortada"],
  planejando: ["executando", "falhou", "abortada"],
  executando: ["revisando", "falhou", "abortada"],
  revisando: ["concluida", "falhou", "abortada"],
  concluida: [],
  falhou: [],
  abortada: [],
};

export function transicaoMissaoValida(de: EstadoMissao, para: EstadoMissao): boolean {
  return TRANSICOES_MISSAO[de].includes(para);
}

export function missaoTerminal(estado: EstadoMissao): boolean {
  return TRANSICOES_MISSAO[estado].length === 0;
}
