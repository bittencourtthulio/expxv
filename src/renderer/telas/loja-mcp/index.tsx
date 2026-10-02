// Tela Loja de MCPs (Fase 7B): chunk lazy; NADA roda no boot (o catálogo carrega ao montar a tela). Casca compacta (D-32): uma linha
// de controles, linhas de 56 px virtualizadas, painel lateral de 360 px. Instalar = plano → consentimento com o comando exato e o
// hash → instalar; o andamento só chega por evento (`assinar`). O renderer nunca guarda segredo nem envia caminho.
import "./loja-mcp.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { DetalheMcp, DiffAtualizacaoMcp, PlanoKitMcp, ResultadoPlanoLoja } from "../../../compartilhado/loja-mcp";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Icone } from "../../componentes/Icone";
import { VirtualLista } from "../../componentes/VirtualLista";
import { aoPedirLojaMcp } from "../../estado/loja-mcp-acoes";
import { storeLojaMcp, useLojaMcp, type StoreLojaMcp } from "../../estado/loja-mcp";
import { storeMissoes, useMissoes, type StoreMissoes } from "../../estado/missoes";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { CartaoLinha } from "./Cartao";
import { DialogoAtualizacao, DialogoConsentimento } from "./Consentimento";
import { DialogoCredenciais } from "./Credenciais";
import { DialogoDescobrir } from "./Descobrir";
import { DialogoGateway } from "./Gateway";
import { PainelMcp } from "./Painel";
import {
  ALTURA_CARTAO, avisosDoDiagnostico, CATEGORIAS, filtrarCartoes, mensagemDoCodigo, mensagemDoErro, rotuloCategoria, temFiltroAtivo, type TipoAcao,
} from "./logica";

type Api = ApiAde["lojaMcp"];

export interface PropsTelaLoja {
  store?: StoreLojaMcp;
  workspaces?: StoreWorkspaces;
  missoes?: StoreMissoes;
  api?: Api | undefined;
}

type Fluxo =
  | { tipo: "instalar"; planos: ResultadoPlanoLoja; ocupado: boolean; erro: string | null }
  | { tipo: "kit"; plano: PlanoKitMcp; ocupado: boolean; erro: string | null }
  | { tipo: "atualizar"; id: string; nome: string; diff: DiffAtualizacaoMcp; ocupado: boolean; erro: string | null }
  | { tipo: "credenciais"; detalhe: DetalheMcp }
  | { tipo: "descobrir" }
  | { tipo: "gateway" };

export function TelaLojaMcp({ store = storeLojaMcp, workspaces = storeWorkspaces, missoes = storeMissoes, api: apiProp }: PropsTelaLoja) {
  const api = apiProp ?? ade()?.lojaMcp;
  const est = useLojaMcp(store);
  const { atual } = useWorkspaces(workspaces);
  const { itens: missoesWs } = useMissoes(missoes);
  const workspaceId = atual?.id ?? null;
  const [fluxo, setFluxo] = useState<Fluxo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [foco, setFoco] = useState<{ id: string; n: number } | null>(null);
  const [rolar, setRolar] = useState<{ indice: number; n: number } | undefined>(undefined);
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void store.iniciar(); }, [store]);
  useEffect(() => {
    if (aviso === null) return undefined;
    const t = setTimeout(() => setAviso(null), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  const { lista, indice, filtros, selecionado } = est;
  const somenteLeitura = lista?.somente_leitura === true;
  const visiveis = useMemo(() => filtrarCartoes(lista?.entradas ?? [], filtros, indice ?? undefined), [lista, filtros, indice]);
  const cartaoSel = selecionado === null ? null : lista?.entradas.find((c) => c.id === selecionado) ?? null;
  const avisosAmb = useMemo(() => avisosDoDiagnostico(est.diagnostico, lista?.entradas ?? []), [est.diagnostico, lista]);
  const cofreOk = est.diagnostico?.cofre.disponivel ?? true;
  const recarregar = useCallback(() => { void store.carregar(); void store.recarregarHabilitados(); }, [store]);

  // ---- fluxos ----
  const abrirInstalacao = useCallback(async (id: string) => {
    if (api === undefined) return;
    try {
      const planos = await api.planoInstalacao([id], workspaceId);
      setFluxo({ tipo: "instalar", planos, ocupado: false, erro: null });
    } catch (e) { setAviso(mensagemDoErro(e)); }
  }, [api, workspaceId]);

  const confirmarInstalacao = useCallback(async () => {
    if (api === undefined || fluxo?.tipo !== "instalar") return;
    const ids = fluxo.planos.planos.map((p) => p.id);
    const hashes: Record<string, string> = {};
    for (const p of fluxo.planos.planos) hashes[p.id] = p.comando_hash;
    setFluxo({ ...fluxo, ocupado: true, erro: null });
    try {
      const r = await api.instalar({ ids, consentimento: { aceito: true, comando_hashes: hashes }, workspace_id: workspaceId });
      store.marcarInicio(ids, r.instalacao_id);
      setFluxo(null);
      setAviso(`Instalando ${fluxo.planos.planos.map((p) => p.nome).join(", ")}…`);
    } catch (e) { setFluxo({ ...fluxo, ocupado: false, erro: mensagemDoErro(e) }); }
  }, [api, fluxo, store, workspaceId]);

  const abrirKit = useCallback(async () => {
    if (api === undefined) return;
    try {
      const plano = await api.kitPlano(workspaceId);
      if (plano.planos.length === 0 && plano.bloqueios.length === 0) { setAviso("O Kit de desenvolvimento já está instalado."); return; }
      setFluxo({ tipo: "kit", plano, ocupado: false, erro: null });
    } catch (e) { setAviso(mensagemDoErro(e)); }
  }, [api, workspaceId]);

  const confirmarKit = useCallback(async () => {
    if (api === undefined || fluxo?.tipo !== "kit") return;
    setFluxo({ ...fluxo, ocupado: true, erro: null });
    try {
      const r = await api.kitInstalar({ aceito: true, comando_hash: fluxo.plano.comando_hash }, workspaceId);
      store.marcarInicio(fluxo.plano.planos.map((p) => p.id), r.instalacao_id);
      setFluxo(null);
      setAviso("Instalando o Kit de desenvolvimento…");
    } catch (e) { setFluxo({ ...fluxo, ocupado: false, erro: mensagemDoErro(e) }); }
  }, [api, fluxo, store, workspaceId]);

  const abrirAtualizacao = useCallback(async (id: string) => {
    if (api === undefined) return;
    try {
      const diff = await api.planoAtualizacao(id, workspaceId);
      if (diff === null || !diff.disponivel) { setAviso(mensagemDoCodigo("sem_atualizacao")); return; }
      const nome = store.obter().lista?.entradas.find((c) => c.id === id)?.nome ?? id;
      setFluxo({ tipo: "atualizar", id, nome, diff, ocupado: false, erro: null });
    } catch (e) { setAviso(mensagemDoErro(e)); }
  }, [api, store, workspaceId]);

  const confirmarAtualizacao = useCallback(async () => {
    if (api === undefined || fluxo?.tipo !== "atualizar") return;
    setFluxo({ ...fluxo, ocupado: true, erro: null });
    try {
      const r = await api.atualizar(fluxo.id, { aceito: true, comando_hash: fluxo.diff.comando_hash }, workspaceId);
      store.marcarInicio([fluxo.id], r.instalacao_id);
      setFluxo(null);
      setAviso(`Atualizando ${fluxo.nome}…`);
    } catch (e) { setFluxo({ ...fluxo, ocupado: false, erro: mensagemDoErro(e) }); }
  }, [api, fluxo, store, workspaceId]);

  const abrirCredenciais = useCallback(async (id: string) => {
    if (api === undefined) return;
    try {
      const d = await api.detalhe(id, workspaceId);
      if (d === null) { setAviso(mensagemDoCodigo("catalogo_desconhecido")); return; }
      setFluxo({ tipo: "credenciais", detalhe: d });
    } catch (e) { setAviso(mensagemDoErro(e)); }
  }, [api, workspaceId]);

  const habilitarRapido = useCallback(async (id: string) => {
    if (api === undefined) return;
    if (workspaceId === null) { store.selecionar(id); setAviso("Abra um projeto para habilitar neste workspace."); return; }
    try {
      const r = await api.habilitar(id, "workspace", workspaceId, true);
      if (r.ok) { setAviso("Habilitado neste workspace."); void store.recarregarHabilitados(); }
      else if (r.codigo === "nao_configurado") void abrirCredenciais(id);
      else setAviso(mensagemDoCodigo(r.codigo));
    } catch (e) { setAviso(mensagemDoErro(e)); }
  }, [abrirCredenciais, api, store, workspaceId]);

  const aoAcao = useCallback((id: string, tipo: TipoAcao) => {
    if (tipo === "instalar" || tipo === "tentar_de_novo") void abrirInstalacao(id);
    else if (tipo === "configurar") void abrirCredenciais(id);
    else if (tipo === "atualizar") void abrirAtualizacao(id);
    else if (tipo === "habilitar") void habilitarRapido(id);
    else if (tipo === "gerenciar") store.selecionar(id);
  }, [abrirAtualizacao, abrirCredenciais, abrirInstalacao, habilitarRapido, store]);

  // paleta: "Loja de MCPs: abrir | Kit"
  useEffect(() => aoPedirLojaMcp((a) => { if (a === "kit") void abrirKit(); else if (a === "gateway") setFluxo({ tipo: "gateway" }); else buscaRef.current?.focus(); }), [abrirKit]);

  // ---- teclado: setas movem o foco entre cartões (a lista é virtualizada: rola e foca ao renderizar), Enter abre o painel ----
  const aoTeclar = useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const i = visiveis.findIndex((c) => c.id === id);
    if (i < 0) return;
    const j = e.key === "ArrowDown" ? Math.min(visiveis.length - 1, i + 1) : e.key === "ArrowUp" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : visiveis.length - 1;
    e.preventDefault();
    const alvo = visiveis[j];
    if (alvo === undefined) return;
    setRolar((r) => ({ indice: Math.max(0, j - 2), n: (r?.n ?? 0) + 1 }));
    setFoco((f) => ({ id: alvo.id, n: (f?.n ?? 0) + 1 }));
  }, [visiveis]);
  useEffect(() => {
    if (foco === null) return;
    const el = document.querySelector<HTMLElement>(`[data-mcp-id="${CSS.escape(foco.id)}"] .lst-corpo`);
    el?.focus();
  }, [foco]);

  if (api === undefined || !est.disponivel) {
    return <EstadoVazio icone="loja" titulo="Loja de MCPs indisponível" texto="Esta tela precisa do aplicativo desktop: abra o app para instalar e habilitar servidores MCP." />;
  }

  const f = filtros;
  const alternar = (k: "instalavel" | "instalado" | "gratuito" | "noKit", rotulo: string, titulo: string) => (
    <button key={k} type="button" className="botao lm-btn" aria-pressed={f[k]} title={titulo} onClick={() => store.definirFiltros({ [k]: !f[k] })}>{rotulo}</button>
  );
  const total = lista?.entradas.length ?? 0;

  return (
    <section className="lm-tela" data-modo="leitura" data-largura="larga" aria-label="Loja de MCPs">
      <div className="lm-barra" role="toolbar" aria-label="Controles da Loja de MCPs">
        <div className="lm-busca" role="search">
          <Icone nome="busca" />
          <input ref={buscaRef} type="search" aria-label="Buscar servidores MCP" placeholder="Buscar servidores MCP" value={f.busca} onChange={(e) => store.definirFiltros({ busca: e.target.value })} />
        </div>
        <select className="lm-select" aria-label="Categoria" title={f.categoria === "todas" ? "Todas as categorias" : rotuloCategoria(f.categoria)} value={f.categoria} onChange={(e) => store.definirFiltros({ categoria: e.target.value as typeof f.categoria })}>
          <option value="todas">Todas as categorias</option>
          {CATEGORIAS.map(([id, rot]) => <option key={id} value={id}>{rot}</option>)}
        </select>
        <div className="lm-filtros" role="group" aria-label="Filtros">
          {alternar("instalavel", "Instalável", "Só o que pode ser instalado")}
          {alternar("instalado", "Instalado", "Só o que já está instalado")}
          {alternar("gratuito", "Grátis", "Gratuito ou com plano grátis")}
          {alternar("noKit", "Kit", "Só o Kit de desenvolvimento")}
        </div>
        <span className="lm-contador" role="status" aria-live="polite">{lista === null ? "" : `${visiveis.length} de ${total}`}</span>
        <button type="button" className="botao botao-primario lm-btn" disabled={somenteLeitura || lista === null} onClick={() => void abrirKit()} title="Instala git, filesystem e fetch e os servidores padrão de uma vez, com um consentimento">Kit de desenvolvimento</button>
        <button type="button" className="botao lm-btn" title="Consulta o Registro Oficial do MCP (só ao buscar); resultados não são curados" onClick={() => setFluxo({ tipo: "descobrir" })}>Descobrir</button>
        <button type="button" className="botao lm-btn" title="Gateway MCP: um endpoint local único, filtro por papel e auditoria" onClick={() => setFluxo({ tipo: "gateway" })}>Gateway</button>
        <button type="button" className="botao lm-btn" aria-label="Atualizar catálogo" title="Recarregar" disabled={est.carregando} onClick={() => { recarregar(); void store.atualizarDiagnostico(); }}><Icone nome="atualizar" /></button>
        {aviso !== null ? <span className="lm-aviso-topo" role="status">{aviso}</span> : null}
      </div>
      {lista?.somente_leitura === true ? <p className="aviso-caixa lm-faixa" role="alert"><strong>Catálogo somente leitura.</strong> {lista.aviso ?? "O catálogo embarcado não passou na verificação; instalar e atualizar estão desligados."}</p> : lista?.aviso != null ? <p className="lm-faixa lm-nota" role="note">{lista.aviso}</p> : null}
      {avisosAmb.map((a) => <p key={a.id} className="aviso-caixa lm-faixa" role="status" data-aviso={a.id}>{a.texto}</p>)}
      {est.erro !== null ? (
        <div className="erro-caixa lm-faixa" role="alert">{est.erro} <button type="button" className="botao lm-btn" onClick={recarregar}>Tentar de novo</button></div>
      ) : null}
      <div className="lm-corpo-tela" data-painel={cartaoSel !== null || undefined}>
        <div className="lm-lista">
          {lista === null && est.erro === null ? <div className="lm-carregando" aria-busy="true" role="status">Carregando catálogo…</div> : null}
          {lista !== null && total === 0 ? <EstadoVazio icone="loja" titulo="Catálogo vazio" texto="Nenhum servidor no catálogo embarcado. Reinstale o aplicativo ou tente recarregar." /> : null}
          {lista !== null && total > 0 && visiveis.length === 0 ? (
            <EstadoVazio icone="busca" titulo="Nada encontrado" texto={temFiltroAtivo(f) ? "Nenhum servidor combina com a busca e os filtros." : "Nenhum servidor para mostrar."}>
              {temFiltroAtivo(f) ? <button type="button" className="botao" onClick={() => store.limparFiltros()}>Limpar filtros</button> : null}
            </EstadoVazio>
          ) : null}
          {visiveis.length > 0 ? (
            <VirtualLista
              itens={visiveis}
              alturaItem={ALTURA_CARTAO}
              alturaPadrao={560}
              rotulo="Servidores MCP"
              className="lm-virtual"
              rolarPara={rolar}
              chave={(c) => c.id}
              renderItem={(c) => (
                <CartaoLinha
                  cartao={c}
                  selecionado={c.id === selecionado}
                  habilitado={est.habilitados.has(c.id)}
                  somenteLeitura={somenteLeitura}
                  store={store}
                  aoAbrir={(id) => store.selecionar(id === store.obter().selecionado ? null : id)}
                  aoAcao={aoAcao}
                  aoTeclar={aoTeclar}
                />
              )}
            />
          ) : null}
        </div>
        {cartaoSel !== null ? (
          <PainelMcp
            api={api}
            cartao={cartaoSel}
            workspaceId={workspaceId}
            missoes={missoesWs.map((m) => ({ id: m.id, titulo: m.titulo }))}
            somenteLeitura={somenteLeitura}
            aoFechar={() => store.selecionar(null)}
            aoInstalar={(id) => void abrirInstalacao(id)}
            aoAtualizar={(id) => void abrirAtualizacao(id)}
            aoConfigurar={(id) => void abrirCredenciais(id)}
            aoMudar={recarregar}
            aoAviso={setAviso}
          />
        ) : null}
      </div>
      {fluxo?.tipo === "instalar" ? (
        <DialogoConsentimento
          titulo={fluxo.planos.planos.length === 1 ? `Instalar ${fluxo.planos.planos[0]?.nome ?? ""}` : "Instalar servidores"}
          rotuloConfirmar="Instalar"
          planos={fluxo.planos.planos}
          bloqueios={fluxo.planos.bloqueios}
          ocupado={fluxo.ocupado}
          erro={fluxo.erro}
          aoConfirmar={() => void confirmarInstalacao()}
          aoFechar={() => setFluxo(null)}
        />
      ) : null}
      {fluxo?.tipo === "kit" ? (
        <DialogoConsentimento
          titulo="Kit de desenvolvimento"
          rotuloConfirmar="Instalar o Kit"
          planos={fluxo.plano.planos}
          bloqueios={fluxo.plano.bloqueios}
          hashConjunto={fluxo.plano.comando_hash}
          ocupado={fluxo.ocupado}
          erro={fluxo.erro}
          aoConfirmar={() => void confirmarKit()}
          aoFechar={() => setFluxo(null)}
        />
      ) : null}
      {fluxo?.tipo === "atualizar" ? (
        <DialogoAtualizacao nome={fluxo.nome} diff={fluxo.diff} ocupado={fluxo.ocupado} erro={fluxo.erro} aoConfirmar={() => void confirmarAtualizacao()} aoFechar={() => setFluxo(null)} />
      ) : null}
      {fluxo?.tipo === "gateway" ? <DialogoGateway workspaceId={workspaceId} servidores={(lista?.entradas ?? []).filter((c) => c.instalado !== null).map((c) => ({ id: c.id, nome: c.nome }))} aoFechar={() => setFluxo(null)} /> : null}
      {fluxo?.tipo === "descobrir" ? <DialogoDescobrir api={api} aoFechar={() => setFluxo(null)} /> : null}
      {fluxo?.tipo === "credenciais" ? (
        <DialogoCredenciais api={api} detalhe={fluxo.detalhe} cofreDisponivel={cofreOk} workspaceId={workspaceId} aoMudar={recarregar} aoFechar={() => setFluxo(null)} />
      ) : null}
    </section>
  );
}

export default function Tela() {
  return <TelaLojaMcp />;
}
