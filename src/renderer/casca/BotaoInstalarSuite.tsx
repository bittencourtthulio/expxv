import "./suite.css";
import { lazy, Suspense, useEffect } from "react";
import { Icone } from "../componentes/Icone";
import { apresentarBotaoSuite, storeSuite, useSuite, type StoreSuite } from "../estado/suite";

// O modal só entra no JS quando alguém clica.
const ModalSuite = lazy(() => import("../telas/suite/ModalSuite"));

/**
 * "Instalar suíte ExpxDev" no cabeçalho (grupo DIREITO, antes da cota): aparece SÓ com workspace atual aberto e suíte ausente (ou incompleta/desatualizada,
 * com outro texto), em destaque (azul primário); some quando a suíte fica completa. Não rouba foco: só aparece. Estreito: só o ícone (o rótulo vira tooltip e
 * nome acessível). Clicar abre o modal de instalação; nada é instalado sem o clique em "Instalar agora" lá dentro.
 */
export function BotaoInstalarSuite({ store = storeSuite }: { store?: StoreSuite }) {
  const ui = useSuite(store);
  useEffect(() => store.ligar(), [store]);
  if (!ui.disponivel || ui.workspaceId === null) return null;
  const estado = ui.estados[ui.workspaceId] ?? null;
  const b = apresentarBotaoSuite(estado, ui.progresso);
  return (
    <>
      {b.visivel ? (
        <button
          type="button" className="topo-workspace topo-suite" data-tom={b.tom} data-instalando={b.instalando || undefined} aria-label={b.rotulo} title={b.tooltip}
          aria-haspopup="dialog" onClick={() => store.abrirModal()}
        >
          <Icone nome={b.instalando ? "atualizar" : b.modo === "reparar" ? "aviso" : "baixar"} />
          <span className="topo-suite-rotulo">{b.rotulo}</span>
          <span className="topo-suite-curto" aria-hidden="true">{b.rotuloCurto}</span>
        </button>
      ) : null}
      {ui.modal ? (
        <Suspense fallback={null}>
          <ModalSuite store={store} />
        </Suspense>
      ) : null}
    </>
  );
}
