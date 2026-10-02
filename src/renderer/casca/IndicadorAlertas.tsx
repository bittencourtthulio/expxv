import "./alertas.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icone } from "../componentes/Icone";
import { formatarContagem, rotuloBadge } from "../estado/alertas-formato";
import { storeAlertas, useAlertas, type StoreAlertas } from "../estado/alertas";
import { PainelAlertas } from "./PainelAlertas";

/** Botão "Alertas" do topo: badge (número, 99+), ponto extra se houver crítico, painel suspenso. Liga o store na montagem. */
export function IndicadorAlertas({ store = storeAlertas }: { store?: StoreAlertas }) {
  const { contagem } = useAlertas(store);
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => store.iniciar(), [store]);
  const fechar = useCallback(() => { setAberto(false); botao.current?.focus(); }, []);
  const temNaoLidos = contagem.nao_lidos > 0;
  return (
    <span className="alertas-indicador">
      <button ref={botao} type="button" className="topo-icone alertas-botao" aria-label={rotuloBadge(contagem)} title="Alertas" aria-haspopup="dialog" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <Icone nome="alerta" />
        {temNaoLidos ? <span className="alertas-badge" data-critico={contagem.criticos > 0 || undefined} aria-hidden="true">{formatarContagem(contagem.nao_lidos)}</span> : null}
        {contagem.criticos > 0 ? <span className="alertas-ponto-critico" aria-hidden="true">!</span> : null}
      </button>
      {aberto ? <PainelAlertas aoFechar={fechar} store={store} /> : null}
    </span>
  );
}
