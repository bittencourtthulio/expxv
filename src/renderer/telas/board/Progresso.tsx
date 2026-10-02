import { memo } from "react";
import type { ProgressoBoard } from "../../../compartilhado/custo";

/** Barra de progresso: verde = concluído (sólido), azul = validado (traços diagonais) — a diferença não depende só da cor. */
export const Progresso = memo(function Progresso({ progresso, rotulo = "Progresso" }: { progresso: ProgressoBoard; rotulo?: string }) {
  const c = Math.max(0, Math.min(100, progresso.pct_concluido));
  const v = Math.max(0, Math.min(100 - c, progresso.pct_validado));
  const vazio = progresso.total === 0;
  const texto = vazio ? "sem cards" : `${Math.round(c)}% concluído · ${Math.round(v)}% validado`;
  return (
    <span className="bd-progresso" role="img" aria-label={`${rotulo}: ${texto}`} title={texto}>
      <svg width="64" height="8" viewBox="0 0 64 8" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="bd-traco" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" className="bd-p-validado" /><line x1="0" y1="0" x2="0" y2="4" className="bd-p-traco" strokeWidth="1.5" /></pattern>
        </defs>
        <rect x="0" y="0" width="64" height="8" rx="2" className="bd-p-fundo" />
        {vazio ? null : <rect x="0" y="0" width={(64 * c) / 100} height="8" className="bd-p-concluido" />}
        {vazio ? null : <rect x={(64 * c) / 100} y="0" width={(64 * v) / 100} height="8" fill="url(#bd-traco)" />}
      </svg>
      <span className="bd-progresso-texto" aria-hidden="true">{vazio ? "—" : `${Math.round(c)}%/${Math.round(v)}%`}</span>
    </span>
  );
});
