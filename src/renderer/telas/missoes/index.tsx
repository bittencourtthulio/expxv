import "./missoes.css";
import { useEffect, useState } from "react";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Pagina } from "../../componentes/Pagina";
import { aoPedirAcao } from "../../estado/navegacao";
import { storeMissoes, useMissoes, type StoreMissoes } from "../../estado/missoes";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { CriarMissao } from "./Criar";
import { DetalheMissao } from "./Detalhe";
import { ListaMissoes, QuadroMissoes } from "./Lista";

export function TelaMissoes({ store = storeMissoes, workspaces = storeWorkspaces }: { store?: StoreMissoes; workspaces?: StoreWorkspaces }) {
  const { atual, carregado } = useWorkspaces(workspaces);
  const est = useMissoes(store);
  const [visao, setVisao] = useState<"lista" | "quadro">("quadro");
  const [criando, setCriando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  // a casca já liga o store ao workspace atual; aqui só garante o caso de a tela ser montada sozinha
  useEffect(() => { if (atual !== null && est.workspaceId !== atual.id) void store.definirWorkspace(atual.id); }, [atual, est.workspaceId, store]);

  // paleta/menu: "Nova Missão" abre o wizard (e sai do detalhe, se estiver nele)
  useEffect(() => aoPedirAcao("nova-missao", () => { setAberta(null); setCriando(true); }), []);

  if (aberta !== null) {
    return (
      <Pagina titulo="Missão">
        <DetalheMissao id={aberta} store={store} detalhe={est.detalhes[aberta]} portoes={est.portoes[aberta]} aoVoltar={() => setAberta(null)} />
      </Pagina>
    );
  }
  return (
    <Pagina titulo="Quadro" subtitulo="Missões por estágio.">
      {atual === null ? (
        carregado ? <EstadoVazio icone="missoes" titulo="Abra um workspace primeiro" texto="Missões vivem dentro de um workspace. Abra uma pasta em Workspaces e volte aqui." /> : <div aria-busy="true" />
      ) : (
        <>
          <div className="barra-acoes">
            <button type="button" className="botao botao-primario" onClick={() => setCriando(true)}>Nova missão</button>
            <div role="group" aria-label="Visão" className="mis-visao">
              <button type="button" className="botao" aria-pressed={visao === "quadro"} onClick={() => setVisao("quadro")}>Quadro</button>
              <button type="button" className="botao" aria-pressed={visao === "lista"} onClick={() => setVisao("lista")}>Lista</button>
            </div>
          </div>
          {est.erro !== null ? <p role="alert" className="erro-caixa">{est.erro}</p> : null}
          {!est.carregado ? <div aria-busy="true" /> : est.itens.length === 0 ? (
            <EstadoVazio icone="missoes" titulo="Nenhuma missão ainda" texto="Uma missão reúne uma CLI (ou um piloto com workers) e um objetivo neste workspace. Crie a primeira.">
              <button type="button" className="botao botao-primario" onClick={() => setCriando(true)}>Nova missão</button>
            </EstadoVazio>
          ) : visao === "lista" ? <ListaMissoes itens={est.itens} aoAbrir={setAberta} /> : <QuadroMissoes itens={est.itens} aoAbrir={setAberta} />}
          {est.proximo !== null ? <button type="button" className="botao" onClick={() => void store.carregarMais()}>Carregar mais</button> : null}
          {criando ? (
            <CriarMissao workspaceId={atual.id} criar={(p) => store.criar(p)} aoFechar={() => setCriando(false)} aoCriada={(m) => { setCriando(false); setAberta(m.id); }} />
          ) : null}
        </>
      )}
    </Pagina>
  );
}

export default function Tela() {
  return <TelaMissoes />;
}
