import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACOES_DISPARO_MAPA, CONFIRMACAO_APAGAR_MAPA, type AcaoDisparoMapa, type ApiMapa, type ConfigMapa, type EntradaMapa, type FormatoExportacaoMapa, type ResultadoBuscaMapa, type ResumoMapaIpc, type VistaExportacaoMapa } from "../../../compartilhado/mapa";
import { ade } from "../../ade";
import { Dialogo } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { aoPedirMapa } from "../../estado/mapa-acoes";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import type { ModoAgrupar } from "./agrupamento";
import { BotaoCopiar, Carregando, FaixaErro, Menu, type ItemMenu } from "./comum";
import { FILTROS_VAZIOS, contarFiltros, paraFiltroIpc, type EstadoFiltros } from "./filtros";
import { ITENS_ABAS_MAPA, COMANDO_INSTALAR_CTAGS, ROTULO_FASE, estadoDaTela, estimativaTexto, percentualProgresso, resumoDaBarra, rotuloEstado, textoDoErro, type AbaMapa } from "./logica";
import { PainelDetalhe } from "./PainelDetalhe";
import { PerfilProvisorio } from "./PerfilProvisorio";
import { VisaoCamadas } from "./VisaoCamadas";
import { VisaoFluxo } from "./VisaoFluxo";
import { VisaoGrafo } from "./VisaoGrafo";
import { VisaoDados, VisaoDivida, VisaoEntradas, VisaoHotspots } from "./VisaoListas";
import "./mapa.css";

export interface PaneAlvo { id: string; rotulo: string }
export interface GanchosMapa {
  /** Panes de CLI abertos do workspace (alvo do disparo). */
  panes: (ws: string) => Promise<PaneAlvo[]>;
  /** Ids de trabalhos do método (para `legadox_raio`). */
  trabalhos: (ws: string) => Promise<string[]>;
}

export interface PropsTelaMapa { api?: ApiMapa; workspaceId?: string | null; ganchos?: GanchosMapa; semCanvas?: boolean }

async function panesReais(ws: string): Promise<PaneAlvo[]> {
  const api = ade()?.missoes;
  if (api === undefined) return [];
  const pag = await api.listar(ws, null, null);
  const saida: PaneAlvo[] = [];
  for (const m of pag.itens.slice(0, 5)) {
    const d = await api.detalhe(m.id);
    for (const p of d?.panes ?? []) if (p.tipo === "cli" && p.estado !== "encerrado") saida.push({ id: p.id, rotulo: `Pane ${p.display_id} · ${p.cli ?? "cli"}` });
  }
  return saida;
}
async function trabalhosReais(ws: string): Promise<string[]> {
  const idx = await ade()?.metodo?.estado(ws);
  return (idx?.trabalhos ?? []).map((t) => t.id);
}
const GANCHOS_REAIS: GanchosMapa = { panes: panesReais, trabalhos: trabalhosReais };

const ROTULO_ACAO: Record<AcaoDisparoMapa, string> = {
  stackx_detectar: "Detectar convenções (stackx)", stackx_atualizar: "Atualizar convenções (stackx)", legadox_perfil: "Perfil do legado (legadox)",
  legadox_raio: "Raio de impacto do arquivo (legadox)", legadox_divida: "Dívida técnica (legadox)",
};
const FORMATOS: Array<[FormatoExportacaoMapa, string]> = [["mermaid", "Mermaid"], ["dot", "DOT (Graphviz)"], ["svg", "SVG"], ["json", "JSON"], ["csv", "CSV"], ["md", "Relatório Markdown"]];

/**
 * Tela Mapa do código (Fase 17, D-32): uma linha de controles, visões lazy e painel de detalhe. Sob demanda: monta só com `mapa:resumo`;
 * nenhuma análise roda sem ação da pessoa. O renderer nunca vê caminho absoluto: tudo é caminho relativo, id de nó ou nome de arquivo.
 */
export function TelaMapa({ api: apiProp, workspaceId, ganchos = GANCHOS_REAIS, semCanvas = false }: PropsTelaMapa) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const api = apiProp ?? ade()?.mapa;
  const ws = workspaceId === undefined ? (atual?.id ?? null) : workspaceId;
  const [resumo, setResumo] = useState<ResumoMapaIpc | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [carregando, setCarregando] = useState(false);
  const [versao, setVersao] = useState(0);
  const [aba, setAba] = useState<AbaMapa>("grafo");
  const [filtros, setFiltros] = useState<EstadoFiltros>(FILTROS_VAZIOS);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [modo, setModo] = useState<ModoAgrupar>("modulo");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [arquivoSel, setArquivoSel] = useState<string | null>(null);
  const [painelAberto, setPainelAberto] = useState(true);
  const [entradaId, setEntradaId] = useState<string | null>(null);
  const [entradasFluxo, setEntradasFluxo] = useState<EntradaMapa[]>([]);
  const [texto, setTexto] = useState("");
  const [achados, setAchados] = useState<ResultadoBuscaMapa[] | null>(null);
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [apagarAberto, setApagarAberto] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "info" | "erro"; texto: string; copiar?: string } | null>(null);
  const [panes, setPanes] = useState<PaneAlvo[]>([]);
  const [paneId, setPaneId] = useState("");
  const [trabalhoId, setTrabalhoId] = useState("mapa-raio");
  const [destino, setDestino] = useState<"padrao" | "escolher">("padrao");
  const busca = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregarResumo = useCallback(() => {
    if (api === undefined || ws === null) return;
    const minha = ++seq.current;
    setCarregando(true);
    void api.resumo(ws).then(
      (r) => { if (seq.current !== minha) return; setResumo(r); setErro(null); setCarregando(false); },
      (e: unknown) => { if (seq.current !== minha) return; setErro(e); setCarregando(false); },
    );
  }, [api, ws]);

  useEffect(() => { setResumo(null); setSelecionado(null); setAchados(null); setEntradaId(null); carregarResumo(); }, [carregarResumo]);

  const recarregarDepois = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { carregarResumo(); setVersao((v) => v + 1); }, 80);
  }, [carregarResumo]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (api === undefined || ws === null) return;
    return api.assinar((e) => {
      if (e.workspace_id !== ws) return;
      if (e.tipo === "progresso" && e.progresso !== undefined) setResumo((r) => (r === null ? r : { ...r, analisando: true, progresso: e.progresso ?? null }));
      else if (e.tipo === "falhou") { setAviso({ tom: "erro", texto: `A análise falhou: ${e.erro ?? "motivo desconhecido"}` }); recarregarDepois(); }
      else recarregarDepois();
    });
  }, [api, ws, recarregarDepois]);

  const analisar = useCallback(async (modoAnalise: "completo" | "incremental") => {
    if (api === undefined || ws === null) return;
    setAviso(null);
    setResumo((r) => (r === null ? r : { ...r, analisando: true, progresso: null }));
    try { await api.analisar(ws, modoAnalise, true); } catch (e) { setAviso({ tom: "erro", texto: textoDoErro(e) }); carregarResumo(); }
  }, [api, ws, carregarResumo]);

  const cancelar = useCallback(async () => {
    if (api === undefined || ws === null) return;
    try { await api.cancelar(ws); } catch (e) { setAviso({ tom: "erro", texto: textoDoErro(e) }); }
    carregarResumo();
  }, [api, ws, carregarResumo]);

  useEffect(() => aoPedirMapa((p) => {
    if (p === "analisar") void analisar("completo");
    else if (p === "atualizar") void analisar("incremental");
    else if (p === "buscar") busca.current?.focus();
    else if (p === "perfil") setPerfilAberto(true);
    else if (p === "hotspots") setAba("hotspots");
    else if (p === "ciclos") setAba("divida");
  }), [analisar]);

  // busca de símbolo com debounce
  useEffect(() => {
    const t = texto.trim();
    if (api === undefined || ws === null || t.length < 2) { setAchados(null); return; }
    let vivo = true;
    const id = setTimeout(() => { void api.buscar(ws, t, undefined, 30).then((r) => { if (vivo) setAchados(r); }, () => { if (vivo) setAchados([]); }); }, 250);
    return () => { vivo = false; clearTimeout(id); };
  }, [api, ws, texto]);

  const estado = estadoDaTela({ workspaceId: ws, resumo, erro, carregando });
  const temDados = estado === "pronto" || estado === "parcial" || estado === "desatualizado" || (estado === "analisando" && resumo !== null && resumo.estado !== "vazio");

  const abrirMetodo = (): void => {
    if (ws === null) return;
    void ganchos.panes(ws).then((p) => { setPanes(p); setPaneId((atualId) => (p.some((x) => x.id === atualId) ? atualId : (p[0]?.id ?? ""))); }, () => setPanes([]));
    void ganchos.trabalhos(ws).then((t) => { if (t[0] !== undefined) setTrabalhoId((atualId) => (atualId === "mapa-raio" ? (t[0] as string) : atualId)); }, () => undefined);
  };

  const disparar = async (acao: AcaoDisparoMapa): Promise<void> => {
    if (api === undefined || ws === null || paneId === "") return;
    try {
      const r = await api.disparar(ws, { acao, pane_id: paneId, ...(acao === "legadox_raio" ? { trabalho_id: trabalhoId, arquivos: arquivoSel === null ? [] : [arquivoSel] } : {}) });
      setAviso({ tom: "info", texto: `Enviado ao Pane: ${r.comando}. Aguardando o artefato da skill; o ADE só observa e nunca grava em docs/. Pacote em ${r.pacote}.`, copiar: r.comando });
    } catch (e) { setAviso({ tom: "erro", texto: textoDoErro(e) }); }
  };

  const exportar = async (formato: FormatoExportacaoMapa): Promise<void> => {
    if (api === undefined || ws === null) return;
    const vista: VistaExportacaoMapa = formato === "md" ? { tipo: "relatorio" } : aba === "fluxo" && entradaId !== null ? { tipo: "fluxo", entrada_id: entradaId } : { tipo: "grafo", nivel: "arquivo", filtro: paraFiltroIpc(filtros) };
    try {
      const r = await api.exportar(ws, formato, vista, destino);
      setAviso({ tom: "info", texto: `Exportado (${r.formato}, ${r.bytes} bytes): ${r.caminho}`, copiar: r.caminho });
    } catch (e) { setAviso({ tom: "erro", texto: textoDoErro(e) }); }
  };

  const gravarConfig = async (parcial: Partial<ConfigMapa>): Promise<void> => {
    if (api === undefined || ws === null) return;
    try { const c = await api.configGravar(ws, parcial); setResumo((r) => (r === null ? r : { ...r, configuracao: c })); } catch (e) { setAviso({ tom: "erro", texto: textoDoErro(e) }); }
  };

  const escolherAchado = (a: ResultadoBuscaMapa): void => {
    setAchados(null);
    setTexto("");
    if (a.tipo === "entrada") { setEntradaId(a.id); setAba("fluxo"); return; }
    setAba("grafo");
    setSelecionado(a.id);
  };

  const selecionarArquivo = (caminho: string): void => { setSelecionado(`arq:${caminho}`); setPainelAberto(true); };

  if (api === undefined) return <div className="mapa"><EstadoVazio icone="mapa" titulo="Mapa indisponível" texto="Este ambiente não expõe o mapa do código. Abra o app instalado para usá-lo." /></div>;
  if (ws === null) return <div className="mapa"><EstadoVazio icone="mapa" titulo="Nenhum projeto aberto" texto="Abra um projeto em Workspaces para analisar o código e montar o mapa." /></div>;

  const cfg = resumo?.configuracao;
  const itensMetodo: ItemMenu[] = [
    ...ACOES_DISPARO_MAPA.map((acao) => ({
      id: acao,
      rotulo: acao === "legadox_raio" && arquivoSel === null ? `${ROTULO_ACAO[acao]} (selecione um arquivo)` : ROTULO_ACAO[acao],
      desabilitado: paneId === "" || !temDados || (acao === "legadox_raio" && arquivoSel === null),
      aoEscolher: () => void disparar(acao),
    })),
  ];
  const itensExportar: ItemMenu[] = [
    { id: "d-padrao", rotulo: "Salvar na pasta padrão", tipo: "radio", marcado: destino === "padrao", aoEscolher: () => setDestino("padrao") },
    { id: "d-escolher", rotulo: "Escolher a pasta…", tipo: "radio", marcado: destino === "escolher", aoEscolher: () => setDestino("escolher") },
    ...FORMATOS.map(([f, r], i) => ({ id: f, rotulo: r, separador: i === 0, desabilitado: !temDados, aoEscolher: () => void exportar(f) })),
  ];
  const itensMais: ItemMenu[] = [
    { id: "perfil", rotulo: "Ver perfil provisório", desabilitado: !temDados, aoEscolher: () => setPerfilAberto(true) },
    { id: "agentes", rotulo: "Permitir que agentes consultem o mapa", tipo: "check", marcado: cfg?.expor_agentes === true, aoEscolher: () => void gravarConfig({ expor_agentes: cfg?.expor_agentes !== true }) },
    { id: "auto", rotulo: "Atualizar sozinho quando o código mudar", tipo: "check", marcado: cfg?.auto_atualizar === true, aoEscolher: () => void gravarConfig({ auto_atualizar: cfg?.auto_atualizar !== true }) },
    { id: "dup", rotulo: "Calcular duplicação (mais lento)", tipo: "check", marcado: cfg?.duplicacao === true, aoEscolher: () => void gravarConfig({ duplicacao: cfg?.duplicacao !== true }) },
    { id: "apagar", rotulo: "Apagar o mapa…", separador: true, desabilitado: resumo === null || resumo.estado === "vazio", aoEscolher: () => setApagarAberto(true) },
  ];

  const filtrosPainel = (
    <div className="mp-filtros" role="group" aria-label="Filtros do grafo">
      <fieldset>
        <legend>Linguagem</legend>
        {(resumo?.linguagens ?? []).map((l) => (
          <label key={l.linguagem} className="mp-check"><input type="checkbox" checked={filtros.linguagens.includes(l.linguagem)} onChange={(e) => setFiltros((f) => ({ ...f, linguagens: e.target.checked ? [...f.linguagens, l.linguagem] : f.linguagens.filter((x) => x !== l.linguagem) }))} />{l.linguagem}</label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Tipo de nó</legend>
        {(["arquivo", "simbolo", "entrada", "tabela", "externo"] as const).map((t) => (
          <label key={t} className="mp-check"><input type="checkbox" checked={filtros.tipos.includes(t)} onChange={(e) => setFiltros((f) => ({ ...f, tipos: e.target.checked ? [...f.tipos, t] : f.tipos.filter((x) => x !== t) }))} />{t}</label>
        ))}
      </fieldset>
      <label className="mp-campo">Pasta<input type="text" value={filtros.pasta} placeholder="src/modulo" onChange={(e) => setFiltros((f) => ({ ...f, pasta: e.target.value }))} /></label>
      <label className="mp-campo">Confiança
        <select value={filtros.minConfianca ?? ""} onChange={(e) => setFiltros((f) => ({ ...f, minConfianca: e.target.value === "exata" ? "exata" : null }))}>
          <option value="">exatas e heurísticas</option>
          <option value="exata">só exatas</option>
        </select>
      </label>
      <label className="mp-check"><input type="checkbox" checked={filtros.soCiclos} onChange={(e) => setFiltros((f) => ({ ...f, soCiclos: e.target.checked }))} />só ciclos</label>
      <button type="button" className="mp-btn" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</button>
    </div>
  );

  return (
    <div className="mapa" data-modo="cheia" data-tela-mapa="">
     <SubNavegacao itens={ITENS_ABAS_MAPA} ativo={aba} onMudar={setAba} rotulo="Visões do mapa" base="mp" recolhivel classePainel="mp-painel-raiz" barra={<>
      <div className="mp-barra" role="toolbar" aria-label="Controles do mapa">
        {(() => { const textoEstado = resumo !== null && temDados ? `${rotuloEstado(estado)} · ${resumoDaBarra(resumo)}` : rotuloEstado(estado); return (
          <span className="mp-estado" data-estado={estado} role="status" aria-live="polite" title={textoEstado}>
            <i aria-hidden="true" />{textoEstado}
          </span>
        ); })()}
        {estado === "analisando" ? (
          <button type="button" className="mp-btn" aria-label="Cancelar análise" onClick={() => void cancelar()}>⏹ Cancelar</button>
        ) : (
          <>
            <button type="button" className="mp-btn" data-primario={estado === "nunca" ? "" : undefined} disabled={resumo === null || cfg?.habilitado === false} onClick={() => void analisar("completo")}>{estado === "nunca" ? "Analisar ▸" : "Reanalisar ▸"}</button>
            <button type="button" className="mp-btn" aria-label="Atualizar só o que mudou" disabled={!temDados} onClick={() => void analisar("incremental")}>↻</button>
          </>
        )}
        <div className="mp-busca">
          <input ref={busca} type="search" aria-label="Buscar símbolo" placeholder="Buscar símbolo" value={texto} disabled={!temDados} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setTexto(""); setAchados(null); } }} />
          {achados !== null && (
            <div className="mp-achados" role="region" aria-label="Resultados da busca">
              {achados.length === 0 ? <p className="mp-vazio">Nenhum símbolo encontrado.</p> : (
                <ul>{achados.map((a) => <li key={a.id}><button type="button" onClick={() => escolherAchado(a)}><span>{a.rotulo}</span><span className="mp-meta">{a.tipo}{a.caminho !== null ? ` · ${a.caminho}${a.linha !== null ? `:${a.linha}` : ""}` : ""}</span></button></li>)}</ul>
              )}
            </div>
          )}
        </div>
        <div className="mp-menu">
          <button type="button" className="mp-btn" aria-haspopup="menu" aria-expanded={filtrosAbertos} disabled={!temDados} onClick={() => setFiltrosAbertos((a) => !a)}>Filtros{contarFiltros(filtros) > 0 ? ` (${contarFiltros(filtros)})` : ""} ▾</button>
          {filtrosAbertos && <div className="mp-menu-lista mp-menu-filtros">{filtrosPainel}</div>}
        </div>
        <label className="mp-agrupar"><span className="mp-agrupar-rotulo">Agrupar</span>
          <select aria-label="Agrupar por" value={modo} disabled={!temDados} onChange={(e) => setModo(e.target.value === "pasta" ? "pasta" : e.target.value === "arquivo" ? "arquivo" : "modulo")}>
            <option value="modulo">módulo</option><option value="pasta">pasta</option><option value="arquivo">arquivo</option>
          </select>
        </label>
        <Menu rotulo="Exportar" itens={itensExportar} />
        <Menu
          rotulo="Método"
          itens={itensMetodo}
          aoAbrir={abrirMetodo}
          extra={(
            <div className="mp-menu-extra">
              <label className="mp-campo">Pane de destino
                <select value={paneId} onChange={(e) => setPaneId(e.target.value)}>
                  {panes.length === 0 ? <option value="">nenhum Pane de CLI aberto</option> : panes.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
                </select>
              </label>
              <label className="mp-campo">Trabalho (raio)<input type="text" value={trabalhoId} maxLength={120} onChange={(e) => setTrabalhoId(e.target.value.replace(/[^A-Za-z0-9._-]/g, ""))} /></label>
            </div>
          )}
        />
        <Menu rotulo="Mais" itens={itensMais} />
      </div>

      {aviso !== null && (
        <div className="mp-faixa" data-tom={aviso.tom} role={aviso.tom === "erro" ? "alert" : "status"}>
          <span>{aviso.texto}</span>
          {aviso.copiar !== undefined && <BotaoCopiar texto={aviso.copiar} rotulo="Copiar" />}
          <button type="button" aria-label="Dispensar aviso" onClick={() => setAviso(null)}>×</button>
        </div>
      )}
      {estado === "desatualizado" && resumo !== null && (
        <div className="mp-faixa" data-tom="aviso" role="status">
          <span>{resumo.alterados_n} {resumo.alterados_n === 1 ? "arquivo mudou" : "arquivos mudaram"} — atualizar</span>
          <button type="button" onClick={() => void analisar("incremental")}>Atualizar agora</button>
        </div>
      )}
      {resumo !== null && temDados && resumo.historia === "indisponivel" && <div className="mp-faixa" data-tom="info" role="note">Sem história do git: hotspots e churn ficam indisponíveis e o raio assume o pior caso.</div>}
      {resumo !== null && temDados && resumo.degradadas > 0 && (
        <div className="mp-faixa" data-tom="info" role="note">
          <span>{resumo.degradadas} arquivos em linguagens sem gramática (modo degradado, tudo heurístico).{!resumo.ferramentas.ctags && " Instale o ctags opcional para listar símbolos:"}</span>
          {!resumo.ferramentas.ctags && <><code>{COMANDO_INSTALAR_CTAGS}</code><BotaoCopiar texto={COMANDO_INSTALAR_CTAGS} rotulo="Copiar comando de instalação do ctags" /></>}
        </div>
      )}
      {resumo?.aviso != null && resumo.aviso !== "" && <div className="mp-faixa" data-tom="info" role="note">{resumo.aviso}</div>}
      {estado === "parcial" && <div className="mp-faixa" data-tom="aviso" role="status"><span>A última análise foi interrompida; o mapa está parcial.</span><button type="button" onClick={() => void analisar("completo")}>Continuar analisando</button></div>}
      {estado === "analisando" && resumo !== null && (
        <div className="mp-progresso" role="status" aria-live="polite">
          <progress aria-label="Progresso da análise" max={100} value={percentualProgresso(resumo.progresso?.feito ?? 0, resumo.progresso?.total ?? 0)} />
          <span>{resumo.progresso === null ? "Iniciando…" : `${ROTULO_FASE[resumo.progresso.fase] ?? resumo.progresso.fase}: ${resumo.progresso.feito} de ${resumo.progresso.total}`}</span>
        </div>
      )}

     </>}>
      <div className="mp-miolo">
        <div className="mp-corpo">
          {estado === "carregando" && <Carregando />}
          {estado === "erro" && <FaixaErro erro={erro} aoTentar={carregarResumo} />}
          {estado === "nunca" && (
            <EstadoVazio icone="mapa" titulo="Este projeto ainda não foi analisado" texto={cfg?.habilitado === false ? "O mapa está desabilitado para este projeto." : estimativaTexto(resumo?.estimativa_arquivos ?? null)}>
              <button type="button" className="mp-btn" data-primario="" disabled={cfg?.habilitado === false} onClick={() => void analisar("completo")}>Analisar este projeto</button>
            </EstadoVazio>
          )}
          {estado === "analisando" && !temDados && <EstadoVazio icone="mapa" titulo="Analisando o projeto" texto="Você pode continuar usando o app: a análise roda em segundo plano e dá para cancelar." />}
          {temDados && resumo !== null && (
            <>
              {aba === "grafo" && <VisaoGrafo api={api} ws={ws} versao={versao} filtros={filtros} modo={modo} selecionado={selecionado} aoSelecionar={(id) => { setSelecionado(id); if (id !== null) setPainelAberto(true); }} semCanvas={semCanvas} />}
              {aba === "camadas" && <VisaoCamadas api={api} ws={ws} versao={versao} />}
              {aba === "fluxo" && <VisaoFluxoLigada api={api} ws={ws} versao={versao} entradaId={entradaId} minConfianca={filtros.minConfianca} aoEscolher={(id) => setEntradaId(id)} aoSelecionarNo={(id) => { setSelecionado(id); setPainelAberto(true); }} noSelecionado={selecionado} aoEntradas={setEntradasFluxo} entradas={entradasFluxo} />}
              {aba === "hotspots" && <VisaoHotspots api={api} ws={ws} versao={versao} selecionado={selecionado} aoSelecionarArquivo={selecionarArquivo} />}
              {aba === "entradas" && <VisaoEntradas api={api} ws={ws} versao={versao} aoAbrirFluxo={(e) => { setEntradaId(e.id); setAba("fluxo"); }} />}
              {aba === "dados" && <VisaoDados api={api} ws={ws} versao={versao} />}
              {aba === "divida" && <VisaoDivida api={api} ws={ws} versao={versao} selecionado={selecionado} aoSelecionarArquivo={selecionarArquivo} />}
            </>
          )}
        </div>
        {temDados && <PainelDetalhe api={api} ws={ws} noId={selecionado} versao={versao} aberto={painelAberto} aoAlternar={() => setPainelAberto((a) => !a)} aoSelecionar={(id) => { setSelecionado(id); setAba("grafo"); }} aoArquivo={setArquivoSel} />}
      </div>
     </SubNavegacao>

      {perfilAberto && <PerfilProvisorio api={api} ws={ws} aoFechar={() => setPerfilAberto(false)} />}
      {apagarAberto && <DialogoApagar aoCancelar={() => setApagarAberto(false)} aoConfirmar={async () => { try { await api.apagar(ws, CONFIRMACAO_APAGAR_MAPA); setApagarAberto(false); setSelecionado(null); carregarResumo(); setVersao((v) => v + 1); } catch (e) { setApagarAberto(false); setAviso({ tom: "erro", texto: textoDoErro(e) }); } }} />}
    </div>
  );
}

/** Liga a lista de entradas (análise `entradas`) ao fluxo. */
function VisaoFluxoLigada(p: { api: ApiMapa; ws: string; versao: number; entradaId: string | null; minConfianca: EstadoFiltros["minConfianca"]; aoEscolher: (id: string) => void; aoSelecionarNo: (id: string) => void; noSelecionado: string | null; aoEntradas: (e: EntradaMapa[]) => void; entradas: EntradaMapa[] }) {
  const { api, ws, versao, aoEntradas } = p;
  useEffect(() => {
    let vivo = true;
    void api.analise(ws, "entradas").then((r) => { if (vivo) aoEntradas(r.dados.itens); }, () => { if (vivo) aoEntradas([]); });
    return () => { vivo = false; };
  }, [api, ws, versao, aoEntradas]);
  return <VisaoFluxo api={api} ws={ws} versao={versao} entradaId={p.entradaId} entradas={p.entradas} minConfianca={p.minConfianca} aoEscolherEntrada={p.aoEscolher} aoSelecionarNo={p.aoSelecionarNo} noSelecionado={p.noSelecionado} />;
}

function DialogoApagar({ aoCancelar, aoConfirmar }: { aoCancelar: () => void; aoConfirmar: () => Promise<void> }) {
  const [t, setT] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <Dialogo titulo="Apagar o mapa deste projeto" aoFechar={aoCancelar}>
      <p>Isto apaga o banco do mapa e os pacotes de contexto na pasta de pacotes do mapa dentro do projeto. Seu código e a pasta <code>docs/</code> não são tocados. Para continuar, digite <strong>{CONFIRMACAO_APAGAR_MAPA}</strong>.</p>
      <label className="mp-campo">Confirmação<input type="text" data-foco-inicial="" value={t} autoComplete="off" onChange={(e) => setT(e.target.value)} /></label>
      <div className="mp-acoes">
        <button type="button" className="mp-btn" onClick={aoCancelar}>Cancelar</button>
        <button type="button" className="mp-btn" data-perigo="" disabled={t !== CONFIRMACAO_APAGAR_MAPA || ocupado} onClick={() => { setOcupado(true); void aoConfirmar().finally(() => setOcupado(false)); }}>Apagar o mapa</button>
      </div>
    </Dialogo>
  );
}
