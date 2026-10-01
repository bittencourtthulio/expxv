/** D-11: no máximo 6 contextos WebGL vivos; o Chromium derruba contextos velhos perto de 16. */
export const LIMITE_WEBGL = 6;

/**
 * Quais painéis visíveis usam WebGL: o em foco primeiro, depois os demais na ordem, até o limite.
 * Os outros caem no renderer DOM.
 */
export function escolherWebgl(visiveis: readonly string[], foco: string | null, limite: number = LIMITE_WEBGL): Set<string> {
  const ordem = foco !== null && visiveis.includes(foco) ? [foco, ...visiveis.filter((v) => v !== foco)] : [...visiveis];
  return new Set(ordem.slice(0, limite));
}

let emUso = 0;
/** Reserva um contexto; false quando o limite já foi atingido (o painel fica no renderer DOM). */
export function reservarContextoWebgl(limite: number = LIMITE_WEBGL): boolean {
  if (emUso >= limite) return false;
  emUso += 1;
  return true;
}
export function liberarContextoWebgl(): void { emUso = Math.max(0, emUso - 1); }
export function contextosWebglEmUso(): number { return emUso; }
/** Só para teste. */
export function zerarContextosWebgl(): void { emUso = 0; }
