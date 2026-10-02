import { Icone } from "../componentes/Icone";
import { storePainelWorkspaces, usePainelFixado, type StorePainelWorkspaces } from "../estado/painel-workspaces";
import { ATALHO_PAINEL_WORKSPACES } from "../estado/painel-workspaces-acoes";

/** Alfinete ao lado do seletor de workspace: fixa/solta o painel de workspaces (uma coluna ao lado do menu). Só lê um booleano. */
export function BotaoFixarPainel({ store = storePainelWorkspaces }: { store?: StorePainelWorkspaces }) {
  const fixado = usePainelFixado(store);
  return (
    <button
      type="button" className="topo-icone topo-fixar-painel" aria-pressed={fixado} aria-label="Fixar painel de workspaces"
      title={`${fixado ? "Soltar" : "Fixar"} o painel de workspaces (${ATALHO_PAINEL_WORKSPACES})`} onClick={() => store.alternarFixado()}
    >
      <Icone nome="fixar" />
    </button>
  );
}
