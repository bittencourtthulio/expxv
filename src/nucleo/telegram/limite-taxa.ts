// Limite de taxa da ENTRADA (T-20.25): token bucket por `user_id` (20 mensagens/min, rajada 5), `/pedir` <= 3 por 10 min. Só memória: descartar
// uma mensagem acima do limite não custa nada de banco. Uma única mensagem "devagar" por minuto.
import type { RelogioTg } from "./portas";

export interface OpcoesLimite {
  relogio: RelogioTg;
  msg_por_min?: number;
  rajada?: number;
  max_pedidos?: number;
  janela_pedidos_ms?: number;
}
export interface LimiteTaxa {
  /** `ok=false` => descartar; `avisar` => mandar UM "devagar" (no máx. 1/min por usuário). */
  mensagem(user_id: number): { ok: boolean; avisar: boolean };
  pedido(user_id: number): boolean;
  esquecer(user_id: number): void;
}

export function criarLimiteTaxa(op: OpcoesLimite): LimiteTaxa {
  const taxa = (op.msg_por_min ?? 20) / 60_000; // fichas por ms
  const cap = op.rajada ?? 5;
  const maxPedidos = op.max_pedidos ?? 3;
  const janela = op.janela_pedidos_ms ?? 600_000;
  const baldes = new Map<number, { fichas: number; em: number; avisouEm: number }>();
  const pedidos = new Map<number, number[]>();
  return {
    mensagem(user_id) {
      const t = op.relogio.agora();
      const b = baldes.get(user_id) ?? { fichas: cap, em: t, avisouEm: -Infinity };
      b.fichas = Math.min(cap, b.fichas + (t - b.em) * taxa);
      b.em = t;
      baldes.set(user_id, b);
      if (b.fichas >= 1) {
        b.fichas -= 1;
        return { ok: true, avisar: false };
      }
      const avisar = t - b.avisouEm >= 60_000;
      if (avisar) b.avisouEm = t;
      return { ok: false, avisar };
    },
    pedido(user_id) {
      const t = op.relogio.agora();
      const lista = (pedidos.get(user_id) ?? []).filter((x) => t - x < janela);
      if (lista.length >= maxPedidos) {
        pedidos.set(user_id, lista);
        return false;
      }
      lista.push(t);
      pedidos.set(user_id, lista);
      return true;
    },
    esquecer(user_id) {
      baldes.delete(user_id);
      pedidos.delete(user_id);
    },
  };
}
