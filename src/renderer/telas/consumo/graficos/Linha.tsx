import { memo } from "react";
import type { PontoSerie } from "./Sparkline";

export interface Serie { id: string; rotulo: string; pontos: readonly PontoSerie[]; /** padrão de traço: distingue em escala de cinza. */ traco: string; previsao?: boolean }
const MARCADORES = ["circle", "square", "diamond", "triangle"] as const;

/** Gráfico de linhas com eixos 0–100%; cada série tem padrão de traço e marcador próprios (legível sem cor). */
export const Linha = memo(function Linha({ series, rotulo, largura = 560, altura = 160, limiar = 85 }: { series: readonly Serie[]; rotulo: string; largura?: number; altura?: number; limiar?: number }) {
  const m = { e: 34, d: 8, t: 8, b: 18 };
  const w = largura - m.e - m.d;
  const h = altura - m.t - m.b;
  const todos = series.flatMap((s) => s.pontos);
  const x0 = todos.length ? Math.min(...todos.map((p) => p.x)) : 0;
  const x1 = todos.length ? Math.max(...todos.map((p) => p.x)) : 1;
  const escalaX = (x: number): number => (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * w);
  const escalaY = (y: number): number => h - (Math.max(0, Math.min(100, y)) / 100) * h;
  const vazio = todos.length === 0;
  return (
    <figure className="grafico" aria-label={rotulo}>
      <svg width="100%" viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label={vazio ? `${rotulo}: sem dado` : rotulo}>
        <g transform={`translate(${m.e} ${m.t})`}>
          {[0, 50, 100].map((v) => (
            <g key={v}><line x1="0" x2={w} y1={escalaY(v)} y2={escalaY(v)} className="grafico-grade" /><text x="-6" y={escalaY(v) + 3} textAnchor="end" className="grafico-eixo">{v}%</text></g>
          ))}
          <line x1="0" x2={w} y1={escalaY(limiar)} y2={escalaY(limiar)} className="grafico-limiar" strokeDasharray="1 3" />
          {vazio ? <text x={w / 2} y={h / 2} textAnchor="middle" className="grafico-eixo">sem dado</text> : series.map((s, i) => {
            const pts = s.pontos.length > 300 ? s.pontos.filter((_, k) => k % Math.ceil(s.pontos.length / 300) === 0) : s.pontos;
            const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${escalaX(p.x).toFixed(1)} ${escalaY(p.y).toFixed(1)}`).join("");
            const ult = pts[pts.length - 1];
            const mk = MARCADORES[i % MARCADORES.length];
            return (
              <g key={s.id} className="grafico-serie" data-previsao={s.previsao || undefined}>
                <path d={d} fill="none" className="grafico-linha" strokeDasharray={s.traco} data-i={i % 4} />
                {ult !== undefined ? (mk === "square" ? <rect x={escalaX(ult.x) - 3} y={escalaY(ult.y) - 3} width="6" height="6" className="grafico-marca" />
                  : mk === "diamond" ? <path d={`M${escalaX(ult.x)} ${escalaY(ult.y) - 4}l4 4-4 4-4-4z`} className="grafico-marca" />
                  : mk === "triangle" ? <path d={`M${escalaX(ult.x)} ${escalaY(ult.y) - 4}l4 8h-8z`} className="grafico-marca" />
                  : <circle cx={escalaX(ult.x)} cy={escalaY(ult.y)} r="3" className="grafico-marca" />) : null}
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption className="grafico-legenda">
        {series.map((s, i) => <span key={s.id}><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" className="grafico-linha" strokeDasharray={s.traco} data-i={i % 4} /></svg> {s.rotulo}{s.previsao ? " (previsão)" : ""}</span>)}
      </figcaption>
    </figure>
  );
});
