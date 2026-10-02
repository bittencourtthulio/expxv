// Tela Squads (Fase 14): lista (220 px) + editor da squad + execuções + caixa de prompt. Chunk lazy; NADA roda no boot: a lista
// carrega ao montar a tela. Casca compacta (D-32): uma linha de controles de ~28 px, linhas de 24 px, sem título de página.
import "./squads.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { Membro, Squad } from "../../../compartilhado/squads";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Icone } from "../../componentes/Icone";
import { pedirTela } from "../../estado/navegacao";
import { storeMissoes, type StoreMissoes } from "../../estado/missoes";
import { aoPedirSquads } from "../../estado/squads-acoes";
import { filtrarLista, storeSquads, useSquads, type FiltroSquads, type StoreSquads } from "../../estado/squads";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { DialogoAbrirAgente } from "./AbrirAgente";
import { CaixaDePrompt } from "./CaixaDePrompt";
import { EditorSquad } from "./Editor";
import { PainelExecucoes } from "./Execucao";
import { ListaSquads } from "./Lista";
import { DialogoLixeira } from "./Lixeira";
import { DialogoNovaSquad } from "./NovaSquad";
import { PainelPrompt } from "./PainelPrompt";
import { DialogoImportar } from "./Portabilidade";
import { aplicarSubstituicoes } from "./rascunho";
import { useRascunhoSquad } from "./useRascunho";

const FILTROS: ReadonlyArray<[FiltroSquads, string]> = [["todas", "Todas"], ["minhas", "Minhas"], ["fabrica", "Fábrica"]];

export interface PropsTelaSquads {
  store?: StoreSquads;
  workspaces?: StoreWorkspaces;
  missoes?: StoreMissoes;
  api?: ApiAde | undefined;
}

export function TelaSquads({ store = storeSquads, workspaces = storeWorkspaces, missoes = storeMissoes, api }: PropsTelaSquads) {
  const apiAde = api ?? ade();
  const { lista, carregando, erro, disponivel, busca, filtro, selecionada } = useSquads(store);
  const { atual } = useWorkspaces(workspaces);
  const workspaceId = atual?.id ?? null;
  const r = useRascunhoSquad(selecionada, store, workspaceId);
  const [prompt, setPrompt] = useState<Membro | null>(null);
  const [nova, setNova] = useState(false);
  const [importar, setImportar] = useState(false);
  const [abrirAgente, setAbrirAgente] = useState(false);
  const [lixeira, setLixeira] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarregarExec, setRecarregarExec] = useState(0);

  useEffect(() => { void store.iniciar(); }, [store]);
  // paleta: "Nova squad", "Importar", "Abrir agente…"
  useEffect(() => aoPedirSquads((p) => { if (p === "nova-squad") setNova(true); else if (p === "importar") setImportar(true); else if (p === "abrir-agente") setAbrirAgente(true); }, ["nova-squad", "importar", "abrir-agente"]), []);
  // trocar de squad fecha o drawer do prompt (ele é do membro da squad anterior)
  useEffect(() => { setPrompt(null); }, [selecionada]);
  useEffect(() => {
    if (aviso === null) return undefined;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const visiveis = useMemo(() => filtrarLista(lista ?? [], busca, filtro), [lista, busca, filtro]);
  const aoNotificar = useCallback((t: string) => setAviso(t), []);
  const resumo = selecionada === null ? null : store.resumoDe(selecionada);

  if (!disponivel) return <EstadoVazio icone="squads" titulo="Squads indisponíveis" texto="Esta tela precisa do aplicativo desktop: abra o app para criar e executar squads." />;

  return (
    <section className="sq-tela" data-modo="cheia" aria-label="Squads">
      <div className="sq-barra" role="toolbar" aria-label="Controles de squads">
        <div className="sq-busca" role="search">
          <Icone nome="busca" />
          <input type="search" aria-label="Buscar squads" placeholder="Buscar squads" value={busca} onChange={(e) => store.definirBusca(e.target.value)} />
        </div>
        <button type="button" className="botao sq-btn" onClick={() => setNova(true)}><Icone nome="mais" /> Nova</button>
        <button type="button" className="botao sq-btn" onClick={() => setImportar(true)}><Icone nome="baixar" /> Importar</button>
        <button type="button" className="botao sq-btn" disabled={(lista ?? []).length === 0} title={(lista ?? []).length === 0 ? "Sem squads para abrir um agente: crie ou importe uma primeiro" : undefined} onClick={() => setAbrirAgente(true)}>Abrir agente…</button>
        <button type="button" className="botao sq-btn" onClick={() => setLixeira(true)}>Lixeira</button>
        <div className="sq-filtros" role="group" aria-label="Origem">
          {FILTROS.map(([id, rot]) => <button key={id} type="button" className="botao sq-btn" aria-pressed={filtro === id} onClick={() => store.definirFiltro(id)}>{rot}</button>)}
        </div>
        {aviso !== null ? <span className="sq-aviso" role="status">{aviso}</span> : null}
      </div>
      {erro !== null ? <p role="alert" className="erro-caixa sq-erro">{erro}</p> : null}
      <div className="sq-corpo">
        <ListaSquads itens={visiveis} selecionada={selecionada} aoSelecionar={(s) => store.selecionar(s)} carregado={lista !== null && !carregando ? true : lista !== null} />
        <div className="sq-detalhe">
          {selecionada === null ? (
            lista !== null && lista.length === 0 ? (
              <EstadoVazio icone="squads" titulo="Nenhuma squad ainda" texto="Crie a sua squad com Nova ou importe uma. As squads de fábrica aparecem aqui quando disponíveis.">
                <button type="button" className="botao botao-primario" onClick={() => setNova(true)}>Nova squad</button>
              </EstadoVazio>
            ) : (
              <EstadoVazio icone="squads" titulo="Escolha uma squad ou crie a sua" texto="Selecione uma squad na lista para ver os membros, editar prompts e enviar um objetivo. As de fábrica são somente leitura: duplique para editar." />
            )
          ) : r.carregando && r.rascunho === null ? <div aria-busy="true" /> : r.erroCarga !== null ? <p role="alert" className="erro-caixa">{r.erroCarga}</p> : (
            <>
              <EditorSquad
                r={r}
                store={store}
                agentes={apiAde?.agentes}
                squads={apiAde?.squads}
                resumo={resumo}
                workspaceId={workspaceId}
                permissaoWorkspace={atual?.permissao ?? null}
                aoAbrirPrompt={(m) => setPrompt(m)}
                aoApagada={() => setAviso("Squad apagada.")}
                aoNotificar={aoNotificar}
              />
              <PainelExecucoes api={apiAde?.squads} missoes={missoes} workspaceId={workspaceId} recarregar={recarregarExec} squadSlug={selecionada} aoIrParaTerminais={() => pedirTela("terminais")} />
            </>
          )}
        </div>
        {prompt !== null && r.rascunho !== null ? (
          <PainelPrompt
            key={`${r.rascunho.slug}.${prompt.slug}`}
            api={apiAde?.agentes}
            agentId={`${r.rascunho.slug}.${prompt.slug}`}
            rotulo={prompt.rotulo || prompt.slug}
            somenteLeitura={!r.editavel}
            copiaDeFabrica={r.rascunho.fabrica !== null}
            aoFechar={() => setPrompt(null)}
          />
        ) : null}
      </div>
      {selecionada !== null ? (
        <CaixaDePrompt
          squad={r.rascunho}
          achados={r.achados}
          sujo={r.sujo}
          editavel={r.editavel}
          workspaceId={workspaceId}
          api={apiAde?.squads}
          aoAdaptar={(subs) => r.editar((s) => aplicarSubstituicoes(s, subs))}
          aoEnviada={() => { setRecarregarExec((n) => n + 1); setAviso("Objetivo enviado: o orquestrador está abrindo."); }}
        />
      ) : null}
      {nova ? <DialogoNovaSquad store={store} aoFechar={() => setNova(false)} aoCriada={(s: Squad) => { setNova(false); store.selecionar(s.slug); }} /> : null}
      {importar ? <DialogoImportar api={apiAde?.squads} workspaceId={workspaceId} aoFechar={() => setImportar(false)} aoImportada={(s) => { setImportar(false); void store.carregar().then(() => store.selecionar(s.slug)); }} /> : null}
      {lixeira ? <DialogoLixeira api={apiAde?.squads} aoFechar={() => setLixeira(false)} aoRestaurada={(s) => { setLixeira(false); void store.carregar().then(() => store.selecionar(s.slug)); setAviso(`Squad restaurada: ${s.nome}`); }} /> : null}
      {abrirAgente ? (
        <DialogoAbrirAgente api={apiAde?.agentes} squads={lista ?? []} squadInicial={selecionada} workspaceId={workspaceId} aoFechar={() => setAbrirAgente(false)} aoAberto={() => { setAbrirAgente(false); pedirTela("terminais"); }} />
      ) : null}
    </section>
  );
}

export default function Tela() {
  return <TelaSquads />;
}
