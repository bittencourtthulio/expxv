import "./suite.css";
import { useEffect } from "react";
import { Icone } from "../componentes/Icone";
import { storeSuite, useSuite, type StoreSuite } from "../estado/suite";

/**
 * Linha de ação "Instalar suíte ExpxDev" (card do workspace e tela Método): só quando a suíte está ausente (ou incompleta). Pede o estado do workspace
 * quando aparece (cache de 60 s no store). O modal é o do cabeçalho (montado uma vez só, em `BotaoInstalarSuite`); se o card for de outro workspace, o clique
 * troca para ele (`aoAtivar`) e o modal abre quando a troca chegar.
 */
export function LinhaSuite({ workspaceId, atual, aoAtivar, compacta = false, store = storeSuite }: { workspaceId: string; atual: boolean; aoAtivar?: () => void; compacta?: boolean; store?: StoreSuite }) {
  const ui = useSuite(store);
  useEffect(() => store.ligar(), [store]);
  useEffect(() => { void store.garantirEstado(workspaceId); }, [store, workspaceId]);
  const e = ui.estados[workspaceId];
  if (!ui.disponivel || e === undefined) return null;
  const falta = e.estado === "ausente" || e.estado === "incompleta";
  if (!falta && !e.instalando) return null;
  const rotulo = e.instalando ? "Instalando suíte ExpxDev…" : e.estado === "incompleta" ? "Reparar suíte ExpxDev" : "Instalar suíte ExpxDev";
  return (
    <div className="linha-suite" data-compacta={compacta || undefined}>
      <button
        type="button" className="botao botao-primario linha-suite-botao" data-ws={workspaceId} aria-haspopup="dialog" title={e.motivo}
        onClick={() => { if (atual) store.abrirModal(); else { store.abrirModalPara(workspaceId); aoAtivar?.(); } }}
      >
        <Icone nome={e.estado === "incompleta" ? "aviso" : "baixar"} />
        <span>{rotulo}</span>
      </button>
    </div>
  );
}
