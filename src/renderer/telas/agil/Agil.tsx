import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiAgil, EstadoAgilApp, FiltrosAgil, MembroAgil, MetodoAgil, PainelAgil, SprintComResumoAgil } from "../../../compartilhado/agil";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Icone } from "../../componentes/Icone";
import { SubNavegacao } from "../../componentes/SubNavegacao";
import { ade } from "../../ade";
import { avisar } from "../../estado/avisos";
import { aoPedirAgil } from "../../estado/agil-acoes";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { Backlog } from "./Backlog";
import { Carregando, FaixaErro } from "./comum";
import { Config } from "./Config";
import type { CtxAgil } from "./contexto";
import { Daily } from "./Daily";
import { ABAS_AGIL, FILTROS_VAZIOS, METODOS, filtrosParaApi, textoDoErro, type AbaAgil } from "./logica";
import { EsqueletoPainel, PainelGraficos } from "./PainelGraficos";
import { Qualidade } from "./Qualidade";
import { Retro } from "./Retro";
import { Sprint } from "./Sprint";
import "./agil.css";

export interface PropsTelaAgil { api?: ApiAgil; workspaceId?: string | null }

/**
 * Tela Gestão ágil (Fase 18, D-32): UMA linha de controles (abas + filtros + busca + ações), sem cabeçalho de página. Lazy: nada roda no boot.
 * Os dados do workspace (estado, sprints, membros, painel) vivem aqui; as abas recebem um contexto e pedem `recarregar` depois de mudar algo.
 */
export function TelaAgil({ api: apiProp, workspaceId }: PropsTelaAgil) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const api = apiProp ?? ade()?.agil;
  const ws = workspaceId === undefined ? (atual?.id ?? null) : workspaceId;
  const [aba, setAba] = useState<AbaAgil>("painel");
  const [filtros, setFiltros] = useState<FiltrosAgil>(FILTROS_VAZIOS);
  const [metodo, setMetodo] = useState<MetodoAgil | "todos">("todos");
  const [busca, setBusca] = useState("");
  const [estado, setEstado] = useState<EstadoAgilApp | null>(null);
  const [sprints, setSprints] = useState<SprintComResumoAgil[]>([]);
  const [membros, setMembros] = useState<MembroAgil[]>([]);
  const [painel, setPainel] = useState<PainelAgil | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [versao, setVersao] = useState(0);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recarregar = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVersao((v) => v + 1), 60);
  }, []);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  useEffect(() => aoPedirAgil((p) => {
    if (p === "sincronizar") { if (api !== undefined && ws !== null) void api.sincronizar(ws, true).then(() => recarregar(), (e) => avisar(textoDoErro(e), "erro")); return; }
    if (p !== "abrir") setAba(p);
  }), [api, ws, recarregar]);

  useEffect(() => {
    if (api === undefined || ws === null) return;
    return api.assinar((e) => {
      if (e.workspace_id !== ws) return;
      if (e.tipo === "sincronizacao_falhou") avisar(`Sincronização ágil falhou: ${e.motivo}`, "aviso");
      recarregar();
    });
  }, [api, ws, recarregar]);

  useEffect(() => {
    if (api === undefined || ws === null) return;
    const minha = ++seq.current;
    setCarregando(true);
    void Promise.all([api.estado(ws), api.sprintListar(ws), api.membroListar(ws), api.painel(ws, filtrosParaApi(filtros))]).then(
      ([e, s, m, p]) => { if (seq.current !== minha) return; setEstado(e); setSprints(s); setMembros(m); setPainel(p); setErro(null); setCarregando(false); },
      (err: unknown) => { if (seq.current !== minha) return; setErro(err); setCarregando(false); },
    );
  }, [api, ws, filtros, versao]);

  const irPara = useCallback((a: AbaAgil) => setAba(a), []);
  const ctx: CtxAgil | null = useMemo(() => (api === undefined || ws === null ? null : { api, ws, estado, sprints, membros, painel, filtros, busca, recarregar, irPara }), [api, ws, estado, sprints, membros, painel, filtros, busca, recarregar, irPara]);

  const squads = useMemo(() => [...new Set(membros.map((m) => m.squad_id).filter((x): x is string => x !== null))], [membros]);
  const sincronizar = (): void => {
    if (ctx === null) return;
    void ctx.api.sincronizar(ctx.ws, true).then((r) => { avisar(r.iniciado ? "Sincronização iniciada." : "Já havia uma sincronização em andamento.", "info"); recarregar(); }, (e) => avisar(textoDoErro(e), "erro"));
  };
  const exportar = (): void => {
    if (ctx === null) return;
    const tipo = aba === "backlog" ? "backlog" : aba === "retro" ? "retro" : aba === "daily" ? "daily" : "metricas";
    void ctx.api.exportar(ctx.ws, tipo, "csv", { sprint_id: filtros.sprint_id }).then(() => avisar("Exportado para a pasta de exportações do aplicativo.", "sucesso"), (e) => avisar(textoDoErro(e), "erro"));
  };

  const corpo = (() => {
    if (api === undefined) return <EstadoVazio icone="agil" titulo="Gestão ágil indisponível" texto="Este recurso só funciona dentro do aplicativo desktop." />;
    if (ws === null || ctx === null) return <EstadoVazio icone="workspaces" titulo="Nenhum projeto aberto" texto="A gestão ágil é por projeto. Abra uma pasta em Workspaces para ver backlog, sprints e métricas." />;
    if (erro !== null && estado === null) return <FaixaErro bloco erro={erro} aoTentar={recarregar} />;
    if (estado === null) return aba === "painel" ? <EsqueletoPainel /> : <Carregando />;
    switch (aba) {
      case "painel": return <PainelGraficos ctx={ctx} metodo={metodo} carregando={carregando} />;
      case "backlog": return <Backlog ctx={ctx} />;
      case "sprint": return <Sprint ctx={ctx} />;
      case "daily": return <Daily ctx={ctx} />;
      case "retro": return <Retro ctx={ctx} />;
      case "qualidade": return <Qualidade ctx={ctx} />;
      case "config": return <Config ctx={ctx} />;
    }
  })();

  const mudar = <K extends keyof FiltrosAgil>(k: K, v: FiltrosAgil[K]): void => setFiltros((f) => ({ ...f, [k]: v === "" ? null : v }));
  return (
    <div className="agil" data-modo="leitura" data-largura="larga" data-tela-agil>
     <SubNavegacao itens={ABAS_AGIL} ativo={aba} onMudar={setAba} rotulo="Seções da gestão ágil" base="agil" recolhivel classePainel="ag-corpo" barra={<>
      <div className="ag-barra" role="toolbar" aria-label="Controles da gestão ágil">
        <select aria-label="Sprint" title={filtros.sprint_id === null ? "Sprint: todas" : (sprints.find((s) => s.id === filtros.sprint_id)?.nome ?? filtros.sprint_id)} value={filtros.sprint_id ?? ""} onChange={(e) => mudar("sprint_id", e.target.value)}>
          <option value="">Sprint: todas</option>
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.nome} ({s.estado})</option>)}
        </select>
        <select aria-label="Pessoa ou agente" title={filtros.membro_id === null ? "Pessoa/agente: todos" : (membros.find((m) => m.id === filtros.membro_id)?.rotulo ?? filtros.membro_id)} value={filtros.membro_id ?? ""} onChange={(e) => mudar("membro_id", e.target.value)}>
          <option value="">Pessoa/agente: todos</option>
          {membros.map((m) => <option key={m.id} value={m.id}>{m.rotulo}{m.tipo === "agente" ? " (agente)" : ""}</option>)}
        </select>
        {squads.length > 0 && (
          <select aria-label="Squad" title={filtros.squad_id === null ? "Squad: todas" : filtros.squad_id} value={filtros.squad_id ?? ""} onChange={(e) => mudar("squad_id", e.target.value)}>
            <option value="">Squad: todas</option>
            {squads.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span className="ag-periodo" role="group" aria-label="Período">
          <input type="date" aria-label="Período: de" value={filtros.de ?? ""} onChange={(e) => mudar("de", e.target.value)} />
          <span aria-hidden="true">–</span>
          <input type="date" aria-label="Período: até" value={filtros.ate ?? ""} onChange={(e) => mudar("ate", e.target.value)} />
        </span>
        <select aria-label="Método" value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoAgil | "todos")}>
          {METODOS.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
        </select>
        <input type="search" aria-label="Buscar no backlog" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="ag-espaco" />
        {estado?.sincronizando === true && <span className="ag-meta" role="status">sincronizando…</span>}
        <button type="button" className="ag-icone-btn" onClick={sincronizar} disabled={ctx === null} aria-label="Sincronizar com o método" title="Sincronizar com o método"><Icone nome="atualizar" /></button>
        <button type="button" className="ag-icone-btn" onClick={exportar} disabled={ctx === null} aria-label="Exportar CSV da aba" title="Exportar CSV"><Icone nome="baixar" /></button>
      </div>
      {erro !== null && estado !== null && <FaixaErro erro={erro} aoTentar={recarregar} />}
     </>}>{corpo}</SubNavegacao>
    </div>
  );
}
