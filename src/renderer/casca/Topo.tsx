import { memo } from "react";
import { Icone } from "../componentes/Icone";
import { SeletorWorkspace } from "../componentes/SeletorWorkspace";
import { pedirTela } from "../estado/navegacao";
import { BotaoExecutar } from "./BotaoExecutar";
import { BotoesPublicar } from "./BotoesPublicar";
import { BotaoInstalarSuite } from "./BotaoInstalarSuite";
import { CotaGeralTopo } from "./CotaGeralTopo";
import { IndicadorAlertas } from "./IndicadorAlertas";
import { MedidorSistema } from "./MedidorSistema";
import { BotaoFixarPainel } from "./BotaoFixarPainel";
import { SeletorRigidez } from "./SeletorRigidez";
import type { TelaId } from "./telas";
import "./limites.css";

interface Props {
  tema: "claro" | "escuro";
  aoAlternarTema: () => void;
  /** tela ativa (Commit e push / Enviar PR só aparecem em `terminais`). */
  tela?: TelaId;
}

const ATALHO = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘K" : "Ctrl+Shift+P";

export const Topo = memo(function Topo({ tema, aoAlternarTema, tela = "inicio" }: Props) {
  return (
    <header className="casca-topo">
      <div className="topo-esquerda"><BotaoFixarPainel /><SeletorWorkspace />
        <button type="button" className="topo-terminais" aria-label="Ir para os Terminais" aria-current={tela === "terminais" ? "page" : undefined} title="Voltar aos Terminais" onClick={() => pedirTela("terminais")}>
          <Icone nome="terminais" /><span>Terminais</span>
        </button>
        <BotaoExecutar /><BotoesPublicar tela={tela} /></div>
      <div role="search" className="topo-busca">
        <button type="button" className="topo-botao-busca" aria-label="Buscar comandos">
          <Icone nome="busca" />
          <span>Buscar ou executar comando</span>
          <kbd>{ATALHO}</kbd>
        </button>
      </div>
      <div className="topo-direita">
        <BotaoInstalarSuite />
        <MedidorSistema />
        <CotaGeralTopo />
        <SeletorRigidez />
        <div className="topo-acoes">
          <IndicadorAlertas />
          <button type="button" className="topo-icone" aria-label={tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"} title="Alternar tema" onClick={aoAlternarTema}>
            <Icone nome={tema === "escuro" ? "sol" : "lua"} />
          </button>
        </div>
      </div>
    </header>
  );
});
