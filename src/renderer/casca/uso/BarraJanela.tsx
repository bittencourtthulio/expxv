import { memo } from "react";
import type { JanelaLimite } from "../../../compartilhado/limites";
import { ariaBarra, estadoCota, formatarPct, formatarReinicio, SEM_DADO, tituloJanela, nomeJanela } from "../../estado/limites-formato";

/** Barra de uso com role=meter, rótulo falado completo e estado nunca só por cor (sinal ▲/! no texto). */
export function BarraUso({ pct, rotulo, tom }: { pct: number | null; rotulo: string; tom: string }) {
  return (
    <span className="uso-barra" data-tom={tom} role="meter" aria-label={rotulo} aria-valuemin={0} aria-valuemax={100} {...(pct !== null ? { "aria-valuenow": Math.round(pct), "aria-valuetext": `${Math.round(pct)} por cento` } : { "aria-valuetext": SEM_DADO })}>
      {pct !== null ? <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /> : null}
    </span>
  );
}

/** Uma janela (5 h, semanal…) de uma conta: rótulo, barra, % usado, reinício (relativo + horário) e previsão opcional. */
export const BarraJanela = memo(function BarraJanela({ janela, provedor, conta, vencida = false, estimado = false, previsao, agora }: {
  janela: JanelaLimite; provedor: string; conta: string; vencida?: boolean; estimado?: boolean; previsao?: string | undefined; agora?: number;
}) {
  const e = estadoCota(janela.used_pct, { vencida, ...(estimado ? { confianca: "estimado" } : {}) });
  const r = formatarReinicio(janela.resets_at, agora);
  const sinal = e.sinal === "▲" || e.sinal === "!" ? ` ${e.sinal}` : "";
  return (
    <div className="uso-janela" data-tom={e.tom} data-vencida={vencida || undefined}>
      <span className="uso-janela-nome" title={nomeJanela(janela.kind)}>{tituloJanela(janela.kind)}{vencida ? " (vencida?)" : ""}</span>
      <BarraUso pct={janela.used_pct} tom={e.tom} rotulo={ariaBarra({ provedor, conta, escopo: nomeJanela(janela.kind), pct: janela.used_pct, reinicio: r })} />
      <span className="uso-pct">{estimado && janela.used_pct !== null ? "≈" : ""}{janela.used_pct === null ? SEM_DADO : formatarPct(janela.used_pct)}{sinal}</span>
      <span className="uso-detalhe">{janela.kind === "credit" ? "" : r.texto}{previsao !== undefined ? ` · ${previsao}` : ""}</span>
    </div>
  );
});
