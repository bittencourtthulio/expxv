// Escalas e ticks (puros).
export interface EscalaLinear { (v: number): number; dominio: readonly [number, number]; faixa: readonly [number, number] }

export function escalaLinear(d0: number, d1: number, r0: number, r1: number): EscalaLinear {
  const span = d1 - d0;
  const f = ((v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))) as EscalaLinear;
  return Object.assign(f, { dominio: [d0, d1] as const, faixa: [r0, r1] as const });
}

/** passo "bonito" (1, 2, 5 × 10^k). */
export function passoBonito(intervalo: number, alvo: number): number {
  if (!(intervalo > 0)) return 1;
  const bruto = intervalo / Math.max(1, alvo);
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / mag;
  return (f > 7 ? 10 : f > 3 ? 5 : f > 1.5 ? 2 : 1) * mag;
}

/** ticks do eixo Y a partir de 0 (ou do mínimo, se negativo): devolve valores e o teto arredondado. */
export function ticksY(min: number, max: number, alvo = 5): { ticks: number[]; min: number; max: number } {
  const lo = Math.min(0, min);
  const hi = max <= lo ? lo + 1 : max;
  const passo = passoBonito(hi - lo, alvo);
  const a = Math.floor(lo / passo) * passo;
  const b = Math.ceil(hi / passo) * passo;
  const ticks: number[] = [];
  for (let v = a, i = 0; v <= b + passo / 1e6 && i < 50; v += passo, i++) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, min: a, max: b };
}

/** índices a rotular no eixo X (no máximo `alvo`), sempre com o primeiro e o último. */
export function indicesDeRotulo(n: number, alvo = 8): number[] {
  if (n <= 0) return [];
  if (n <= alvo) return Array.from({ length: n }, (_, i) => i);
  const passo = Math.ceil((n - 1) / (alvo - 1));
  const out: number[] = [];
  for (let i = 0; i < n; i += passo) out.push(i);
  // o último rótulo não pode encostar no penúltimo: se o resto do passo é curto, o penúltimo cede lugar
  if (out[out.length - 1] !== n - 1) {
    if (n - 1 - (out[out.length - 1] as number) < passo * 0.7 && out.length > 2) out.pop();
    out.push(n - 1);
  }
  return out;
}

export const formatarNumero = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${Math.round(v / 1e5) / 10}M`;
  if (a >= 1e4) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v * 100) / 100);
};
