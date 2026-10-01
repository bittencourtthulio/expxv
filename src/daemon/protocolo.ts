// Protocolo NDJSON entre o app e o daemon de PTY (uma mensagem JSON por linha).
// O primeiro pedido é sempre `ola` com o token; sem ele a conexão é derrubada.

import type { ExecutavelPty } from "../nucleo/terminais/lancamento";

/** Versão do protocolo entre o app e o daemon de PTY; daemon de outra versão não é reaproveitado. */
export const PROTOCOLO_DAEMON = 1;

/** O que a interface precisa para remontar a aba de uma sessão que sobreviveu ao app. */
export interface MetaSessao {
  ferramenta_id: string;
  executavel_id: string;
  argumentos: string[];
  /** cwd da sessão (decidido pelo main a partir do workspace). */
  raiz: string;
  workspace_id: string | null;
  colunas: number;
  linhas: number;
  criada_em: number;
}

export type EstadoDaemon = "executando" | "encerrada" | "erro";

export interface InfoSessaoDaemon extends MetaSessao {
  sessao_id: string;
  estado: EstadoDaemon;
  codigo: number | null;
  sinal: number | null;
}

export type Pedido =
  | { op: "ola"; protocolo: number; token: string }
  | { op: "listar" }
  | { op: "criar"; id: string; executavel: ExecutavelPty; argumentos: string[]; cwd: string; colunas: number; linhas: number; env: Record<string, string>; meta: MetaSessao }
  | { op: "anexar"; id: string }
  | { op: "soltar"; id: string }
  | { op: "historico"; id: string }
  | { op: "escrever"; id: string; dados: string }
  | { op: "redimensionar"; id: string; colunas: number; linhas: number }
  | { op: "pausar"; id: string }
  | { op: "retomar"; id: string }
  | { op: "matar"; id: string; sinal?: string }
  | { op: "descartar"; id: string }
  | { op: "encerrar_tudo" };

/** `n` casa a resposta com o pedido; pedidos sem `n` (teclado, redimensionar) não têm resposta. */
export type PedidoNumerado = Pedido & { n?: number };

export type Resposta =
  | { re: number; ok: true; [campo: string]: unknown }
  | { re: number; ok: false; erro: string };

export type EventoDaemon =
  /** `fim` é o total acumulado de caracteres da sessão depois deste pedaço: separa o que o histórico já cobre. */
  | { ev: "dados"; id: string; dados: string; fim: number }
  | { ev: "saiu"; id: string; codigo: number | null; sinal: number | null };

export type MensagemDoDaemon = Resposta | EventoDaemon;

/** Separa NDJSON em linhas completas; o resto fica no buffer para o próximo pedaço. */
export function separarLinhas(buffer: string, novo: string): { linhas: string[]; resto: string } {
  const partes = (buffer + novo).split("\n");
  const resto = partes.pop() ?? "";
  return { linhas: partes.filter((l) => l.length > 0), resto };
}
