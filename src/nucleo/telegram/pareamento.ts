// Pareamento por código de uso único (T-20.26). Código de 10 caracteres base32 sem ambíguos (50 bits), `randomBytes`, SÓ em memória
// (guarda apenas o hash), TTL 5 min, 1 uso, <= 5 tentativas erradas na janela (global) e depois fecha. Resposta ao Telegram sempre uniforme
// (silêncio) para errado/expirado/reuso. O DESKTOP decide (Permitir/Negar): sem decisão, nada é gravado. Um pareamento aberto por vez.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RelogioTg } from "./portas";

export const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 símbolos: 5 bits cada
export const TAMANHO_CODIGO = 10;
export const TTL_PAREAMENTO_MS = 300_000;
export const MAX_ERRADAS = 5;

export type EstadoPareamento = "fechado" | "aguardando" | "pedido";
export interface PedidoPareamento {
  pedido_id: string;
  user_id: number;
  chat_id: number;
  /** informativo e sanitizado (<= 40): a decisão usa o `id`. */
  nome: string;
}
export interface DepsPareamento {
  relogio: RelogioTg;
  ttl_ms?: number;
  max_erradas?: number;
  /** fonte de bytes (injetável para testes de propriedade). */
  bytes?: (n: number) => Buffer;
  aoPedido?(p: PedidoPareamento): void;
  aoEstado?(e: EstadoPareamento | "expirado" | "cancelado" | "negado" | "pareado"): void;
}
export interface Pareamento {
  iniciar(): { codigo: string; payload: string; expira_em: string };
  /** SEMPRE silencioso para o Telegram: só devolve `pedido` quando acertou e o desktop precisa decidir. */
  tentar(u: { user_id: number; chat_id: number; nome: string }, texto: string): { pedido: PedidoPareamento | null };
  decidir(pedido_id: string, permitir: boolean): PedidoPareamento | null;
  cancelar(): void;
  estado(): EstadoPareamento;
}

const sha = (t: string): Buffer => createHash("sha256").update(t).digest();
export const normalizarCodigo = (t: string): string => t.trim().toUpperCase().replace(/[-\s]/g, "");
export const formatarCodigo = (c: string): string => `${c.slice(0, 5)}-${c.slice(5)}`;

export function gerarCodigo(bytes: (n: number) => Buffer = randomBytes): string {
  const b = bytes(TAMANHO_CODIGO);
  let c = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) c += ALFABETO[(b[i] as number) & 31];
  return c;
}

export function criarPareamento(deps: DepsPareamento): Pareamento {
  const ttl = deps.ttl_ms ?? TTL_PAREAMENTO_MS;
  const maxErradas = deps.max_erradas ?? MAX_ERRADAS;
  const bytes = deps.bytes ?? randomBytes;
  const FALSO = sha("sem-janela-aberta");
  let hash: Buffer | null = null;
  let expira = 0;
  let erradas = 0;
  let pedido: PedidoPareamento | null = null;
  let estado: EstadoPareamento = "fechado";

  const fechar = (porque: "expirado" | "cancelado" | "negado" | "pareado" | "fechado"): void => {
    hash = null;
    pedido = null;
    erradas = 0;
    estado = "fechado";
    if (porque !== "fechado") deps.aoEstado?.(porque);
  };
  const vivo = (): boolean => {
    if ((hash !== null || estado === "pedido") && deps.relogio.agora() >= expira) fechar("expirado");
    return hash !== null && estado === "aguardando";
  };

  return {
    iniciar() {
      if (estado !== "fechado") fechar("cancelado"); // só um aberto por vez: o novo substitui
      const codigo = gerarCodigo(bytes);
      hash = sha(codigo);
      expira = deps.relogio.agora() + ttl;
      erradas = 0;
      estado = "aguardando";
      deps.aoEstado?.("aguardando");
      return { codigo: formatarCodigo(codigo), payload: codigo, expira_em: new Date(expira).toISOString() };
    },
    tentar(u, texto) {
      // trabalho SEMPRE o mesmo (hash + comparação em tempo constante), exista janela ou não: sem oráculo de tempo
      const candidato = sha(normalizarCodigo(texto).slice(0, 64));
      const aberto = vivo();
      const alvo = aberto && hash !== null ? hash : FALSO;
      const igual = timingSafeEqual(candidato, alvo) && aberto;
      if (!aberto) return { pedido: null };
      if (!igual) {
        erradas++;
        if (erradas >= maxErradas) fechar("fechado");
        return { pedido: null };
      }
      // acertou: o código queima AGORA (uso único); só o desktop pode transformá-lo em autorização
      hash = null;
      estado = "pedido";
      pedido = { pedido_id: `par_${bytes(9).toString("base64url")}`, user_id: u.user_id, chat_id: u.chat_id, nome: u.nome.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩​-‏]/g, "").slice(0, 40) };
      deps.aoEstado?.("pedido");
      deps.aoPedido?.(pedido);
      return { pedido };
    },
    decidir(pedido_id, permitir) {
      if (pedido === null || pedido.pedido_id !== pedido_id) return null;
      const p = pedido;
      if (!permitir) {
        fechar("negado");
        return null;
      }
      fechar("pareado");
      return p;
    },
    cancelar() {
      if (estado !== "fechado") fechar("cancelado");
    },
    estado: () => (vivo() ? "aguardando" : estado),
  };
}
