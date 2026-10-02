import "./missoes.css";
import { lazy, Suspense, useEffect, useState } from "react";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Pagina } from "../../componentes/Pagina";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { aoPedirAcao } from "../../estado/navegacao";
import { aoPedirCusto } from "../../estado/custo-acoes";
import { aoPedirSquads } from "../../estado/squads-acoes";
import { storeMissoes, useMissoes, type StoreMissoes } from "../../estado/missoes";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { CriarMissao } from "./Criar";
import { DetalheMissao } from "./Detalhe";
import { ListaMissoes, QuadroMissoes } from "./Lista";

type Visao = "lista" | "quadro" | "board";
const VISOES: ReadonlyArray<ItemSubNav<Visao>> = [
  { id: "quadro", rotulo: "Quadro", icone: "missoes" }, { id: "lista", rotulo: "Lista", icone: "catalogo" }, { id: "board", rotulo: "Board", icone: "consumo" },
];

// aba Board (Fase 10): lazy, nada no boot; o chunk só carrega ao abrir a aba
const TelaBoard = lazy(() => import("../board"));

export function TelaMissoes({ store = storeMissoes, workspaces = storeWorkspaces }: { store?: StoreMissoes; workspaces?: StoreWorkspaces }) {
  const { atual, carregado } = useWorkspaces(workspaces);
  const est = useMissoes(store);
  const [visao, setVisao] = useState<Visao>("quadro");
  const [criando, setCriando] = useState(false);
  const [modoCriar, setModoCriar] = useState<"livre" | "squad">("livre");
  const [aberta, setAberta] = useState<string | null>(null);

  // a casca já liga o store ao workspace atual; aqui só garante o caso de a tela ser montada sozinha
  useEffect(() => { if (atual !== null && est.workspaceId !== atual.id) void store.definirWorkspace(atual.id); }, [atual, est.workspaceId, store]);

  // paleta: "Custo: abrir o board" (Fase 10)
  useEffect(() => aoPedirCusto(["board"], (p) => { if (p === "board") { setAberta(null); setVisao("board"); } }), []);
  // paleta/menu: "Nova Missão" abre o wizard (e sai do detalhe, se estiver nele)
  useEffect(() => aoPedirAcao("nova-missao", () => { setAberta(null); setModoCriar("livre"); setCriando(true); }), []);
  // paleta: "Nova Missão com squad…" abre o wizard já no modo squad (Fase 14)
  useEffect(() => aoPedirSquads(() => { setAberta(null); setModoCriar("squad"); setCriando(true); }, ["nova-missao-squad"]), []);

  if (aberta !== null) {
    return (
      <Pagina modo="leitura" largura="larga" titulo="Missão">
        <DetalheMissao id={aberta} store={store} detalhe={est.detalhes[aberta]} portoes={est.portoes[aberta]} aoVoltar={() => setAberta(null)} />
      </Pagina>
    );
  }
  return (
    <Pagina modo="leitura" largura="larga" titulo="Quadro" subtitulo="Missões por estágio.">
      {atual === null ? (
        carregado ? <EstadoVazio icone="missoes" titulo="Abra um workspace primeiro" texto="Missões vivem dentro de um workspace. Abra uma pasta em Workspaces e volte aqui." /> : <div aria-busy="true" />
      ) : (
        <>
          <SubNavegacao base="mis" rotulo="Visões das missões" itens={VISOES} ativo={visao} onMudar={setVisao} recolhivel classePainel="mis-corpo"
            barra={<>
              <div className="barra-acoes">
                <button type="button" className="botao botao-primario" onClick={() => { setModoCriar("livre"); setCriando(true); }}>Nova missão</button>
              </div>
              {est.erro !== null ? <p role="alert" className="erro-caixa">{est.erro}</p> : null}
            </>}>
          {visao === "board" ? (
            <div className="mis-board-host"><Suspense fallback={<div aria-busy="true" role="status">Abrindo o board…</div>}><TelaBoard /></Suspense></div>
          ) : !est.carregado ? <div aria-busy="true" /> : est.itens.length === 0 ? (
            <EstadoVazio icone="missoes" titulo="Nenhuma missão ainda" texto="Uma missão reúne uma CLI (ou um piloto com workers) e um objetivo neste workspace. Crie a primeira.">
              <button type="button" className="botao botao-primario" onClick={() => setCriando(true)}>Nova missão</button>
            </EstadoVazio>
          ) : visao === "lista" ? <ListaMissoes itens={est.itens} aoAbrir={setAberta} /> : <QuadroMissoes itens={est.itens} aoAbrir={setAberta} />}
          {est.proximo !== null ? <button type="button" className="botao" onClick={() => void store.carregarMais()}>Carregar mais</button> : null}
          </SubNavegacao>
          {criando ? (
            <CriarMissao workspaceId={atual.id} modoInicial={modoCriar} criar={(p) => store.criar(p)} aoFechar={() => setCriando(false)} aoCriada={(m) => { setCriando(false); setAberta(m.id); }} aoCriadaPorSquad={(id) => { setCriando(false); setAberta(id); void store.observarDetalhe(id); }} />
          ) : null}
        </>
      )}
    </Pagina>
  );
}

export default function Tela() {
  return <TelaMissoes />;
}
