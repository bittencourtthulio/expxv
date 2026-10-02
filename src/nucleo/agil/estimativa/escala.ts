// T-18.13: escalas, snap e conversão. Valor fora da escala é ajustado ao mais próximo E sinalizado (empate sobe: mais conservador).
import type { ConfigAgil, EscalaAgil, ValorEscala } from "../../../compartilhado/agil";

export interface ValorAjustado { valor: number; rotulo: string; ajustado: boolean }

export function escalaDe(config: Pick<ConfigAgil, "escalas" | "escala_id">, id: string = config.escala_id): EscalaAgil {
  return config.escalas.find((e) => e.id === id) ?? (config.escalas[0] as EscalaAgil);
}

export function ajustarAEscala(valor: number, escala: EscalaAgil): ValorAjustado {
  let melhor = escala.valores[0] as ValorEscala;
  let dist = Infinity;
  for (const v of escala.valores) {
    const d = Math.abs(v.valor - valor);
    if (d < dist || (d === dist && v.valor > melhor.valor)) { melhor = v; dist = d; }
  }
  return { valor: melhor.valor, rotulo: melhor.rotulo, ajustado: dist !== 0 };
}

export const valorDoRotulo = (rotulo: string, escala: EscalaAgil): number | null => escala.valores.find((v) => v.rotulo.toLowerCase() === rotulo.trim().toLowerCase())?.valor ?? null;
export const rotuloDoValor = (valor: number, escala: EscalaAgil): string | null => escala.valores.find((v) => v.valor === valor)?.rotulo ?? null;
export const valorNaEscala = (valor: number, escala: EscalaAgil): boolean => escala.valores.some((v) => v.valor === valor);

/** troca de escala por posição relativa (índice proporcional); o chamador grava como NOVA versão (o histórico fica). */
export function converterEntreEscalas(valor: number, de: EscalaAgil, para: EscalaAgil): ValorAjustado {
  const aj = ajustarAEscala(valor, de);
  const i = de.valores.findIndex((v) => v.valor === aj.valor);
  const rel = de.valores.length <= 1 ? 0 : i / (de.valores.length - 1);
  const j = Math.round(rel * (para.valores.length - 1));
  const alvo = para.valores[j] as ValorEscala;
  return { valor: alvo.valor, rotulo: alvo.rotulo, ajustado: true };
}

/** degraus na escala a partir de um valor (clamp nas pontas). */
export function moverDegraus(valor: number, degraus: number, escala: EscalaAgil): ValorEscala {
  const aj = ajustarAEscala(valor, escala);
  const i = escala.valores.findIndex((v) => v.valor === aj.valor);
  const j = Math.min(escala.valores.length - 1, Math.max(0, i + degraus));
  return escala.valores[j] as ValorEscala;
}
