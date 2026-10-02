import { memo } from "react";
import { decimar } from "../../../estado/limites-formato";

export interface PontoSerie { x: number; y: number }

/** Caminho SVG de uma série normalizada em [0,w]x[0,h]; `y` em 0..100 (percentual, topo = 100). Puro e testável. */
export function caminhoSerie(pontos: readonly PontoSerie[], w: number, h: number, max = 300): string {
  const p = decimar(pontos, max);
  if (p.length === 0) return "";
  const x0 = p[0]!.x;
  const dx = (p[p.length - 1]!.x - x0) || 1;
  return p.map((q, i) => `${i === 0 ? "M" : "L"}${(((q.x - x0) / dx) * w).toFixed(1)} ${(h - (Math.max(0, Math.min(100, q.y)) / 100) * h).toFixed(1)}`).join("");
}

/** Sparkline de uma série (≤ 300 pontos). Sem dado: traço pontilhado e texto alternativo "sem dado" (nunca linha em zero). */
export const Sparkline = memo(function Sparkline({ pontos, rotulo, largura = 80, altura = 18, tracejado = false }: { pontos: readonly PontoSerie[]; rotulo: string; largura?: number; altura?: number; tracejado?: boolean }) {
  const d = caminhoSerie(pontos, largura, altura);
  return (
    <svg className="grafico-spark" width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label={d === "" ? `${rotulo}: sem dado` : `${rotulo}: último ${Math.round(pontos[pontos.length - 1]!.y)}%`}>
      {d === "" ? <line x1="0" y1={altura / 2} x2={largura} y2={altura / 2} className="grafico-vazio" strokeDasharray="2 3" />
        : <path d={d} className="grafico-linha" fill="none" {...(tracejado ? { strokeDasharray: "4 2" } : {})} />}
    </svg>
  );
});
