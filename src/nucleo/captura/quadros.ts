// Amostrador de quadros (Fase 11, T-11.19): 1 ou 2 fps pela mesma fonte da captura, sem ffmpeg. Backpressure: nunca há mais de uma captura em voo e nenhum quadro fica em memória
// (grava e solta). Para por pedido, por limite de quadros/duração ou por falha (a do PRIMEIRO quadro é "falha clara": o chamador remove a pasta vazia).
import { LIMITES_CAPTURA } from "../../compartilhado/captura";

export type MotivoFim = "parou" | "limite" | "erro";

export interface RelogioQuadros {
  agora(): number;
  /** agenda e devolve o cancelamento. */
  agendar(fn: () => void, ms: number): () => void;
}

export const relogioReal: RelogioQuadros = {
  agora: () => Date.now(),
  agendar: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export interface OpcoesAmostrador {
  fps: 1 | 2;
  /** captura UM quadro já codificado (PNG) ou `null` se a fonte não entregou. Lança em falha. */
  capturar(): Promise<Uint8Array | null>;
  /** grava o quadro `numero` (1..n) e o solta. */
  gravar(numero: number, png: Uint8Array): Promise<void>;
  aoProgredir?(quadros: number, maximo: number, decorridoMs: number): void;
  /** chamado UMA vez ao terminar. `erro` só em `motivo: "erro"`. */
  aoTerminar(r: { motivo: MotivoFim; quadros: number; erro: Error | null }): void;
  relogio?: RelogioQuadros;
  quadros_max?: number;
  duracao_max_ms?: number;
}

export interface Amostrador {
  parar(): void;
  readonly quadros: number;
  readonly ativo: boolean;
}

/** `ceil(duração_s × fps)` no máximo, limitado pelo teto de quadros. */
export function quadrosPrevistos(duracaoMs: number, fps: number, teto: number = LIMITES_CAPTURA.quadros_max): number {
  return Math.min(teto, Math.ceil((duracaoMs / 1000) * fps));
}

export function iniciarAmostrador(op: OpcoesAmostrador): Amostrador {
  const relogio = op.relogio ?? relogioReal;
  const maximo = op.quadros_max ?? LIMITES_CAPTURA.quadros_max;
  const duracaoMax = op.duracao_max_ms ?? LIMITES_CAPTURA.quadros_duracao_max_ms;
  const intervalo = 1000 / op.fps;
  const inicio = relogio.agora();
  let n = 0;
  let ativo = true;
  let emVoo = false;
  let cancelarTimer: (() => void) | null = null;
  let terminou = false;

  const terminar = (motivo: MotivoFim, erro: Error | null): void => {
    if (terminou) return;
    terminou = true;
    ativo = false;
    cancelarTimer?.();
    cancelarTimer = null;
    op.aoTerminar({ motivo, quadros: n, erro });
  };

  const tick = async (): Promise<void> => {
    cancelarTimer = null;
    if (!ativo) return;
    if (emVoo) { agendar(intervalo); return; } // backpressure: pula o quadro, não enfileira
    emVoo = true;
    const t0 = relogio.agora();
    let falha: Error | null = null;
    try {
      const png = await op.capturar();
      if (ativo) {
        if (png === null) throw new Error("A fonte não entregou imagem.");
        await op.gravar(n + 1, png);
        n += 1;
        op.aoProgredir?.(n, maximo, relogio.agora() - inicio);
      }
    } catch (e) {
      falha = e instanceof Error ? e : new Error(String(e));
    } finally {
      emVoo = false;
    }
    if (falha !== null) { terminar("erro", falha); return; }
    if (!ativo) return;
    if (n >= maximo || relogio.agora() - inicio >= duracaoMax) { terminar("limite", null); return; }
    agendar(Math.max(0, intervalo - (relogio.agora() - t0)));
  };

  function agendar(ms: number): void {
    cancelarTimer = relogio.agendar(() => void tick(), ms);
  }

  void tick(); // primeiro quadro imediato (falha de permissão aparece logo)
  return {
    parar: () => {
      if (!ativo) return;
      // se há captura em voo, ela ainda pode terminar de gravar; o fim sai em seguida (≤ 1 s)
      ativo = false;
      cancelarTimer?.();
      cancelarTimer = null;
      const esperar = (): void => { if (emVoo) { setTimeout(esperar, 10).unref?.(); return; } terminar("parou", null); };
      esperar();
    },
    get quadros() { return n; },
    get ativo() { return ativo; },
  };
}
