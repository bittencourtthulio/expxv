import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlertaVisao, ApiAlertas, MetaTipoVisao, Severidade } from "../../../compartilhado/alertas";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { ItemLista } from "../../componentes/ItemLista";
import { VirtualLista } from "../../componentes/VirtualLista";
import { storeAlertas, useAlertas, type StoreAlertas } from "../../estado/alertas";
import { FILTROS_VAZIOS, filtrosParaPedido, resumoNumeros, SEVERIDADE_VISUAL, silenciarAte, tempoRelativo, type FiltrosLista } from "../../estado/alertas-formato";
import { pedirTela } from "../../estado/navegacao";
import type { TelaId } from "../../casca/telas";

/** Linha no padrão único de listas (D-694): 2 linhas de texto + selos; 56 px fecha a conta da virtualização. */
export const ALTURA_LINHA = 56;
export interface WorkspaceOpcao { id: string; nome: string }

const SEVERIDADES: ReadonlyArray<Severidade> = ["info", "sucesso", "aviso", "critico"];
const TELA_DO_DESTINO: Record<string, TelaId> = { task: "metodo", missao: "missoes", pane: "terminais", pr: "versionamento", componente: "config", canal: "alertas" };

function CartaoPlano({ api, store, agora }: { api: ApiAlertas; store: StoreAlertas; agora: () => number }) {
  const { planosPendentes } = useAlertas(store);
  const [msg, setMsg] = useState<string | null>(null);
  if (planosPendentes.length === 0) return null;
  const decidir = async (plano_id: string, args_hash: string, decisao: "aprovar" | "cancelar"): Promise<void> => {
    try {
      const r = await api.telegram.planoDecidirDesktop({ plano_id, args_hash, decisao });
      if (r.ok) { store.removerPlano(plano_id); setMsg(null); } else setMsg(r.motivo ?? "Não foi possível registrar a decisão.");
    } catch { setMsg("Não foi possível registrar a decisão."); }
  };
  return (
    <section className="alertas-planos" aria-label="Planos aguardando aprovação no desktop">
      {planosPendentes.map((p) => {
        const resta = Math.max(0, Math.round((Date.parse(p.expira_em) - agora()) / 60_000));
        return (
          <div key={p.plano_id} className="alertas-plano">
            <span className="alertas-sev" data-tom="aviso"><span aria-hidden="true">◆</span> Aguardando aprovação</span>
            <span className="alertas-plano-resumo">{p.resumo}</span>
            <span className="alertas-plano-exp">expira em {resta} min</span>
            <button type="button" data-sem-travessura className="botao botao-primario alertas-mini" onClick={() => void decidir(p.plano_id, p.args_hash, "aprovar")}>Aprovar</button>
            <button type="button" className="botao alertas-mini" onClick={() => void decidir(p.plano_id, p.args_hash, "cancelar")}>Cancelar</button>
          </div>
        );
      })}
      {msg !== null ? <p role="alert" className="campo-erro">{msg}</p> : null}
    </section>
  );
}

export interface PropsLista { api: ApiAlertas; catalogo: readonly MetaTipoVisao[]; workspaces: readonly WorkspaceOpcao[]; store?: StoreAlertas; agora?: () => number; aoNavegar?: (t: TelaId) => void }

export function Lista({ api, catalogo, workspaces, store = storeAlertas, agora = Date.now, aoNavegar = pedirTela }: PropsLista) {
  const [filtros, setFiltros] = useState<FiltrosLista>(FILTROS_VAZIOS);
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState<AlertaVisao[]>([]);
  const [proximo, setProximo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const geracao = useRef(0);
  const rotulos = useMemo(() => new Map(catalogo.map((c) => [c.tipo, c.rotulo])), [catalogo]);
  const nomesWs = useMemo(() => new Map(workspaces.map((w) => [w.id, w.nome])), [workspaces]);

  useEffect(() => { const t = setTimeout(() => setFiltros((f) => (f.busca === busca ? f : { ...f, busca })), 250); return () => clearTimeout(t); }, [busca]);

  const carregar = useCallback(async (depois: string | null): Promise<void> => {
    const g = ++geracao.current;
    setCarregando(true);
    try {
      const p = await api.listar(filtrosParaPedido(filtros, depois));
      if (g !== geracao.current) return;
      setItens((a) => (depois === null ? p.itens : [...a, ...p.itens]));
      setProximo(p.proximo);
      setErro(null);
    } catch (e) {
      if (g === geracao.current) setErro(e instanceof Error ? e.message : "Não foi possível ler os alertas.");
    } finally { if (g === geracao.current) setCarregando(false); }
  }, [api, filtros]);
  useEffect(() => { setSel(new Set()); void carregar(null); }, [carregar]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const recarregar = (): void => { clearTimeout(t); t = setTimeout(() => void carregar(null), 300); };
    const d = [api.assinarNovo(recarregar), api.assinarMudou(recarregar)];
    return () => { clearTimeout(t); d.forEach((f) => f()); };
  }, [api, carregar]);

  const marcarLidos = async (ids: string[]): Promise<void> => {
    try { await api.marcarLido(ids); setItens((a) => (filtros.estado === "nao_lidos" ? a.filter((x) => !ids.includes(x.id)) : a.map((x) => (ids.includes(x.id) ? { ...x, lido_em: new Date(agora()).toISOString() } : x)))); setSel(new Set()); setAviso(null); }
    catch { setAviso("Não foi possível marcar como lido."); }
  };
  const marcarTodos = async (): Promise<void> => {
    try { const { depois_id: _d, limite: _l, ...f } = filtrosParaPedido(filtros, null); await api.marcarTodosLidos(f); await carregar(null); setAviso(null); }
    catch { setAviso("Não foi possível marcar tudo como lido."); }
  };
  const silenciar = async (a: AlertaVisao, valor: string): Promise<void> => {
    const [escopo, h] = valor.split(":");
    if (escopo === undefined || h === undefined) return;
    const ate = silenciarAte(Number(h), agora());
    try {
      if (escopo === "tipo") await api.silenciar({ tipo: a.tipo }, ate);
      else if (a.entidade_tipo !== null && a.entidade_id !== null) await api.silenciar({ entidade_tipo: a.entidade_tipo, entidade_id: a.entidade_id }, ate);
      setAviso(`Silenciado por ${h} h.`);
    } catch { setAviso("Não foi possível silenciar."); }
  };
  const abrir = async (a: AlertaVisao): Promise<void> => {
    try {
      const r = await api.abrirEntidade(a.id);
      if (r.ok && r.destino !== null) aoNavegar(TELA_DO_DESTINO[r.destino.tipo] ?? "alertas");
      else setAviso("Este alerta não tem uma tela de destino.");
    } catch { setAviso("Não foi possível abrir o item."); }
  };
  const alternar = (id: string): void => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tipoDe = (a: AlertaVisao): string => rotulos.get(a.tipo) ?? a.tipo;

  return (
    <div className="alertas-lista-tela">
      <div className="alertas-filtros" role="group" aria-label="Filtros dos alertas">
        <select aria-label="Estado" value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value as FiltrosLista["estado"] })}>
          <option value="nao_lidos">Não lidos</option><option value="todos">Todos</option><option value="silenciados">Silenciados</option>
        </select>
        <select aria-label="Tipo" value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>
          <option value="">Todos os tipos</option>
          {catalogo.map((c) => <option key={c.tipo} value={c.tipo}>{c.rotulo}</option>)}
        </select>
        <select aria-label="Severidade mínima" value={filtros.severidade_min} onChange={(e) => setFiltros({ ...filtros, severidade_min: e.target.value as FiltrosLista["severidade_min"] })}>
          <option value="">Qualquer severidade</option>
          {SEVERIDADES.map((s) => <option key={s} value={s}>{SEVERIDADE_VISUAL[s].texto} ou mais</option>)}
        </select>
        <select aria-label="Workspace" value={filtros.workspace_id} onChange={(e) => setFiltros({ ...filtros, workspace_id: e.target.value })}>
          <option value="">Todos os workspaces</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.nome}</option>)}
        </select>
        <input type="search" aria-label="Buscar no título" placeholder="Buscar" value={busca} maxLength={80} onChange={(e) => setBusca(e.target.value)} />
        <span className="alertas-espaco" />
        <button type="button" className="botao alertas-mini" disabled={sel.size === 0} onClick={() => void marcarLidos([...sel])}>Marcar selecionados como lidos</button>
        <button type="button" className="botao alertas-mini" disabled={itens.length === 0} onClick={() => void marcarTodos()}>Marcar todos como lidos</button>
      </div>
      <CartaoPlano api={api} store={store} agora={agora} />
      {aviso !== null ? <p role="status" className="alertas-aviso">{aviso}</p> : null}
      {erro !== null ? <div role="alert" className="alertas-erro">{erro} <button type="button" className="botao alertas-mini" onClick={() => void carregar(null)}>Tentar de novo</button></div> : null}
      <div className="alertas-lista-wrap" aria-busy={carregando}>
        {carregando && itens.length === 0 ? <p className="alertas-nota" role="status">Lendo alertas…</p>
          : itens.length === 0 && erro === null ? (
            <EstadoVazio icone="alerta" titulo={filtros.estado === "nao_lidos" ? "Nada por aqui" : "Nenhum alerta com estes filtros"} texto="Quando uma tarefa terminar, atrasar ou algo pedir sua atenção, aparece aqui. Crie regras na aba Regras para receber também fora do app." />
          ) : (
            <VirtualLista
              itens={itens}
              alturaItem={ALTURA_LINHA}
              rotulo="Alertas"
              chave={(a) => a.id}
              className="alertas-virtual"
              renderItem={(a) => {
                const v = SEVERIDADE_VISUAL[a.severidade];
                const ws = a.workspace_id === null ? "" : (nomesWs.get(a.workspace_id) ?? a.workspace_id);
                const contexto = [tipoDe(a), typeof a.dados.missao === "string" ? a.dados.missao : "", ws].filter(Boolean).join(" · ");
                const numeros = resumoNumeros(a);
                const props = {
                  id: a.id,
                  densa: true as const,
                  titulo: `${a.titulo}${a.contagem > 1 ? ` (x${a.contagem})` : ""}${numeros === "" ? "" : ` · ${numeros}`}`,
                  descricao: contexto,
                  selos: [{ texto: `${v.glifo} ${v.texto}`, tom: v.tom, titulo: `Severidade: ${v.texto}` }, ...(a.lido_em === null ? [{ texto: "não lido", tom: "destaque" as const }] : [])],
                  meta: tempoRelativo(a.criado_em, agora()),
                  ...(a.lido_em !== null ? { estado: "lido" } : {}),
                  aoAbrir: () => void abrir(a),
                  acao: <button type="button" className="botao alertas-mini" aria-label={`Abrir: ${a.titulo}`} onClick={() => void abrir(a)}>Abrir</button>,
                };
                return (
                  <ItemLista {...props}>
                    <input type="checkbox" className="alertas-marca" aria-label={`Selecionar ${a.titulo}`} checked={sel.has(a.id)} onChange={() => alternar(a.id)} />
                    <span className="alertas-acoes">
                      <button type="button" className="alertas-mini-botao" disabled={a.lido_em !== null} aria-label={`Marcar como lido: ${a.titulo}`} title={a.lido_em !== null ? "Este alerta já está lido" : undefined} onClick={() => void marcarLidos([a.id])}>Lido</button>
                      <select aria-label={`Silenciar: ${a.titulo}`} value="" onChange={(e) => void silenciar(a, e.target.value)}>
                        <option value="">Silenciar…</option>
                        <option value="tipo:1">Este tipo, 1 h</option><option value="tipo:8">Este tipo, 8 h</option><option value="tipo:24">Este tipo, 24 h</option>
                        {a.entidade_id !== null ? <><option value="entidade:1">Esta entidade, 1 h</option><option value="entidade:8">Esta entidade, 8 h</option><option value="entidade:24">Esta entidade, 24 h</option></> : null}
                      </select>
                    </span>
                  </ItemLista>
                );
              }}
            />
          )}
      </div>
      {proximo !== null ? <div className="alertas-mais"><button type="button" className="botao alertas-mini" disabled={carregando} onClick={() => void carregar(proximo)}>Carregar mais</button></div> : null}
    </div>
  );
}
