import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntradaMemoria, FonteMemoria } from "../../../compartilhado/memoria";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Icone } from "../../componentes/Icone";
import { SubNavegacao } from "../../componentes/SubNavegacao";
import { storeMemoria, useMemoria, type StoreMemoria } from "../../estado/memoria";
import { aoPedirMemoria } from "../../estado/memoria-acoes";
import { storeMissoes, useMissoes } from "../../estado/missoes";
import { pedirTela } from "../../estado/navegacao";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { GavetaEntrada } from "./GavetaEntrada";
import { PainelSaude } from "./PainelSaude";
import { Preferencias } from "./Preferencias";
import { RestaurarPainel } from "./RestaurarPainel";
import { TabelaMemoria } from "./TabelaMemoria";
import { ABAS_MEMORIA, GLIFO_TIPO, ROTULO_TIPO, TIPOS_DO_FILTRO, abaListaEntradas, filtrarPorOrigem, textoTeto, type AbaMemoria } from "./logica";
import "./memoria.css";

const ORIGENS: ReadonlyArray<[FonteMemoria | "", string]> = [["", "Origem: todas"], ["agente", "Origem: agente"], ["sistema", "Origem: sistema"], ["usuario", "Origem: você"]];

export interface PropsTelaMemoria { store?: StoreMemoria }

export function TelaMemoria({ store = storeMemoria }: PropsTelaMemoria) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const m = useMemoria(store);
  const missoes = useMissoes(storeMissoes);
  const [aberta, setAberta] = useState<EntradaMemoria | null>(null);
  const [restaurar, setRestaurar] = useState(false);
  const wsId = atual?.id ?? null;
  const { filtros } = m;

  useEffect(() => { store.iniciar(); }, [store]);
  useEffect(() => { void store.definirWorkspace(wsId).then(() => store.garantirLista()); }, [store, wsId]);
  useEffect(() => aoPedirMemoria((p) => {
    if (p === "restaurar") { setRestaurar(true); return; }
    if (p === "exportar") { void store.exportar("tudo"); return; }
    store.definirFiltros({ aba: p });
  }), [store]);
  // a entrada aberta acompanha a lista (editar/esquecer/fixar); sumiu = fecha a gaveta
  useEffect(() => { if (aberta !== null) { const nova = m.itens.find((e) => e.id === aberta.id); if (nova === undefined) setAberta(null); else if (nova !== aberta) setAberta(nova); } }, [m.itens, aberta]);

  const aoMudarAba = useCallback((aba: AbaMemoria) => { setAberta(null); store.definirFiltros({ aba }); }, [store]);
  const missaoEscolhida = filtros.missionId;
  useEffect(() => { if (missaoEscolhida !== null) void storeMissoes.observarDetalhe(missaoEscolhida); return () => { if (missaoEscolhida !== null) storeMissoes.pararDetalhe(missaoEscolhida); }; }, [missaoEscolhida]);
  const panesDaMissao = missaoEscolhida === null ? [] : (missoes.detalhes[missaoEscolhida]?.panes ?? []);

  const visiveis = useMemo(() => filtrarPorOrigem(m.itens, filtros.origem), [m.itens, filtros.origem]);
  const listaAba = abaListaEntradas(filtros.aba);
  const estado = m.estado;
  const globalOff = estado !== null && !estado.config.global_ativa;
  const projetoOff = estado !== null && estado.config.global_ativa && !estado.config.ativa;

  const corpo = (() => {
    if (!m.disponivel) return <EstadoVazio icone="memoria" titulo="Memória indisponível" texto="Este recurso só funciona dentro do aplicativo. Abra o aplicativo desktop." />;
    if (atual === null && filtros.aba !== "preferencias") return <EstadoVazio icone="workspaces" titulo="Nenhum projeto aberto" texto="A memória é por projeto. Abra uma pasta em Workspaces para ver o que os agentes aprenderam nela." />;
    if (filtros.aba === "preferencias") return <Preferencias store={store} preferencias={m.preferencias} carregado={m.prefCarregado} erro={m.prefErro} />;
    if (filtros.aba === "saude") return <PainelSaude store={store} estado={estado} erro={m.erroEstado} nomeDoProjeto={atual?.nome ?? ""} />;
    if (m.erro !== null && m.itens.length === 0) {
      return (
        <div className="mem-vazio" role="alert">
          <p>{m.erro}</p>
          <button type="button" className="botao" onClick={() => void store.recarregar()}>Tentar de novo</button>
        </div>
      );
    }
    if (m.carregando && m.itens.length === 0) return <p className="mem-vazio" role="status" aria-busy="true">Carregando memória…</p>;
    if (visiveis.length === 0) {
      const filtrando = filtros.busca.trim() !== "" || filtros.tipos.length > 0 || filtros.origem !== null || filtros.missionId !== null || filtros.paneId !== null;
      return filtrando
        ? <EstadoVazio icone="busca" titulo="Nada com esse filtro" texto="Nenhuma entrada combina com a busca e os filtros atuais. Limpe os filtros para ver tudo deste escopo." />
        : <EstadoVazio icone="memoria" titulo="Memória vazia" texto="Nada gravado ainda: a memória nasce quando um agente decide ou entrega algo." />;
    }
    return (
      <>
        <TabelaMemoria itens={visiveis} selecionadaId={aberta?.id ?? null} aoAbrir={setAberta} aoFim={() => void store.carregarMais()} carregandoMais={m.carregandoMais}
          resetar={`${filtros.aba}|${filtros.busca}|${filtros.tipos.join()}|${filtros.missionId}|${filtros.paneId}|${wsId}`} />
        {aberta !== null ? <GavetaEntrada entrada={aberta} aoFechar={() => setAberta(null)} aoAtualizar={store.atualizar} aoEsquecer={store.esquecer} aoEsquecerPane={store.esquecerPane} /> : null}
      </>
    );
  })();

  const total = estado === null ? null : (filtros.aba === "pane" || filtros.aba === "missao" || filtros.aba === "squad" || filtros.aba === "workspace" ? estado.contagens[filtros.aba] : null);

  return (
    <section className="memoria" data-modo="leitura" data-largura="larga" aria-label="Memória">
     <SubNavegacao itens={ABAS_MEMORIA} ativo={filtros.aba} onMudar={aoMudarAba} rotulo="Escopos da memória" base="mem" recolhivel classePainel="mem-corpo" barra={<>
      <div className="mem-barra" role="toolbar" aria-label="Controles da memória">
        {listaAba ? (
          <>
            <input type="search" aria-label="Buscar na memória" placeholder="Buscar…" value={filtros.busca} onChange={(e) => store.definirFiltros({ busca: e.target.value })} />
            <span className="mem-tipos" role="group" aria-label="Filtrar por tipo">
              {TIPOS_DO_FILTRO.map((t) => {
                const on = filtros.tipos.includes(t);
                return <button key={t} type="button" aria-pressed={on} aria-label={ROTULO_TIPO[t]} title={ROTULO_TIPO[t]} onClick={() => store.definirFiltros({ tipos: on ? filtros.tipos.filter((x) => x !== t) : [...filtros.tipos, t] })}>{GLIFO_TIPO[t]}</button>;
              })}
            </span>
            <select aria-label="Origem" value={filtros.origem ?? ""} title={`Origem: ${filtros.origem === null ? "todas" : (ORIGENS.find(([v]) => v === filtros.origem)?.[1] ?? filtros.origem)}`} onChange={(e) => store.definirFiltros({ origem: e.target.value === "" ? null : (e.target.value as FonteMemoria) })}>
              {ORIGENS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
            <select aria-label="Missão" value={filtros.missionId ?? ""} title={filtros.missionId === null ? "Missão: todas" : (missoes.itens.find((x) => x.id === filtros.missionId)?.titulo ?? filtros.missionId)} onChange={(e) => store.definirFiltros({ missionId: e.target.value === "" ? null : e.target.value })}>
              <option value="">Missão: todas</option>
              {missoes.itens.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}
            </select>
            {filtros.missionId !== null ? (
              (() => { const p = panesDaMissao.find((x) => x.id === filtros.paneId); return (
                <select aria-label="Painel" value={filtros.paneId ?? ""} title={p === undefined ? "Painel: todos" : `#${p.display_id} · ${p.cli ?? "CLI"} · ${p.papel}`} onChange={(e) => store.definirFiltros({ paneId: e.target.value === "" ? null : e.target.value })}>
                  <option value="">Painel: todos</option>
                  {panesDaMissao.map((x) => <option key={x.id} value={x.id}>#{x.display_id} · {x.cli ?? "CLI"} · {x.papel}</option>)}
                </select>
              ); })()
            ) : null}
            <span className="mem-contagem" role="status" aria-live="polite">{visiveis.length}{m.proximo !== null ? "+" : ""}{total !== null ? ` de ${total}` : ""} {visiveis.length === 1 ? "entrada" : "entradas"}</span>
          </>
        ) : null}
        <button type="button" className="mem-icone-btn" aria-label="Restaurar painel" title="Restaurar um painel encerrado com a memória" onClick={() => setRestaurar(true)} disabled={atual === null}><Icone nome="desfazer" /></button>
        <button type="button" className="mem-icone-btn" aria-label="Exportar memória" title="Exportar (escolha onde salvar)" onClick={() => void store.exportar("tudo")} disabled={atual === null || estado === null}><Icone nome="baixar" /></button>
        <button type="button" role="switch" className="mem-icone-btn" aria-checked={estado?.config.ativa ?? false} aria-label="Memória deste projeto" title={estado?.config.ativa === true ? "Memória ligada neste projeto (clique para desligar)" : "Memória desligada neste projeto (clique para ligar)"} disabled={estado === null} onClick={() => void store.gravarConfig({ ativa: !(estado?.config.ativa ?? false) })}>{estado?.config.ativa === true ? "ligada" : "off"}</button>
      </div>

      {m.novas > 0 ? (
        <p className="mem-faixa" data-tom="info" role="status">{m.novas} {m.novas === 1 ? "nova entrada" : "novas entradas"} fora do filtro atual.<button type="button" onClick={() => void store.recarregar()}>Atualizar</button></p>
      ) : null}
      {estado?.aviso_teto === true ? (
        <p className="mem-faixa" role="status">Memória perto do teto: {textoTeto(estado.tamanho_bytes, estado.config.teto_mb)}. Reduza a retenção, apague o que não precisa ou aumente o teto.<button type="button" onClick={() => store.definirFiltros({ aba: "saude" })}>Ver saúde</button><button type="button" onClick={() => pedirTela("config")}>Ajustes</button></p>
      ) : null}
      {globalOff ? <p className="mem-faixa" data-tom="info" role="status">A memória está desligada neste computador: nada novo é coletado, e o que já existe fica guardado.</p> : null}
      {projetoOff ? <p className="mem-faixa" data-tom="info" role="status">A memória está desligada neste projeto: nada novo é coletado, e o que já existe fica guardado.</p> : null}

     </>}>{corpo}</SubNavegacao>
      {restaurar ? <RestaurarPainel aoFechar={() => setRestaurar(false)} /> : null}
    </section>
  );
}

