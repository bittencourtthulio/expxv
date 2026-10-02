// Circuit breaker do decisor: abre por 5 min em 402/429/timeout/5xx e em resposta inválida REPETIDA; depois fecha (meio-aberto: 1 tentativa decide).
export type MotivoBreaker = "http_402" | "http_429" | "http_5xx" | "http_4xx" | "timeout" | "rede" | "json_invalido" | "resposta_invalida";

export interface EstadoBreaker {
  aberto: boolean;
  /** epoch ms em que fecha; `null` se fechado. */
  ate: number | null;
  motivo: MotivoBreaker | null;
}
export interface Breaker {
  permitir(): boolean;
  sucesso(): void;
  falha(motivo: MotivoBreaker): EstadoBreaker;
  estado(): EstadoBreaker;
  reiniciar(): void;
}

export const DURACAO_BREAKER_MS = 5 * 60_000;

export function criarBreaker(op: { agora?: () => number; duracao_ms?: number; invalidas_para_abrir?: number } = {}): Breaker {
  const agora = op.agora ?? Date.now;
  const duracao = op.duracao_ms ?? DURACAO_BREAKER_MS;
  const limiteInvalidas = op.invalidas_para_abrir ?? 2;
  let ate: number | null = null;
  let motivo: MotivoBreaker | null = null;
  let invalidas = 0;
  const estado = (): EstadoBreaker => {
    if (ate !== null && agora() >= ate) {
      ate = null; // meio-aberto: a próxima tentativa decide
      invalidas = limiteInvalidas - 1;
    }
    return { aberto: ate !== null, ate, motivo: ate !== null ? motivo : null };
  };
  return {
    permitir: () => !estado().aberto,
    sucesso() {
      ate = null;
      motivo = null;
      invalidas = 0;
    },
    falha(m) {
      if (m === "json_invalido" || m === "resposta_invalida") {
        invalidas += 1;
        if (invalidas < limiteInvalidas) return estado();
      }
      ate = agora() + duracao;
      motivo = m;
      invalidas = 0;
      return estado();
    },
    estado,
    reiniciar() {
      ate = null;
      motivo = null;
      invalidas = 0;
    },
  };
}
