import { useEffect } from "react";
import { Icone } from "../../componentes/Icone";
import { storeSuite, useSuite, type StoreSuite } from "../../estado/suite";
import "../../casca/suite.css";

/**
 * Bloco "Suíte ExpxDev" da tela Método: mostra o estado da suíte no workspace atual e a ação certa (instalar, reparar ou atualizar), e permite reativar o
 * botão do cabeçalho depois de um "Agora não". Quando a suíte está completa, só uma linha discreta com a versão.
 */
export function SuiteMetodo({ workspaceId, store = storeSuite, semLinhaCompleta = false }: { workspaceId: string; store?: StoreSuite; /** a tela Instalação mostra a versão no próprio resumo: com a suíte completa, nada a dizer aqui */ semLinhaCompleta?: boolean }) {
  const ui = useSuite(store);
  useEffect(() => store.ligar(), [store]);
  useEffect(() => { void store.garantirEstado(workspaceId); }, [store, workspaceId]);
  const e = ui.estados[workspaceId];
  if (!ui.disponivel || e === undefined) return null;
  if (e.estado === "completa" && !e.instalando && semLinhaCompleta) return null;
  if (e.estado === "completa" && !e.instalando) return <p className="suite-suave" data-suite-estado="completa">Suíte ExpxDev instalada{e.versao_instalada !== null ? ` (versão ${e.versao_instalada})` : ""}.</p>;
  const acao = e.instalando ? "Acompanhar a instalação" : e.estado === "incompleta" ? "Reparar suíte ExpxDev" : e.estado === "desatualizada" ? "Atualizar suíte ExpxDev" : "Instalar suíte ExpxDev";
  const titulo = e.estado === "ausente" ? "A suíte ExpxDev não está instalada neste projeto" : e.estado === "incompleta" ? "A suíte ExpxDev está incompleta" : e.estado === "desatualizada" ? "Há uma versão mais nova da suíte ExpxDev" : e.estado === "indisponivel" ? "Não dá para instalar a suíte ExpxDev aqui" : "Suíte ExpxDev";
  return (
    <section className="aviso-suite" data-suite-estado={e.estado} aria-label="Suíte ExpxDev">
      <p><b>{titulo}.</b> {e.motivo}</p>
      <div className="aviso-suite-acoes">
        {e.estado !== "indisponivel" ? (
          <button type="button" className={e.estado === "desatualizada" ? "botao" : "botao botao-primario"} aria-haspopup="dialog" onClick={() => store.abrirModal()}>
            <Icone nome={e.estado === "incompleta" ? "aviso" : "baixar"} /> {acao}
          </button>
        ) : null}
        {e.dispensado && (e.estado === "ausente" || e.estado === "desatualizada") ? (
          <button type="button" className="botao" onClick={() => void store.dispensar(false)}>Mostrar o botão no cabeçalho de novo</button>
        ) : null}
      </div>
    </section>
  );
}
