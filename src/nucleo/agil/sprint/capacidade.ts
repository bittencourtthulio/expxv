// T-18.25: capacidade. Humano: horas_dia × (dias úteis − ausências) × fator de foco ÷ horas por ponto CALIBRADO. Agente: pontos fixos, ou mediana das últimas 3 velocidades.
// Sem base => `sem_base` e pontos null (nunca 0) + aviso.
import type { ConfigAgil, MembroAgil } from "../../../compartilhado/agil";
import { arredondar, mediana } from "../util";

export interface CapacidadeMembro { membro_id: string; dias_uteis: number; ausencias_dias: number; pontos: number | null; base: "horas" | "mediana_3" | "fixo" | "sem_base"; aviso: string | null }

export function capacidadeMembro(m: MembroAgil, p: { dias_uteis: number; ausencias_dias: number; horas_por_ponto: number | null; ultimas_velocidades: readonly number[]; config: Pick<ConfigAgil, "horas_dia_padrao" | "fator_foco_padrao"> }): CapacidadeMembro {
  const base = { membro_id: m.id, dias_uteis: p.dias_uteis, ausencias_dias: p.ausencias_dias };
  const dias = Math.max(0, p.dias_uteis - p.ausencias_dias);
  if (m.pontos_sprint_fixo !== null) return { ...base, pontos: arredondar(m.pontos_sprint_fixo * (p.dias_uteis > 0 ? dias / p.dias_uteis : 0), 2), base: "fixo", aviso: null };
  if (m.tipo === "agente") {
    const med = mediana(p.ultimas_velocidades.slice(-3));
    if (med === null) return { ...base, pontos: null, base: "sem_base", aviso: `agente ${m.rotulo}: sem velocidades anteriores` };
    return { ...base, pontos: arredondar(med * (p.dias_uteis > 0 ? dias / p.dias_uteis : 0), 2), base: "mediana_3", aviso: null };
  }
  if (p.horas_por_ponto === null || p.horas_por_ponto <= 0) return { ...base, pontos: null, base: "sem_base", aviso: `${m.rotulo}: sem calibração de horas por ponto` };
  const horas = (m.horas_dia ?? p.config.horas_dia_padrao) * dias * (m.fator_foco ?? p.config.fator_foco_padrao);
  return { ...base, pontos: arredondar(horas / p.horas_por_ponto, 2), base: "horas", aviso: null };
}

export function capacidadeTotal(cs: readonly CapacidadeMembro[]): { pontos: number | null; sem_base: string[] } {
  const conhecidas = cs.filter((c) => c.pontos !== null);
  return { pontos: conhecidas.length === 0 ? null : arredondar(conhecidas.reduce((a, c) => a + (c.pontos as number), 0), 2), sem_base: cs.filter((c) => c.pontos === null).map((c) => c.membro_id) };
}
