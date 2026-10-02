// Agendador de vencimentos (T-20.08): UM `setTimeout` (unref) para o menor vencimento de qualquer natureza (atraso por task, digest,
// fim do silêncio, expiração de plano, `pane_aguardando_min`). Zero polling. Após suspensão longa, `retomar()` dispara cada vencido UMA vez.
import type { Relogio } from "./portas";
import { relogioReal } from "./portas";

export interface TemporizadorPorta {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
export const temporizadorReal: TemporizadorPorta = {
  setTimeout: (fn, ms) => {
    const id = setTimeout(fn, ms);
    if (typeof id === "object" && id !== null && "unref" in id) (id as { unref: () => void }).unref();
    return id;
  },
  clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
};

export interface Vencimento<T = unknown> {
  chave: string;
  quando_ms: number;
  dado: T;
}

export interface AgendadorVencimentos<T = unknown> {
  /** cria ou SUBSTITUI o vencimento da chave (evento que antecipa/posterga reagenda). */
  agendar(chave: string, quando_ms: number, dado: T): void;
  cancelar(chave: string): boolean;
  /** dispara os vencidos agora (resume do sistema, ou relógio avançado em teste). */
  retomar(): void;
  pendentes(): number;
  /** quantos timers do SO estão vivos (sempre 0 ou 1). */
  timersVivos(): number;
  parar(): void;
}

const MAX_TIMER_MS = 2 ** 31 - 1;

export function criarAgendadorVencimentos<T = unknown>(deps: { aoVencer: (v: Vencimento<T>) => void; timers?: TemporizadorPorta; relogio?: Relogio }): AgendadorVencimentos<T> {
  const timers = deps.timers ?? temporizadorReal;
  const relogio = deps.relogio ?? relogioReal;
  const itens = new Map<string, Vencimento<T>>();
  let id: unknown = null;
  let vivo = 0;
  let disparando = false;

  function limpar(): void {
    if (id !== null) {
      timers.clearTimeout(id);
      id = null;
      vivo = 0;
    }
  }
  function rearmar(): void {
    limpar();
    let menor = Infinity;
    for (const v of itens.values()) if (v.quando_ms < menor) menor = v.quando_ms;
    if (menor === Infinity) return;
    const espera = Math.min(Math.max(0, menor - relogio.agora()), MAX_TIMER_MS);
    vivo = 1;
    id = timers.setTimeout(disparar, espera);
  }
  function disparar(): void {
    id = null;
    vivo = 0;
    const agora = relogio.agora();
    const vencidos = [...itens.values()].filter((v) => v.quando_ms <= agora).sort((a, b) => a.quando_ms - b.quando_ms || (a.chave < b.chave ? -1 : 1));
    for (const v of vencidos) itens.delete(v.chave);
    disparando = true;
    for (const v of vencidos) {
      try {
        deps.aoVencer(v);
      } catch {
        /* um vencimento com erro não derruba os demais */
      }
    }
    disparando = false;
    rearmar();
  }

  return {
    agendar(chave, quando_ms, dado) {
      // reagendar para "agora" de dentro de um disparo viraria laço quente: empurra 1 s (guarda contra bug do chamador)
      const quando = disparando && quando_ms <= relogio.agora() ? relogio.agora() + 1000 : quando_ms;
      itens.set(chave, { chave, quando_ms: quando, dado });
      rearmar();
    },
    cancelar(chave) {
      const r = itens.delete(chave);
      if (r) rearmar();
      return r;
    },
    retomar: disparar,
    pendentes: () => itens.size,
    timersVivos: () => vivo,
    parar() {
      itens.clear();
      limpar();
    },
  };
}
