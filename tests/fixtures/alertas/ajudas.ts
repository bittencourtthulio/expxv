// Ajudas de teste da Fase 20: relógio, temporizadores e barramento FALSOS (determinísticos; nenhum timer real).
import type { Relogio } from "../../../src/nucleo/alertas/portas";
import type { TemporizadorPorta } from "../../../src/nucleo/alertas/agendador";

export interface RelogioFalso extends Relogio {
  avancar(ms: number): void;
  definir(ms: number): void;
}
export const relogioFalso = (inicio = Date.parse("2026-10-01T12:00:00.000Z")): RelogioFalso => {
  let t = inicio;
  return { agora: () => t, avancar: (ms) => void (t += ms), definir: (ms) => void (t = ms) };
};

export interface TimersFalsos extends TemporizadorPorta {
  vivos(): number;
  /** dispara, em ordem, todos os timers com vencimento <= `ate` avançando o relógio. */
  avancarAte(ate: number): void;
}
export function timersFalsos(relogio: RelogioFalso): TimersFalsos {
  let n = 0;
  const itens = new Map<number, { quando: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      const id = ++n;
      itens.set(id, { quando: relogio.agora() + ms, fn });
      return id;
    },
    clearTimeout(id) {
      itens.delete(id as number);
    },
    vivos: () => itens.size,
    avancarAte(ate) {
      for (;;) {
        const prox = [...itens.entries()].filter(([, v]) => v.quando <= ate).sort((a, b) => a[1].quando - b[1].quando)[0];
        if (prox === undefined) break;
        itens.delete(prox[0]);
        relogio.definir(Math.max(relogio.agora(), prox[1].quando));
        prox[1].fn();
      }
      relogio.definir(Math.max(relogio.agora(), ate));
    },
  };
}

export interface BarramentoFalso {
  emitir(tipo: string, payload: unknown): void;
  eventos: Array<{ tipo: string; payload: unknown }>;
}
export const barramentoFalso = (): BarramentoFalso => {
  const eventos: BarramentoFalso["eventos"] = [];
  return { emitir: (tipo, payload) => void eventos.push({ tipo, payload }), eventos };
};

let seq = 0;
export const idSeq = (p = "id"): (() => string) => () => `${p}_${++seq}`;

export interface DormirFalso {
  dormir(ms: number, sinal?: AbortSignal): Promise<void>;
  pedidos: number[];
}
/** `dormir` que resolve no próximo ciclo (sem espera real), registra o pedido e respeita o `AbortSignal`. */
export const dormirFalso = (): DormirFalso => {
  const pedidos: number[] = [];
  return {
    pedidos,
    dormir(ms, sinal) {
      pedidos.push(ms);
      return new Promise<void>((resolve, reject) => {
        if (sinal?.aborted === true) return reject(new DOMException("abortado", "AbortError"));
        const t = setTimeout(() => resolve(), 5);
        sinal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("abortado", "AbortError"))), { once: true });
      });
    },
  };
};

export const esperarAte = async (cond: () => boolean, ms = 3000, passo = 5): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("timeout esperando condição");
    await new Promise((r) => setTimeout(r, passo));
  }
};

/** `Array.prototype.findLast` não existe na lib ES2022 do projeto. */
export const findLast = <T>(a: readonly T[], f: (x: T) => boolean | undefined): T | undefined => {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i] as T) === true) return a[i];
  return undefined;
};
