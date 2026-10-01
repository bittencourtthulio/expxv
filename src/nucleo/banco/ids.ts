import { randomFillSync } from "node:crypto";

/** Prefixo de tipo por entidade (contrato §1: `ws_…`, `mis_…`, `pane_…`). */
export const PREFIXOS_ID = {
  workspace: "ws",
  mission: "mis",
  pane: "pane",
  sessao: "ses",
  conta: "cta",
  task: "task",
  handoff: "hand",
  evento: "evt",
  layout: "lay",
} as const;

export type TipoId = keyof typeof PREFIXOS_ID;

const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
let ultimoMs = -1;
let ultimoAleatorio: number[] = new Array<number>(16).fill(0);

function codificarTempo(ms: number): string {
  let resto = ms;
  let saida = "";
  for (let i = 0; i < 10; i++) {
    saida = ALFABETO.charAt(resto % 32) + saida;
    resto = Math.floor(resto / 32);
  }
  return saida;
}

function sortear(): number[] {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  return Array.from(bytes, (b) => b % 32);
}

/**
 * ULID (26 caracteres) com prefixo de tipo, sem dependência. Monotônico no mesmo milissegundo
 * (incrementa a parte aleatória), portanto ids gerados em sequência ordenam lexicograficamente.
 * `ms` injetável para teste.
 */
export function gerarId(tipo: TipoId, ms: number = Date.now()): string {
  if (ms > ultimoMs) {
    ultimoAleatorio = sortear();
    ultimoMs = ms;
  } else {
    // mesmo ms (ou relógio recuou): continua a sequência do último para manter a ordem
    for (let i = 15; i >= 0; i--) {
      const v = ultimoAleatorio[i] as number;
      if (v < 31) {
        ultimoAleatorio[i] = v + 1;
        break;
      }
      ultimoAleatorio[i] = 0;
    }
    ms = ultimoMs;
  }
  const aleatorio = ultimoAleatorio.map((n) => ALFABETO.charAt(n)).join("");
  return `${PREFIXOS_ID[tipo]}_${codificarTempo(ms)}${aleatorio}`;
}
