import { memo } from "react";

export interface Barra { id: string; rotulo: string; valor: number; destaque?: boolean; selo?: string }

/** Barras semanais de pico (0–100) com a meta marcada por uma linha tracejada rotulada (não só cor). */
export const Barras = memo(function Barras({ barras, meta, rotulo, altura = 120 }: { barras: readonly Barra[]; meta: number; rotulo: string; altura?: number }) {
  const larg = Math.max(40, barras.length * 36 + 40);
  const h = altura - 26;
  const y = (v: number): number => h - (Math.max(0, Math.min(100, v)) / 100) * h;
  return (
    <figure className="grafico" aria-label={rotulo}>
      <svg width="100%" viewBox={`0 0 ${larg} ${altura}`} role="img" aria-label={barras.length === 0 ? `${rotulo}: sem dado` : rotulo}>
        <g transform="translate(30 6)">
          <line x1="0" x2={larg - 36} y1={y(meta)} y2={y(meta)} className="grafico-limiar" strokeDasharray="4 3" />
          <text x="-4" y={y(meta) + 3} textAnchor="end" className="grafico-eixo">{meta}%</text>
          {barras.map((b, i) => (
            <g key={b.id} transform={`translate(${i * 36} 0)`}>
              <rect x="4" y={y(b.valor)} width="22" height={h - y(b.valor)} className="grafico-barra" data-destaque={b.destaque || undefined} />
              {b.destaque ? <path d={`M4 ${y(b.valor)}h22`} className="grafico-barra-topo" /> : null}
              <text x="15" y={h + 11} textAnchor="middle" className="grafico-eixo">{b.rotulo}</text>
              {b.selo !== undefined ? <text x="15" y={y(b.valor) - 3} textAnchor="middle" className="grafico-eixo">{b.selo}</text> : null}
            </g>
          ))}
        </g>
      </svg>
    </figure>
  );
});
