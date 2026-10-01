/**
 * Barramento de eventos de domínio do main (05-CONTRATOS §7). Nomes com ponto (`pane.spawned`).
 * Coalescência por (tipo, chave): rajadas viram uma entrega só, com o último payload — é o que
 * mantém a UI fluida (03-ORCAMENTOS, regra 3).
 */

export interface Agendador {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const agendadorReal: Agendador = {
  setTimeout: (fn, ms) => {
    const id = setTimeout(fn, ms);
    if (typeof id === "object" && id !== null && "unref" in id) (id as { unref: () => void }).unref();
    return id;
  },
  clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
};

export type Ouvinte<T = unknown> = (payload: T) => void;

export interface Barramento {
  assinar<T = unknown>(tipo: string, ouvinte: Ouvinte<T>): () => void;
  emitir<T = unknown>(tipo: string, payload: T): void;
  /** junta rajadas de (tipo, chave) numa entrega só, com o último payload, após `atrasoMs`. */
  emitirCoalescido<T = unknown>(tipo: string, chave: string, payload: T, atrasoMs: number): void;
  /** entrega imediatamente o que estiver pendente (usado em testes e no encerramento). */
  descarregar(): void;
  pendentes(): number;
}

export function criarBarramento(agendador: Agendador = agendadorReal): Barramento {
  const ouvintes = new Map<string, Set<Ouvinte>>();
  const pendentes = new Map<string, { id: unknown; tipo: string; payload: unknown }>();

  function entregar(tipo: string, payload: unknown): void {
    for (const ouvinte of ouvintes.get(tipo) ?? []) {
      try {
        ouvinte(payload);
      } catch {
        // um ouvinte com erro nunca derruba o barramento nem os demais
      }
    }
  }

  return {
    assinar(tipo, ouvinte) {
      let conjunto = ouvintes.get(tipo);
      if (conjunto === undefined) {
        conjunto = new Set();
        ouvintes.set(tipo, conjunto);
      }
      conjunto.add(ouvinte as Ouvinte);
      return () => {
        conjunto?.delete(ouvinte as Ouvinte);
      };
    },
    emitir(tipo, payload) {
      entregar(tipo, payload);
    },
    emitirCoalescido(tipo, chave, payload, atrasoMs) {
      const k = `${tipo}\u0000${chave}`;
      const existente = pendentes.get(k);
      if (existente !== undefined) {
        existente.payload = payload;
        return;
      }
      const item = { id: undefined as unknown, tipo, payload: payload as unknown };
      item.id = agendador.setTimeout(() => {
        pendentes.delete(k);
        entregar(tipo, item.payload);
      }, atrasoMs);
      pendentes.set(k, item);
    },
    descarregar() {
      for (const [k, item] of [...pendentes]) {
        agendador.clearTimeout(item.id);
        pendentes.delete(k);
        entregar(item.tipo, item.payload);
      }
    },
    pendentes: () => pendentes.size,
  };
}
