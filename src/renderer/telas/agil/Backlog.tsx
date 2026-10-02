import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORIAS_PADRAO, type EstadoFluxo, type FiltrosBacklog, type ItemResumo, type OrdenacaoBacklogAgil } from "../../../compartilhado/agil";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { avisar } from "../../estado/avisos";
import { Carregando, FaixaErro } from "./comum";
import type { CtxAgil } from "./contexto";
import { ItemPainel } from "./ItemPainel";
import { ROTULO_CRITICIDADE, ROTULO_FLUXO, ROTULO_RISCO, ROTULO_SITUACAO, antesDoDestino, formatarPontos, janelaVirtual, textoDoErro, textoOrigemEstimativa } from "./logica";

export const ALTURA_LINHA = 40;
const PAGINA = 200;
const FLUXOS: EstadoFluxo[] = ["backlog", "pronto", "em_andamento", "concluida", "validada", "orfao"];

interface Edicao { id: string; campo: "titulo" | "pontos"; valor: string }

/** Backlog: tabela virtualizada (só a janela visível existe no DOM), edição inline, arrastar para reordenar, painel lateral do item. */
export function Backlog({ ctx }: { ctx: CtxAgil }) {
  const [itens, setItens] = useState<ItemResumo[]>([]);
  const [total, setTotal] = useState(0);
  const [proximo, setProximo] = useState<string | null>(null);
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [fluxo, setFluxo] = useState<EstadoFluxo | "">("");
  const [categoria, setCategoria] = useState("");
  const [risco, setRisco] = useState("");
  const [semEstimativa, setSemEstimativa] = useState(false);
  const [ordenar, setOrdenar] = useState<OrdenacaoBacklogAgil>("ordem");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [foco, setFoco] = useState(0);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [topo, setTopo] = useState(0);
  const [altura, setAltura] = useState(480);
  const [novo, setNovo] = useState("");
  const [versao, setVersao] = useState(0);
  const arrasto = useRef<number | null>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const carregados = useRef(0);
  const maisEmAndamento = useRef(false);

  const filtros: Partial<FiltrosBacklog> = {
    texto: ctx.busca.trim() === "" ? null : ctx.busca.trim(), estado_fluxo: fluxo === "" ? null : fluxo, categoria: categoria === "" ? null : categoria, risco: risco === "" ? null : risco,
    sprint_id: ctx.filtros.sprint_id, sem_estimativa: semEstimativa ? true : null,
  };
  const chave = JSON.stringify([ctx.ws, filtros, ordenar, versao, ctx.estado?.ultima_sincronizacao ?? null]);
  const arrastavel = ordenar === "ordem" && Object.values(filtros).every((v) => v === null);

  const buscar = useCallback(async (ate: number): Promise<void> => {
    let cursor: string | null = null;
    let acumulado: ItemResumo[] = [];
    let ultimo: Awaited<ReturnType<typeof ctx.api.backlogListar>> | null = null;
    for (let i = 0; i < 40; i++) {
      ultimo = await ctx.api.backlogListar({ workspace_id: ctx.ws, filtros, ordenar, cursor, limite: PAGINA });
      acumulado = acumulado.concat(ultimo.itens);
      cursor = ultimo.proximo;
      if (cursor === null || acumulado.length >= ate) break;
    }
    if (ultimo === null) return;
    carregados.current = acumulado.length;
    setItens(acumulado); setTotal(ultimo.total); setProximo(cursor); setContagens(ultimo.contagens);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.api, ctx.ws, chave]);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    void buscar(Math.max(PAGINA, carregados.current)).then(() => { if (vivo) { setErro(null); setCarregando(false); } }, (e: unknown) => { if (vivo) { setErro(e); setCarregando(false); } });
    return () => { vivo = false; };
  }, [buscar]);

  useEffect(() => {
    const el = rolagem.current;
    if (el === null) return;
    const medir = (): void => { if (el.clientHeight > 0) setAltura(el.clientHeight); };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [carregando]);

  const { inicio, fim } = janelaVirtual(itens.length, ALTURA_LINHA, topo, altura, 1);
  // carrega a próxima página quando a janela chega perto do fim
  useEffect(() => {
    if (proximo === null || maisEmAndamento.current || fim < itens.length - 40) return;
    maisEmAndamento.current = true;
    void ctx.api.backlogListar({ workspace_id: ctx.ws, filtros, ordenar, cursor: proximo, limite: PAGINA }).then((p) => {
      carregados.current += p.itens.length;
      setItens((x) => x.concat(p.itens)); setProximo(p.proximo);
    }, (e: unknown) => setErro(e)).finally(() => { maisEmAndamento.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fim, proximo, itens.length]);

  const atualizar = (): void => { setVersao((v) => v + 1); ctx.recarregar(); };
  const falha = (e: unknown): void => { avisar(textoDoErro(e), "erro"); };

  const confirmarEdicao = (): void => {
    const ed = edicao; setEdicao(null);
    if (ed === null) return;
    const item = itens.find((i) => i.id === ed.id);
    if (item === undefined) return;
    if (ed.campo === "titulo") {
      if (ed.valor.trim() === "" || ed.valor === item.titulo) return;
      void ctx.api.itemAtualizar(ctx.ws, ed.id, { titulo: ed.valor.trim() }).then(atualizar, falha);
    } else {
      const n = Number(ed.valor.replace(",", "."));
      if (ed.valor.trim() === "" || !Number.isFinite(n) || n < 0) return;
      void ctx.api.estimativaGravar(ctx.ws, { item_id: ed.id, pontos: n, estado: "ajustada" }).then(atualizar, falha);
    }
  };
  const mover = (de: number, para: number): void => {
    const antes = antesDoDestino(itens.map((i) => i.id), de, para);
    const alvo = itens[de];
    if (alvo === undefined || para < 0 || para >= itens.length) return;
    void ctx.api.itemReordenar(ctx.ws, alvo.id, antes).then(atualizar, falha);
  };
  const criar = (): void => {
    const t = novo.trim();
    if (t === "") return;
    void ctx.api.itemCriar(ctx.ws, { titulo: t }).then(() => { setNovo(""); atualizar(); }, falha);
  };
  const estimarSem = (): void => {
    void ctx.api.estimar(ctx.ws, "sem_estimativa").then((r) => { avisar(`Heurística aplicada a ${r.heuristicas_aplicadas} itens${r.job_id !== null ? "; a IA sugere em segundo plano" : ""}.`, "sucesso"); atualizar(); }, falha);
  };
  const irPara = (i: number): void => {
    const novoFoco = Math.min(itens.length - 1, Math.max(0, i));
    setFoco(novoFoco);
    const el = rolagem.current;
    if (el !== null) {
      const y = novoFoco * ALTURA_LINHA;
      if (y < el.scrollTop) el.scrollTop = y; else if (y + ALTURA_LINHA > el.scrollTop + el.clientHeight) el.scrollTop = y + ALTURA_LINHA - el.clientHeight;
      setTopo(el.scrollTop);
    }
  };
  const teclar = (e: React.KeyboardEvent, i: number, item: ItemResumo): void => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "ArrowDown" && e.altKey && arrastavel) { e.preventDefault(); mover(i, i + 1); irPara(i + 1); }
    else if (e.key === "ArrowUp" && e.altKey && arrastavel) { e.preventDefault(); mover(i, i - 1); irPara(i - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); irPara(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); irPara(i - 1); }
    else if (e.key === "Enter") { e.preventDefault(); setSelecionado(item.id); }
    else if (e.key === "F2" && item.origem !== "metodo") { e.preventDefault(); setEdicao({ id: item.id, campo: "titulo", valor: item.titulo }); }
    else if (e.key === "Escape") setSelecionado(null);
  };
  useEffect(() => { if (foco > 0 && foco >= itens.length) setFoco(Math.max(0, itens.length - 1)); }, [itens.length, foco]);
  useEffect(() => { requestAnimationFrame(() => { const el = rolagem.current?.querySelector<HTMLElement>(`[data-foco="true"]`); if (el !== null && el !== undefined && rolagem.current?.contains(document.activeElement)) el.focus(); }); }, [foco]);

  const campoInput = (valor: string, aoMudar: (v: string) => void, rotulo: string) => (
    <input autoFocus className="ag-inline" aria-label={rotulo} value={valor} onChange={(e) => aoMudar(e.target.value)} onBlur={confirmarEdicao} onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") confirmarEdicao(); else if (e.key === "Escape") setEdicao(null); }} />
  );

  const linhas = [];
  for (let i = inicio; i < fim; i++) {
    const it = itens[i] as ItemResumo;
    const editT = edicao?.id === it.id && edicao.campo === "titulo";
    const editP = edicao?.id === it.id && edicao.campo === "pontos";
    linhas.push(
      <div key={it.id} role="row" aria-rowindex={i + 2} aria-selected={selecionado === it.id} className="ag-linha-tab" style={{ top: i * ALTURA_LINHA, height: ALTURA_LINHA }}
        tabIndex={i === foco ? 0 : -1} data-foco={i === foco ? "true" : undefined} data-estado={it.estado_fluxo}
        draggable={arrastavel && edicao === null} onDragStart={(e) => { arrasto.current = i; e.dataTransfer.effectAllowed = "move"; }} onDragOver={(e) => { if (arrasto.current !== null) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const de = arrasto.current; arrasto.current = null; if (de !== null && de !== i) mover(de, i); }}
        onClick={() => { setFoco(i); setSelecionado(it.id); }} onKeyDown={(e) => teclar(e, i, it)} onFocus={() => setFoco(i)}>
        <span role="cell" className="ag-c-ordem" title={arrastavel ? "Arraste ou use Alt+setas para reordenar" : "Reordenar só com a ordenação padrão e sem filtros"} aria-label={`Posição ${i + 1}`}>{arrastavel ? "⋮⋮" : i + 1}</span>
        <span role="cell" className="ag-c-titulo" onDoubleClick={() => it.origem !== "metodo" && setEdicao({ id: it.id, campo: "titulo", valor: it.titulo })} title={it.titulo}>
          {editT ? campoInput(edicao.valor, (v) => setEdicao({ ...edicao, valor: v }), "Título") : it.titulo}
        </span>
        <span role="cell" className="ag-c-num" onDoubleClick={() => setEdicao({ id: it.id, campo: "pontos", valor: it.pontos?.toString() ?? "" })} title="Duplo clique para ajustar">
          {editP ? campoInput(edicao.valor, (v) => setEdicao({ ...edicao, valor: v }), "Pontos") : formatarPontos(it.pontos)}
        </span>
        <span role="cell" title={textoOrigemEstimativa(it.estimativa_origem, it.estimativa_confianca)} aria-label={textoOrigemEstimativa(it.estimativa_origem, it.estimativa_confianca)} className="ag-c-origem">{it.estimativa_origem === "humano" ? "●" : it.estimativa_origem === "ia" ? "◐" : "○"}{it.estimativa_origem === "ia" && it.estimativa_confianca !== null ? ` ${Math.round(it.estimativa_confianca * 100)}` : ""}</span>
        <span role="cell">{it.categoria ?? "—"}</span>
        <span role="cell" data-nivel={it.risco ?? undefined} title="Risco / criticidade">{it.risco === null ? "—" : ROTULO_RISCO[it.risco] ?? it.risco} / {it.criticidade === null ? "—" : ROTULO_CRITICIDADE[it.criticidade] ?? it.criticidade}</span>
        <span role="cell" className="ag-c-num">{it.wsjf === null ? "—" : Math.round(it.wsjf * 10) / 10}</span>
        <span role="cell">{ROTULO_FLUXO[it.estado_fluxo] ?? it.estado_fluxo}{it.situacao_retrabalho === null ? "" : ` · ${ROTULO_SITUACAO[it.situacao_retrabalho]}`}</span>
      </div>,
    );
  }

  return (
    <div className="ag-backlog" data-lateral={selecionado !== null || undefined}>
      <div className="ag-sub-barra" role="group" aria-label="Filtros do backlog">
        <select aria-label="Estado" value={fluxo} onChange={(e) => setFluxo(e.target.value as EstadoFluxo | "")}><option value="">Estado: todos</option>{FLUXOS.map((f) => <option key={f} value={f}>{ROTULO_FLUXO[f]}{contagens[f] !== undefined ? ` (${contagens[f]})` : ""}</option>)}</select>
        <select aria-label="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Categoria: todas</option>{CATEGORIAS_PADRAO.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select aria-label="Risco" value={risco} onChange={(e) => setRisco(e.target.value)}><option value="">Risco: todos</option>{Object.entries(ROTULO_RISCO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="ag-check"><input type="checkbox" checked={semEstimativa} onChange={(e) => setSemEstimativa(e.target.checked)} /> Sem estimativa</label>
        <select aria-label="Ordenar por" value={ordenar} onChange={(e) => setOrdenar(e.target.value as OrdenacaoBacklogAgil)}><option value="ordem">Ordem manual</option><option value="wsjf">WSJF</option><option value="valor_esforco">Valor × esforço</option></select>
        <button type="button" className="ag-btn" onClick={estimarSem}>Estimar itens sem estimativa</button>
        <input type="text" className="ag-novo" placeholder="Novo item (Enter)" aria-label="Novo item" value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") criar(); }} />
        <span className="ag-meta" role="status">{itens.length} de {total}</span>
      </div>
      {erro !== null && <FaixaErro erro={erro} aoTentar={atualizar} />}
      <div className="ag-backlog-corpo">
        <div className="ag-tabela-virtual" role="table" aria-label="Backlog" aria-rowcount={total + 1}>
          <div ref={rolagem} className="ag-rolagem" role="rowgroup" onScroll={(e) => setTopo(e.currentTarget.scrollTop)}>
            <div role="row" aria-rowindex={1} className="ag-linha-tab ag-cab">
              <span role="columnheader">#</span><span role="columnheader">Título</span><span role="columnheader">Pts</span><span role="columnheader">Origem</span><span role="columnheader">Categoria</span>
              <span role="columnheader">Risco / crit.</span><span role="columnheader">WSJF</span><span role="columnheader">Estado · retrabalho</span>
            </div>
            {carregando && itens.length === 0 ? <Carregando /> : itens.length === 0 ? (
              <EstadoVazio icone="agil" titulo="Backlog vazio" texto={"Nada por aqui ainda. Escreva um item no campo “Novo item” ou sincronize para trazer as tasks do método."}>
                <button type="button" className="ag-btn" onClick={() => void ctx.api.sincronizar(ctx.ws, true).then(atualizar)}>Sincronizar</button>
              </EstadoVazio>
            ) : <div className="ag-rolagem-corpo" style={{ height: itens.length * ALTURA_LINHA }}>{linhas}</div>}
          </div>
        </div>
        {selecionado !== null && <ItemPainel ctx={ctx} itemId={selecionado} aoFechar={() => setSelecionado(null)} aoMudar={atualizar} />}
      </div>
    </div>
  );
}
