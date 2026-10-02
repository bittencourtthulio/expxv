// Indicadores discretos do rodapé (Fase 11): "● mic" SÓ enquanto grava e `● 12/60 · 2 fps` durante a gravação por quadros. Ocioso: nada. Região viva polida para o leitor de tela.
import { memo, useEffect, type ReactElement } from "react";
import { ligarIndicadoresCapturaVoz, useIndicadoresCapturaVoz } from "../estado/captura-voz";
import { textoQuadros } from "../telas/captura/logica";

export const IndicadorCapturaVoz = memo(function IndicadorCapturaVoz(): ReactElement {
  useEffect(() => ligarIndicadoresCapturaVoz(), []);
  const { mic, quadros } = useIndicadoresCapturaVoz();
  return (
    <span className="rodape-item rodape-live" role="status" aria-live="polite" aria-atomic="true">
      {mic ? <span className="rodape-mic" aria-label="Microfone aberto, gravando a fala">● mic</span> : null}
      {mic && quadros !== null ? " " : null}
      {quadros !== null ? <span className="rodape-quadros" aria-label={`Gravando quadros: ${quadros.n} de ${quadros.max}, ${quadros.fps} por segundo`}>{textoQuadros(quadros.n, quadros.max, quadros.fps)}</span> : null}
    </span>
  );
});
