// Política de pausa do medidor: amostra só com a janela visível e (focada ou desfocada há ≤ 10 s). Oculta/minimizada/desfocada
// por mais que isso = pausa TOTAL (zero timers). Pura.
import { PAUSA_DESFOCADA_MS } from "../../compartilhado/sistema";

export interface EstadoJanelaSistema {
  visivel: boolean;
  minimizada: boolean;
  focada: boolean;
  /** instante (ms) em que a janela perdeu o foco; nulo enquanto focada. */
  desfocadaDesde: number | null;
}

export function deveAmostrar(assinado: boolean, janela: EstadoJanelaSistema, agora: number): boolean {
  if (!assinado || !janela.visivel || janela.minimizada) return false;
  if (janela.focada) return true;
  return janela.desfocadaDesde !== null && agora - janela.desfocadaDesde <= PAUSA_DESFOCADA_MS;
}

/** Alerta opcional `sistema.carga_alta`: CPU ≥ 90% por 30 s contínuos OU RAM ≥ 92%; dispara na SUBIDA e rearma ao normalizar. */
export function criarDetectorCargaAlta(opcoes: { cpuLimiar?: number; cpuDuracaoMs?: number; ramLimiar?: number } = {}) {
  const cpuLimiar = opcoes.cpuLimiar ?? 90;
  const cpuDuracaoMs = opcoes.cpuDuracaoMs ?? 30_000;
  const ramLimiar = opcoes.ramLimiar ?? 92;
  let cpuDesde: number | null = null;
  let armado = true;
  return {
    avaliar(cpu: number, ram: number, agora: number): "cpu" | "ram" | null {
      cpuDesde = cpu >= cpuLimiar ? (cpuDesde ?? agora) : null;
      const cpuAlta = cpuDesde !== null && agora - cpuDesde >= cpuDuracaoMs;
      const ramAlta = ram >= ramLimiar;
      if (!cpuAlta && !ramAlta) { armado = true; return null; }
      if (!armado) return null;
      armado = false;
      return ramAlta ? "ram" : "cpu";
    },
    reiniciar(): void { cpuDesde = null; armado = true; },
  };
}
