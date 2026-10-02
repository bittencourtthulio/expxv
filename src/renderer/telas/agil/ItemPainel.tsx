import { useCallback, useEffect, useState } from "react";
import { CATEGORIAS_PADRAO, type CriticidadeAgil, type ItemDetalheAgil, type Moscow, type RiscoAgil } from "../../../compartilhado/agil";
import { avisar } from "../../estado/avisos";
import { Campo, Carregando, FaixaErro } from "./comum";
import type { CtxAgil } from "./contexto";
import { Estimativa } from "./Estimativa";
import { ROTULO_CRITICIDADE, ROTULO_RISCO, ROTULO_SITUACAO, motivoValido, textoDoErro } from "./logica";

const RISCOS: RiscoAgil[] = ["baixo", "medio", "alto", "critico"];
const CRITICIDADES: CriticidadeAgil[] = ["baixa", "media", "alta", "critica"];
const MOSCOW: Array<Moscow | ""> = ["", "must", "should", "could", "wont"];
const nota = (v: string): number | null => { const n = Number(v); return v.trim() === "" || !Number.isFinite(n) ? null : Math.min(10, Math.max(1, Math.round(n))); };

/** Painel lateral do item (complementary): estimativa, classificação, priorização, DoD, retrabalho, vínculo/promoção e descarte. */
export function ItemPainel({ ctx, itemId, aoFechar, aoMudar }: { ctx: CtxAgil; itemId: string; aoFechar: () => void; aoMudar: () => void }) {
  const [d, setD] = useState<ItemDetalheAgil | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [motivo, setMotivo] = useState("");
  const [descarte, setDescarte] = useState("");
  const [comando, setComando] = useState<string | null>(null);
  const [prio, setPrio] = useState({ valor: "", urgencia: "", reducao: "", moscow: "" as Moscow | "" });
  const [resumo, setResumo] = useState("");

  const carregar = useCallback(() => {
    void ctx.api.itemLer(ctx.ws, itemId).then((x) => {
      setD(x); setErro(null);
      setPrio({ valor: x.item.valor?.toString() ?? "", urgencia: x.item.urgencia?.toString() ?? "", reducao: x.item.reducao_risco?.toString() ?? "", moscow: x.item.moscow ?? "" });
      setResumo(x.item.resumo_cliente ?? "");
    }, (e: unknown) => setErro(e));
  }, [ctx.api, ctx.ws, itemId]);
  useEffect(() => { setD(null); setComando(null); setMotivo(""); setDescarte(""); carregar(); }, [carregar]);
  const mudou = (): void => { carregar(); aoMudar(); };
  const falha = (e: unknown): void => { avisar(textoDoErro(e), "erro"); };

  if (erro !== null) return <aside className="ag-lateral" aria-label="Detalhes do item"><FaixaErro erro={erro} aoTentar={carregar} /><button type="button" className="ag-btn" onClick={aoFechar}>Fechar</button></aside>;
  if (d === null) return <aside className="ag-lateral" aria-label="Detalhes do item"><Carregando /></aside>;
  const { item } = d;
  const cls = d.classificacoes.find((c) => c.ativa) ?? null;
  const ehMetodo = item.origem === "metodo";
  const podeMarcar = item.trabalho_id !== null && item.task_ref !== null;

  const classificar = (campo: "categoria" | "risco" | "criticidade", valor: string): void => {
    void ctx.api.classificacaoGravar(ctx.ws, { item_id: item.id, [campo]: valor, estado: "ajustada" }).then(mudou, falha);
  };
  const marcar = (acao: "marcar_retrabalho" | "marcar_primeira"): void => {
    if (!podeMarcar || !motivoValido(motivo)) return;
    void ctx.api.retrabalhoMarcar(ctx.ws, { trabalho_id: item.trabalho_id as string, task_ref: item.task_ref as string, acao, motivo: motivo.trim() }).then(() => { setMotivo(""); avisar("Marcação registrada e auditada.", "sucesso"); mudou(); }, falha);
  };
  const salvarPrio = (): void => {
    void ctx.api.itemAtualizar(ctx.ws, item.id, { valor: nota(prio.valor), urgencia: nota(prio.urgencia), reducao_risco: nota(prio.reducao), moscow: prio.moscow === "" ? null : prio.moscow, resumo_cliente: resumo.trim() === "" ? null : resumo.trim() }).then(mudou, falha);
  };

  return (
    <aside className="ag-lateral" aria-label={`Detalhes de ${item.titulo}`}>
      <header className="ag-lateral-cab">
        <h3>{item.titulo}</h3>
        <button type="button" className="ag-btn" onClick={aoFechar} aria-label="Fechar painel do item">Fechar</button>
      </header>
      <p className="ag-meta">{ehMetodo ? "Item do método (título e estado vêm do disco)" : "Item criado no ADE"}{item.orfao ? " · órfão: a task sumiu do disco" : ""}{d.sprint_id !== null ? " · em sprint" : ""}</p>
      {item.criterios.length > 0 && <ul className="ag-criterios" aria-label="Critérios de aceite">{item.criterios.map((c, i) => <li key={i}>{c}</li>)}</ul>}

      <Estimativa ctx={ctx} d={d} aoMudar={mudou} />

      <section className="ag-secao" aria-label="Classificação">
        <h4>Categoria, risco e criticidade</h4>
        <div className="ag-grade-campos">
          <Campo rotulo="Categoria"><select value={cls?.categoria ?? ""} onChange={(e) => classificar("categoria", e.target.value)}>{cls === null && <option value="">—</option>}{[...new Set([...CATEGORIAS_PADRAO, ...(cls ? [cls.categoria] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}</select></Campo>
          <Campo rotulo="Risco"><select value={cls?.risco ?? ""} onChange={(e) => classificar("risco", e.target.value)}>{cls === null && <option value="">—</option>}{RISCOS.map((r) => <option key={r} value={r}>{ROTULO_RISCO[r]}</option>)}</select></Campo>
          <Campo rotulo="Criticidade"><select value={cls?.criticidade ?? ""} onChange={(e) => classificar("criticidade", e.target.value)}>{cls === null && <option value="">—</option>}{CRITICIDADES.map((r) => <option key={r} value={r}>{ROTULO_CRITICIDADE[r]}</option>)}</select></Campo>
        </div>
        {cls !== null && <p className="ag-meta">{cls.origem === "humano" ? "decidido por pessoa" : `sugerido (${cls.motor}${cls.confianca !== null ? `, confiança ${Math.round(cls.confianca * 100)} %` : ""})`} · {cls.estado}</p>}
        {cls !== null && cls.risco_fatores.length > 0 && <ul className="ag-fatores" aria-label="Fatores de risco">{cls.risco_fatores.map((f, i) => <li key={i}><strong>{f.fator}</strong> (+{f.peso}): {f.evidencia}</li>)}</ul>}
      </section>

      <section className="ag-secao" aria-label="Priorização">
        <h4>Priorização (1 a 10)</h4>
        <div className="ag-grade-campos">
          <Campo rotulo="Valor"><input type="number" min={1} max={10} value={prio.valor} onChange={(e) => setPrio({ ...prio, valor: e.target.value })} /></Campo>
          <Campo rotulo="Urgência"><input type="number" min={1} max={10} value={prio.urgencia} onChange={(e) => setPrio({ ...prio, urgencia: e.target.value })} /></Campo>
          <Campo rotulo="Redução de risco"><input type="number" min={1} max={10} value={prio.reducao} onChange={(e) => setPrio({ ...prio, reducao: e.target.value })} /></Campo>
          <Campo rotulo="MoSCoW"><select value={prio.moscow} onChange={(e) => setPrio({ ...prio, moscow: e.target.value as Moscow | "" })}>{MOSCOW.map((m) => <option key={m} value={m}>{m === "" ? "—" : m}</option>)}</select></Campo>
        </div>
        <Campo rotulo="Resumo para o cliente (escrito por pessoa)"><textarea rows={2} value={resumo} onChange={(e) => setResumo(e.target.value)} /></Campo>
        <button type="button" className="ag-btn" onClick={salvarPrio}>Salvar</button>
      </section>

      <section className="ag-secao" aria-label="Definição de pronto">
        <h4>Definição de pronto</h4>
        {d.dod.length === 0 ? <p className="ag-meta">Sem critérios avaliados.</p> : <ul className="ag-dod">{d.dod.map((c) => <li key={c.criterio} data-estado={c.estado}><strong>{c.estado === "ok" ? "OK" : c.estado === "falha" ? "Falha" : c.estado === "na" ? "N/A" : "?"}</strong> {c.criterio}<span className="ag-meta"> — {c.motivo}</span></li>)}</ul>}
      </section>

      <section className="ag-secao" aria-label="Retrabalho">
        <h4>Retrabalho</h4>
        <p className="ag-meta">Situação: {d.retrabalho.situacao === null ? "sem avaliação" : ROTULO_SITUACAO[d.retrabalho.situacao]}</p>
        {d.retrabalho.eventos.length > 0 && <ul className="ag-fatores" aria-label="Eventos de retrabalho">{d.retrabalho.eventos.map((e) => <li key={e.id}>{e.fonte} · {e.natureza} · {e.forca}{e.ativo ? "" : " (descartado)"}{e.confirmado_por !== null ? ` · ${e.confirmado_por}` : ""}</li>)}</ul>}
        {podeMarcar ? (
          <>
            <Campo rotulo="Motivo (mín. 5 caracteres; fica na auditoria)"><input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
            <div className="ag-acoes-linha">
              <button type="button" className="ag-btn" disabled={!motivoValido(motivo)} onClick={() => marcar("marcar_retrabalho")}>Marcar retrabalho</button>
              <button type="button" className="ag-btn" disabled={!motivoValido(motivo)} onClick={() => marcar("marcar_primeira")}>Marcar feita de primeira</button>
            </div>
          </>
        ) : <p className="ag-meta">A marcação vale para tasks do método: vincule este item a um trabalho primeiro.</p>}
      </section>

      {!ehMetodo && (
        <section className="ag-secao" aria-label="Método">
          <h4>Levar ao método</h4>
          <div className="ag-acoes-linha">
            {(["prodx", "sprintx", "runx"] as const).map((dest) => <button key={dest} type="button" className="ag-btn" onClick={() => void ctx.api.itemPromover(ctx.ws, item.id, dest).then((r) => setComando(r.comando), falha)}>/{dest}</button>)}
          </div>
          {comando !== null && <p className="ag-comando"><code>{comando}</code> <button type="button" className="ag-btn" onClick={() => void navigator.clipboard?.writeText(comando).then(() => avisar("Comando copiado. Cole no terminal do projeto.", "info"), () => undefined)}>Copiar</button></p>}
          {d.vinculos_sugeridos.length > 0 && (
            <ul className="ag-fatores" aria-label="Trabalhos parecidos">
              {d.vinculos_sugeridos.map((v) => <li key={v.trabalho_id}>{v.titulo} <span className="ag-meta">({Math.round(v.similaridade * 100)} %)</span> <button type="button" className="ag-btn" onClick={() => void ctx.api.itemVincular(ctx.ws, item.id, v.trabalho_id).then(mudou, falha)}>Vincular</button></li>)}
            </ul>
          )}
          {item.trabalho_id !== null && <button type="button" className="ag-btn" onClick={() => void ctx.api.itemVincular(ctx.ws, item.id, null).then(mudou, falha)}>Desfazer vínculo</button>}
        </section>
      )}

      {item.estado_ade !== "descartado" && (
        <section className="ag-secao" aria-label="Descartar">
          <Campo rotulo="Descartar item (informe o motivo)"><input type="text" value={descarte} onChange={(e) => setDescarte(e.target.value)} /></Campo>
          <button type="button" className="ag-btn" disabled={descarte.trim().length < 3} onClick={() => void ctx.api.itemDescartar(ctx.ws, item.id, descarte.trim()).then(() => { aoFechar(); aoMudar(); }, falha)}>Descartar</button>
        </section>
      )}
    </aside>
  );
}
