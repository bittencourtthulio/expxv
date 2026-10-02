import { useEffect } from "react";
import { Avisos } from "./casca/Avisos";
import { DialogosAlertas } from "./casca/DialogosAlertas";
import { NavegacaoJarvis } from "./casca/NavegacaoJarvis";
import { HostCaptura } from "./telas/captura/Host";
import { Navegacao } from "./casca/Navegacao";
import { PedirMaestro } from "./casca/PedirMaestro";
import { PasseioBichinhos } from "./casca/SlotBichinho";
import { PaletaGatilho } from "./componentes/PaletaGatilho";
import { agendarCargaOciosa } from "./componentes/Terminal/carga";
import { ade } from "./ade";
import { storeConfig } from "./estado/config";
import { ligarMenuNativo } from "./estado/menu";
import { ligarEventosMemoriaEmOcioso } from "./estado/memoria-eventos";
import { ligarAtalhosAgil } from "./estado/agil-acoes";
import { ligarAtalhosConhecimento } from "./estado/conhecimento-acoes";
import { ligarAtalhosBench } from "./estado/bench-acoes";
import { ligarAtalhoPainelWorkspaces } from "./estado/painel-workspaces-acoes";
import { ligarAtalhoAdicionarWorkspace } from "./estado/adicionar-workspace-acoes";
import { storeAdicionarWorkspace } from "./estado/adicionar-workspace";
import { HostAdicionarWorkspace } from "./casca/HostAdicionarWorkspace";
import { ligarAtalhoSistema } from "./estado/sistema-acoes";
import { agendarPrecargaPipelines } from "./estado/precarga-pipelines";
import { storeTema } from "./estado/tema";
import { storeMissoes } from "./estado/missoes";
import { ligarProgressoEmOcioso } from "./estado/progresso";
import { storeTerminais } from "./estado/terminais";
import { storeWorkspaces } from "./estado/workspaces";
import { marcar } from "./perf";

export function App() {
  useEffect(() => marcar("renderer:casca-montada"), []);
  // chunk do xterm: só em ocioso, depois da primeira pintura (nunca no JS inicial)
  useEffect(() => agendarCargaOciosa(), []);
  // chunk da tela Pipelines: também só em ocioso (abrir a tela ≤ 50 ms)
  useEffect(() => agendarPrecargaPipelines(), []);
  // avisos e "brief carregado" da memória: só uma assinatura leve, em ocioso (a tela Memória é lazy)
  useEffect(() => ligarEventosMemoriaEmOcioso(), []);
  // atalhos da gestão ágil (⌘⇧A, ⌘⌥D, ⌘⌥R): um ouvinte de teclado barato; a tela em si é lazy
  useEffect(() => ligarAtalhosAgil(), []);
  // atalhos do Chat (⌘⇧K) e do Conhecimento (⌘⇧G): um ouvinte de teclado barato; as telas em si são lazy
  useEffect(() => ligarAtalhosConhecimento(), []);
  // atalho do Bench (⌘⇧B): um ouvinte de teclado barato; a tela em si é lazy (e Rodar nunca tem atalho)
  useEffect(() => ligarAtalhosBench(), []);
  // atalho do painel de workspaces (⌘⌥W / Ctrl+Alt+W): um ouvinte de teclado barato; o painel em si é lazy e só consulta o main fixado
  useEffect(() => ligarAtalhoPainelWorkspaces(), []);
  // atalho do modal "Adicionar workspace" (⌘⇧O / Ctrl+Shift+O): um ouvinte de teclado barato; o modal em si é lazy
  useEffect(() => ligarAtalhoAdicionarWorkspace(), []);
  // atalho do medidor de CPU e memória (⌘⌥U / Ctrl+Alt+U): um ouvinte de teclado barato
  useEffect(() => ligarAtalhoSistema(), []);
  // painel de progresso da pipeline (D-660…): só em ocioso, depois da primeira pintura; desligado nas Configurações, nada é assinado
  useEffect(() => ligarProgressoEmOcioso(), []);
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
    abrirProjeto: () => void storeWorkspaces.abrir(null), // "Abrir pasta…" (⌘O): direto ao diálogo nativo
    adicionarWorkspace: () => storeAdicionarWorkspace.abrir("pasta"),
    alternarTema: () => void storeTema.alternar(),
  }), []);
  return (
    <>
      <Navegacao />
      <PaletaGatilho />
      <HostAdicionarWorkspace />
      <PedirMaestro />
      <DialogosAlertas />
      <NavegacaoJarvis />
      <Avisos />
      <HostCaptura />
      <PasseioBichinhos />
    </>
  );
}
