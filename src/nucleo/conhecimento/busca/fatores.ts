// Fatores multiplicativos da busca (DEC-3/5): tipo, feedback, tempo (decaimento com piso 0,3), Missão e candidato.
import { FATOR_TIPO, MEIA_VIDA_DIAS, PISO_FATOR_TEMPO } from "../constantes";

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export const fatorTipo = (tipo: string): number => FATOR_TIPO[tipo] ?? 1;

/** `clamp(1 + 0,20·útil − 0,30·inútil − 0,60·errado, 0,2, 1,6)`. */
export const fatorFeedback = (f: { util: number; inutil: number; errado: number }): number => clamp(1 + 0.2 * f.util - 0.3 * f.inutil - 0.6 * f.errado, 0.2, 1.6);

export function meiaVidaDe(tipo: string, tipoAprendizado?: string | null): number {
  return MEIA_VIDA_DIAS[tipoAprendizado ?? tipo] ?? (tipo === "transcricao" ? 60 : 180);
}

/** `max(0,3, 0,5^(idade/meia_vida))`: nada some da busca por idade. */
export function fatorTempo(idadeDias: number, meiaVidaDias: number): number {
  if (!(idadeDias > 0)) return 1;
  return Math.max(PISO_FATOR_TEMPO, Math.pow(0.5, idadeDias / meiaVidaDias));
}

export const FATOR_MESMA_MISSAO = 1.15;
export const FATOR_CANDIDATO = 0.7;
