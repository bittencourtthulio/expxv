import { useEffect } from "react";
import { Navegacao } from "./casca/Navegacao";
import { PaletaGatilho } from "./componentes/PaletaGatilho";
import { agendarCargaOciosa } from "./componentes/Terminal/carga";
import { ade } from "./ade";
import { storeConfig } from "./estado/config";
import { ligarMenuNativo } from "./estado/menu";
import { storeTema } from "./estado/tema";
import { storeMissoes } from "./estado/missoes";
import { storeTerminais } from "./estado/terminais";
import { storeWorkspaces } from "./estado/workspaces";
import { marcar } from "./perf";

export function App() {
  useEffect(() => marcar("renderer:casca-montada"), []);
  // chunk do xterm: só em ocioso, depois da primeira pintura (nunca no JS inicial)
  useEffect(() => agendarCargaOciosa(), []);
  // estados globais: cada um inicia uma vez; as missões seguem o workspace atual
  useEffect(() => {
    void storeConfig.iniciar(); // aplica a cor de destaque salva (sem bloquear a pintura)
    void storeTerminais.iniciar();
    void storeWorkspaces.iniciar();
    let ultimo: string | null | undefined;
    const seguir = () => {
      const id = storeWorkspaces.obter().atual?.id ?? null;
      if (id !== ultimo) { ultimo = id; void storeMissoes.definirWorkspace(id); }
    };
    seguir();
    return storeWorkspaces.assinar(seguir);
  }, []);
  // menu nativo e bandeja: um assinante único do evento app:menu
  useEffect(() => ligarMenuNativo({
    api: () => ade()?.menu,
    abrirProjeto: () => void storeWorkspaces.abrir(null),
    alternarTema: () => void storeTema.alternar(),
  }), []);
  return (
    <>
      <Navegacao />
      <PaletaGatilho />
    </>
  );
}
