// Decaimento e reponderação (DEC-5): `fator_tempo = max(0,3, 0,5^(idade/meia_vida))`; meia-vida por tipo, renovada por feedback útil.
import { fatorFeedback, fatorTempo, meiaVidaDe } from "../busca/fatores";

export { fatorFeedback, fatorTempo, meiaVidaDe };

const DIA_MS = 86_400_000;

/** Idade (dias) contada do último uso com feedback útil, se houver; senão da criação. */
export function idadeEfetivaDias(criadoEm: string, ultimoUsoEm: string | null, agora: number): number {
  const base = Math.max(Date.parse(criadoEm) || 0, ultimoUsoEm ? Date.parse(ultimoUsoEm) || 0 : 0);
  return Math.max(0, (agora - base) / DIA_MS);
}

export function fatorTotalAprendizado(a: { tipo: string; criado_em: string; ultimo_uso_em: string | null; util: number; inutil: number; errado: number }, agora: number): number {
  return fatorFeedback(a) * fatorTempo(idadeEfetivaDias(a.criado_em, a.ultimo_uso_em, agora), meiaVidaDe("aprendizado", a.tipo));
}
