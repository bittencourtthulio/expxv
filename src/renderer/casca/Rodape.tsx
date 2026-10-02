import { memo, useEffect, useState } from "react";
import { useMissoesAtivas } from "../estado/missoes";
import { useAguardando, useTerminais } from "../estado/terminais";
import { ponte } from "../ponte";
import { DecoracaoVcs } from "../componentes/DecoracaoVcs";
import { useWorkspaces } from "../estado/workspaces";
import { IndicadorCanal } from "./IndicadorCanal";
import { IndicadorCapturaVoz } from "./IndicadorCapturaVoz";
import { IndicadorRelay } from "./IndicadorRelay";
import { MedidorLimites } from "./MedidorLimites";

export const Rodape = memo(function Rodape() {
  const aguardando = useAguardando();
  const paineis = useTerminais().sessoes.filter((s) => s.estado !== "encerrada" && s.estado !== "erro").length;
  const missoes = useMissoesAtivas();
  const atual = useWorkspaces().atual;
  const [versao, setVersao] = useState("");
  useEffect(() => {
    ponte()?.versao().then(setVersao).catch(() => {});
  }, []);
  return (
    <footer className="rodape">
      <span className="rodape-sinal">
        <span className="rodape-ponto" aria-hidden="true" />
        Pronto
      </span>
      {/* região viva polida: sempre no DOM, para o leitor de tela anunciar quando o número mudar */}
      <span className="rodape-item rodape-aguardando rodape-live" role="status" aria-live="polite" aria-atomic="true">{aguardando > 0 ? `${aguardando} aguardando você` : ""}</span>
      <DecoracaoVcs alvo={atual === null ? null : { workspace_id: atual.id, mission_id: null }} className="rodape-item" />
      <span className="rodape-item">Painéis {paineis}</span>
      <span className="rodape-item">Missões {missoes}</span>
      <IndicadorCanal />
      <IndicadorCapturaVoz />
      <IndicadorRelay />
      <MedidorLimites />
      <span className="rodape-versao">{versao ? `v${versao}` : ""}</span>
    </footer>
  );
});
