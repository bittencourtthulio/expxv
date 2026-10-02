import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { TIPOS_NO } from "../../../compartilhado/conhecimento";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Icone } from "../../componentes/Icone";
import { SubNavegacao } from "../../componentes/SubNavegacao";
import { storeConhecimento, useConhecimento, type StoreConhecimento } from "../../estado/conhecimento";
import { aoPedirConhecimento } from "../../estado/conhecimento-acoes";
import { storeMissoes, useMissoes } from "../../estado/missoes";
import { pedirTela } from "../../estado/navegacao";
import { storeRag, useRag, type StoreRag } from "../../estado/rag";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { Aprendizados } from "./Aprendizados";
import { Backend } from "./Backend";
import { Busca } from "./Busca";
import { Config } from "./Config";
import { DetalheNo } from "./DetalheNo";
import { Fontes } from "./Fontes";
import { Grafo } from "./Grafo";
import { ListaNos } from "./ListaNos";
import { ABAS_CONHECIMENTO, corDoTipo, filtrarGrafo, formatarPct, rotuloDoTipo, type AbaConhecimento } from "./logica";
import "./conhecimento.css";

const PERIODOS: ReadonlyArray<[string, string]> = [["", "Período: tudo"], ["1", "Últimas 24 h"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"]];

export interface PropsTelaConhecimento { store?: StoreConhecimento; storeBackend?: StoreRag; abaInicial?: AbaConhecimento }

export function TelaConhecimento({ store = storeConhecimento, storeBackend = storeRag, abaInicial = "grafo" }: PropsTelaConhecimento) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const c = useConhecimento(store);
  const rag = useRag(storeBackend);
  const missoes = useMissoes(storeMissoes);
  const [aba, setAba] = useState<AbaConhecimento>(abaInicial);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [recolhido, setRecolhido] = useState(false);
  const [periodo, setPeriodo] = useState("");
  const [buscaAberta, setBuscaAberta] = useState(false);
  const campoBusca = useRef<HTMLInputElement>(null);
  const wsId = atual?.id ?? null;
  const { filtrosGrafo } = c;

  useEffect(() => store.iniciar(), [store]);
  useEffect(() => storeBackend.iniciar(), [storeBackend]);
  useEffect(() => {
    void store.definirWorkspace(wsId).then(() => { if (wsId !== null) void store.carregarGrafo(null); });
    void storeBackend.definirWorkspace(wsId);
    setSelecionadoId(null);
  }, [store, storeBackend, wsId]);
  // filtros no servidor (tipo, período, missão) recarregam o subgrafo
  const chaveFiltros = `${filtrosGrafo.tipos.join()}|${filtrosGrafo.desde}|${filtrosGrafo.missionId}`;
  const primeira = useRef(true);
  useEffect(() => { if (primeira.current) { primeira.current = false; return; } if (wsId !== null) void store.carregarGrafo(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [chaveFiltros]);
  useEffect(() => { if (aba === "fontes" && !c.fontes.carregado && wsId !== null) void store.carregarFontes(); }, [aba, c.fontes.carregado, store, wsId]);
  useEffect(() => { if (aba === "aprendizados" && !c.aprendizados.carregado && wsId !== null) void store.carregarAprendizados(); }, [aba, c.aprendizados.carregado, store, wsId]);

  useEffect(() => aoPedirConhecimento((p) => {
    if (p === "abrir" || p === "grafo") { setAba("grafo"); return; }
    if (p === "buscar") { setBuscaAberta(true); campoBusca.current?.focus(); return; }
    if (p === "reindexar") { setAba("fontes"); void store.reindexar("tudo"); return; }
    if (p === "sincronizar") { setAba("backend"); void storeBackend.sincronizar(); return; }
    setAba(p);
  }), [store, storeBackend]);

  const visiveis = useMemo(() => filtrarGrafo(c.nos, c.arestas, { busca: filtrosGrafo.busca }), [c.nos, c.arestas, filtrosGrafo.busca]);
  const selecionar = useCallback((id: string | null) => {
    setSelecionadoId(id);
    if (id === null) store.fecharDetalhe(); else { setRecolhido(false); void store.abrirNo(id); }
  }, [store]);
  const mudarAba = (a: AbaConhecimento): void => { setAba(a); };
  const abrirBusca = (): void => { if (c.busca.params.consulta.trim() === "") return; setBuscaAberta(true); void store.buscar(); };
  const verNoGrafo = (titulo: string): void => { store.definirFiltrosGrafo({ busca: titulo }); setBuscaAberta(false); setAba("grafo"); };

  const aoTeclar = (e: KeyboardEvent<HTMLElement>): void => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") { e.preventDefault(); campoBusca.current?.focus(); campoBusca.current?.select(); return; }
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (buscaAberta) { setBuscaAberta(false); return; }
    if (selecionadoId !== null) { selecionar(null); return; }
    if (c.focoNoId !== null) void store.focar(null);
  };

  const estado = c.estado;
  const emGrafo = aba === "grafo" || aba === "lista";
  const indexando = c.progresso;
  const missoesLista = missoes.itens.map((m) => ({ id: m.id, titulo: m.titulo }));
  const focoRotulo = c.focoNoId !== null ? (c.nos.find((n) => n.id === c.focoNoId)?.rotulo ?? c.focoNoId) : null;
  const tiposAtivos = new Set(filtrosGrafo.tipos);

  const corpoGrafo = (() => {
    if (c.erroEstado !== null && estado === null) return <div className="con-vazio" role="alert"><p>{c.erroEstado}</p><button type="button" className="con-mini" onClick={() => void store.carregarEstado()}>Tentar de novo</button></div>;
    if (estado !== null && !estado.ativo) {
      return (
        <EstadoVazio icone="grafo" titulo="O conhecimento está desligado neste projeto" texto="Com ele desligado, nada é indexado e os agentes não consultam o histórico do projeto. Tudo fica nesta máquina.">
          <button type="button" className="botao botao-primario" onClick={() => void store.gravarConfig({ ativo: true })}>Ligar conhecimento</button>
        </EstadoVazio>
      );
    }
    if (c.grafoErro !== null && c.nos.length === 0) return <div className="con-vazio" role="alert"><p>{c.grafoErro}</p><span className="con-acoes-linha"><button type="button" className="con-mini" onClick={() => void store.carregarGrafo()}>Tentar de novo</button><button type="button" className="con-mini" onClick={() => void store.reindexar("tudo")}>Reiniciar indexação</button></span></div>;
    if (c.grafoCarregando && c.nos.length === 0) return <p className="con-vazio" role="status" aria-busy="true">Carregando grafo…</p>;
    if (c.nos.length === 0) {
      const filtrando = filtrosGrafo.tipos.length > 0 || filtrosGrafo.desde !== null || filtrosGrafo.missionId !== null;
      if (filtrando || c.focoNoId !== null) return <EstadoVazio icone="busca" titulo="Nada com esses filtros" texto="Nenhum nó combina com os filtros atuais. Afrouxe os filtros para ver o grafo inteiro." />;
      return (
        <EstadoVazio icone="grafo" titulo="Ainda não há conhecimento neste projeto" texto="O grafo nasce da indexação dos documentos do método, dos commits e do que os agentes fizeram. Indexe agora para começar.">
          <button type="button" className="botao botao-primario" disabled={indexando !== null} onClick={() => { void store.reindexar("docs"); void store.reindexar("git"); }}>Indexar docs e commits agora</button>
        </EstadoVazio>
      );
    }
    if (aba === "lista") return <ListaNos nos={visiveis.nos} arestas={visiveis.arestas} selecionadoId={selecionadoId} aoSelecionar={selecionar} />;
    return <Grafo nos={visiveis.nos} arestas={visiveis.arestas} selecionadoId={selecionadoId} semente={wsId ?? "expx"} truncado={c.truncado} aoSelecionar={selecionar} aoFocar={(id) => { setSelecionadoId(null); void store.focar(id); }} aoPosicoes={(p) => void store.gravarPosicoes(p)} />;
  })();

  const corpo = (() => {
    if (!c.disponivel) return <EstadoVazio icone="grafo" titulo="Conhecimento indisponível" texto="Este recurso só funciona dentro do aplicativo. Abra o aplicativo desktop." />;
    if (atual === null) return <EstadoVazio icone="workspaces" titulo="Nenhum projeto aberto" texto="O conhecimento é por projeto. Abra uma pasta em Workspaces para ver o que foi aprendido nela." />;
    if (buscaAberta) return <Busca store={store} estado={c} aoFechar={() => setBuscaAberta(false)} aoVerNoGrafo={verNoGrafo} />;
    switch (aba) {
      case "grafo": case "lista":
        return (
          <>
            {corpoGrafo}
            {c.nos.length > 0 ? <DetalheNo detalhe={c.detalhe} carregando={c.detalheCarregando} recolhido={recolhido} aoAlternar={() => setRecolhido((r) => !r)} aoFechar={() => selecionar(null)} aoSelecionar={selecionar} aoFocar={(id) => { setSelecionadoId(null); void store.focar(id); }} aoVerTrechos={(id) => store.trechosDoDocumento(id)} aoAbrirTela={pedirTela} /> : null}
          </>
        );
      case "fontes": return <Fontes store={store} estado={c} nomeWorkspace={atual.nome} missoes={missoesLista} />;
      case "aprendizados": return <Aprendizados store={store} estado={c} />;
      case "backend": return <Backend store={storeBackend} estado={rag} />;
      case "config": return <Config store={store} estado={c} />;
    }
  })();

  return (
    <section className="conhecimento" data-modo="cheia" aria-label="Conhecimento" onKeyDown={aoTeclar}>
     <SubNavegacao itens={ABAS_CONHECIMENTO} ativo={aba} onMudar={mudarAba} rotulo="Seções do conhecimento" base="con" recolhivel classePainel="con-corpo" barra={<>
      <div className="con-barra" role="toolbar" aria-label="Controles do conhecimento">
        {emGrafo && !buscaAberta ? (
          <>
            <span className="con-tipos" role="group" aria-label="Filtrar por tipo de nó">
              {TIPOS_NO.map((t) => {
                const on = tiposAtivos.has(t);
                return <button key={t} type="button" aria-pressed={on} aria-label={`Tipo ${rotuloDoTipo(t)}`} title={`Tipo ${rotuloDoTipo(t)}`} onClick={() => store.definirFiltrosGrafo({ tipos: on ? filtrosGrafo.tipos.filter((x) => x !== t) : [...filtrosGrafo.tipos, t] })}><span className="con-ponto" style={{ background: corDoTipo(t) }} aria-hidden="true" /></button>;
              })}
            </span>
            <select aria-label="Período" value={periodo} onChange={(e) => { setPeriodo(e.target.value); store.definirFiltrosGrafo({ desde: e.target.value === "" ? null : new Date(Date.now() - Number(e.target.value) * 86_400_000).toISOString() }); }}>
              {PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <select aria-label="Missão" title={filtrosGrafo.missionId === null ? "Missão: todas" : (missoes.itens.find((m) => m.id === filtrosGrafo.missionId)?.titulo ?? filtrosGrafo.missionId)} value={filtrosGrafo.missionId ?? ""} onChange={(e) => store.definirFiltrosGrafo({ missionId: e.target.value === "" ? null : e.target.value })}>
              <option value="">Missão: todas</option>
              {missoes.itens.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
            </select>
            <input type="search" aria-label="Buscar nó" placeholder="Buscar nó…" value={filtrosGrafo.busca} onChange={(e) => store.definirFiltrosGrafo({ busca: e.target.value })} />
            <button type="button" className="con-icone-btn" aria-label="Recarregar grafo" title="Recarregar grafo" disabled={atual === null} onClick={() => void store.carregarGrafo()}><Icone nome="atualizar" /></button>
          </>
        ) : null}
        <input ref={campoBusca} type="search" className="con-busca-global" aria-label="Buscar no conhecimento" title="Buscar no conhecimento (⌘F)" placeholder="Buscar no conhecimento (⌘F)" value={c.busca.params.consulta} disabled={atual === null}
          onChange={(e) => store.definirParametrosBusca({ consulta: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") abrirBusca(); }} />
        <button type="button" className="con-icone-btn" aria-label="Buscar" title="Buscar no conhecimento" disabled={atual === null || c.busca.params.consulta.trim() === ""} onClick={abrirBusca}><Icone nome="busca" /></button>
        {indexando !== null ? <span className="con-progresso-txt" role="status">{formatarPct(indexando.pct)} indexando{indexando.fase !== null ? ` (${indexando.fase})` : ""} · {indexando.pendentes} pendentes</span> : null}
        {estado !== null && indexando === null ? <span className="con-progresso-txt">{estado.documentos} docs · {estado.chunks} trechos</span> : null}
      </div>
      {indexando !== null ? <div className="con-fio" role="progressbar" aria-label="Progresso da indexação" aria-valuemin={0} aria-valuemax={100} {...(indexando.pct !== null ? { "aria-valuenow": Math.round(indexando.pct) } : {})}><span style={{ width: `${indexando.pct ?? 8}%` }} /></div> : null}
      {rag.estado?.offline === true ? <p className="con-faixa" data-tom="info" role="status">offline: usando cópia de {rag.estado.ultima_sincronizacao !== null ? rag.estado.ultima_sincronizacao.slice(0, 10) : "data desconhecida"}</p> : null}
      {focoRotulo !== null && emGrafo ? <p className="con-faixa" data-tom="info" role="status">Vizinhança de “{focoRotulo}” <button type="button" onClick={() => void store.focar(null)}>Ver grafo completo</button></p> : null}
     </>}>{corpo}</SubNavegacao>
    </section>
  );
}
