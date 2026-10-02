import { memo } from "react";

export interface FatiaBarra { id: string; rotulo: string; valor: number | null; texto: string }

/** Barras horizontais de participação (SVG próprio). Valor `null` (sem preço) vira barra tracejada vazia com o texto — nunca barra de tamanho zero fingindo "0". */
export const BarrasParticipacao = memo(function BarrasParticipacao({ fatias, rotulo, max = 8 }: { fatias: readonly FatiaBarra[]; rotulo: string; max?: number }) {
  const itens = fatias.slice(0, max);
  const topo = Math.max(0, ...itens.map((f) => f.valor ?? 0));
  const H = 16;
  const W = 300;
  const x0 = 110;
  const larg = W - x0 - 70;
  return (
    <figure className="grafico" aria-label={rotulo}>
      <svg width="100%" viewBox={`0 0 ${W} ${Math.max(1, itens.length) * H + 4}`} role="img" aria-label={itens.length === 0 ? `${rotulo}: sem dado` : `${rotulo}: ${itens.map((f) => `${f.rotulo} ${f.texto}`).join("; ")}`}>
        {itens.map((f, i) => (
          <g key={f.id} transform={`translate(0 ${i * H + 2})`}>
            <text x={x0 - 4} y="10" textAnchor="end" className="grafico-eixo">{f.rotulo.length > 18 ? `${f.rotulo.slice(0, 17)}…` : f.rotulo}</text>
            {f.valor === null || topo === 0
              ? <rect x={x0} y="2" width={larg} height="9" className="grafico-vazio" fill="none" strokeDasharray="3 3" />
              : <rect x={x0} y="2" width={Math.max(1, (f.valor / topo) * larg)} height="9" className="grafico-barra" />}
            <text x={x0 + larg + 4} y="10" className="grafico-eixo">{f.texto}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
});
