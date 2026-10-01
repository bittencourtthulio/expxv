import { memo } from "react";
import { Icone } from "../componentes/Icone";
import { SeletorWorkspace } from "../componentes/SeletorWorkspace";

interface Props {
  tema: "claro" | "escuro";
  aoAlternarTema: () => void;
}

const ATALHO = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘K" : "Ctrl+Shift+P";

export const Topo = memo(function Topo({ tema, aoAlternarTema }: Props) {
  return (
    <header className="casca-topo">
      <SeletorWorkspace />
      <div role="search" className="topo-busca">
        <button type="button" className="topo-botao-busca" aria-label="Buscar comandos">
          <Icone nome="busca" />
          <span>Buscar ou executar comando</span>
          <kbd>{ATALHO}</kbd>
        </button>
      </div>
      <div className="topo-acoes">
        <button type="button" className="topo-icone" aria-label="Alertas" title="Alertas">
          <Icone nome="alerta" />
        </button>
        <button type="button" className="topo-icone" aria-label={tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"} title="Alternar tema" onClick={aoAlternarTema}>
          <Icone nome={tema === "escuro" ? "sol" : "lua"} />
        </button>
      </div>
    </header>
  );
});
