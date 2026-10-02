// Orçamento e alertas de custo (T-10.10/T-10.21). PURO. Só ALERTA, nunca bloqueia nem aborta Pane (P-80): a decisão de avisar é determinística e idempotente
// (a deduplicação "uma vez" é do serviço, via `custo_alerta`). Usa o `usd` CONHECIDO (limite inferior): cruzar o teto com custo incompleto já é motivo de aviso.
import type { AlertaCusto, ConfigCusto } from "../../compartilhado/custo";

export type EstadoOrcamento = "sem_teto" | "sem_dado" | "ok" | "aviso" | "estourado";
export interface AvaliacaoOrcamento {
  estado: EstadoOrcamento;
  pct: number | null;
  restante_usd: number | null;
}

export function avaliarOrcamento(usdConhecido: number | null, tetoUsd: number | null, avisoPct: number | null): AvaliacaoOrcamento {
  if (tetoUsd === null || !(tetoUsd > 0)) return { estado: "sem_teto", pct: null, restante_usd: null };
  if (usdConhecido === null) return { estado: "sem_dado", pct: null, restante_usd: null };
  const pct = (usdConhecido / tetoUsd) * 100;
  const restante = Math.max(0, tetoUsd - usdConhecido);
  if (usdConhecido >= tetoUsd) return { estado: "estourado", pct, restante_usd: 0 };
  if (avisoPct !== null && pct >= avisoPct) return { estado: "aviso", pct, restante_usd: restante };
  return { estado: "ok", pct, restante_usd: restante };
}

/** Teto efetivo da Missão: o próprio (`custo_teto`) ou o padrão da configuração; `null` = sem teto. */
export const tetoEfetivo = (proprio: number | null, config: Pick<ConfigCusto, "teto_padrao_missao_usd">): number | null => proprio ?? config.teto_padrao_missao_usd;

export const fmtUsd = (usd: number): string => `US$ ${usd.toFixed(2)}`;

export function alertaDeTeto(av: AvaliacaoOrcamento, missionId: string, usd: number, tetoUsd: number): AlertaCusto | null {
  if (av.estado === "estourado") return { tipo: "teto_missao", alvo: missionId, mission_id: missionId, usd, teto_usd: tetoUsd, mensagem: `A Missão passou do teto de custo (≥ ${fmtUsd(usd)} de ${fmtUsd(tetoUsd)}). Nada foi interrompido.` };
  if (av.estado === "aviso") return { tipo: "aviso_teto_missao", alvo: missionId, mission_id: missionId, usd, teto_usd: tetoUsd, mensagem: `A Missão está em ${Math.round(av.pct ?? 0)}% do teto de custo (${fmtUsd(usd)} de ${fmtUsd(tetoUsd)}).` };
  return null;
}
export const alertaPrecoAusente = (modelo: string): AlertaCusto => ({ tipo: "preco_ausente", alvo: modelo, mensagem: `O modelo "${modelo}" não tem preço cadastrado: o custo dele aparece como desconhecido. Cadastre o preço em Consumo › Fontes e preços.` });
export const alertaFonteAusente = (paneId: string, cli: string): AlertaCusto => ({ tipo: "fonte_ausente", alvo: paneId, mensagem: `A CLI ${cli} não expõe uso lido pelo ADE: o custo deste Pane é desconhecido (nunca zero).` });
