import { useState } from "react";
import { TIPOS_DOCUMENTO, type EscopoBusca, type ModoBusca, type TipoDocumento, type ValorFeedback } from "../../../compartilhado/conhecimento";
import { Badge } from "../../componentes/Badge";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import type { EstadoStoreConhecimento, StoreConhecimento } from "../../estado/conhecimento";
import { descreverEstadoConsulta, linhaDeFonte } from "./logica";

const MODOS: ReadonlyArray<[ModoBusca, string]> = [["hibrido", "Híbrida"], ["lexical", "Lexical"], ["semantico", "Semântica"]];
const ESCOPOS: ReadonlyArray<[EscopoBusca, string]> = [["projeto", "Projeto"], ["missao", "Missão"], ["usuario", "Usuário"], ["equipe", "Equipe"]];
const FEEDBACK: ReadonlyArray<[ValorFeedback, string]> = [["util", "Útil"], ["inutil", "Inútil"], ["errado", "Errado"]];
const PERIODOS: ReadonlyArray<[string, string]> = [["", "Qualquer data"], ["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"]];

export interface PropsBusca {
  store: StoreConhecimento;
  estado: EstadoStoreConhecimento;
  aoFechar: () => void;
  aoVerNoGrafo: (titulo: string) => void;
}

/** Resultados da busca: trecho, fonte, estado da consulta, feedback, "ver no grafo" e a prévia do contexto (sempre como TEXTO). */
export function Busca({ store, estado, aoFechar, aoVerNoGrafo }: PropsBusca) {
  const { busca } = estado;
  const [periodo, setPeriodo] = useState("");
  const r = busca.resposta;
  const desc = r !== null ? descreverEstadoConsulta(r.estado, r.aviso) : null;

  const mudarPeriodo = (v: string): void => {
    setPeriodo(v);
    store.definirParametrosBusca({ desde: v === "" ? null : new Date(Date.now() - Number(v) * 86_400_000).toISOString() });
  };

  return (
    <div className="con-busca" role="region" aria-label="Resultados da busca" aria-busy={busca.buscando}>
      <div className="con-busca-cab">
        <label>Modo <select value={busca.params.modo} onChange={(e) => store.definirParametrosBusca({ modo: e.target.value as ModoBusca })}>{MODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label>Escopo <select value={busca.params.escopo} onChange={(e) => store.definirParametrosBusca({ escopo: e.target.value as EscopoBusca })}>{ESCOPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label>Tipo <select value={busca.params.tipos?.[0] ?? ""} onChange={(e) => store.definirParametrosBusca({ tipos: e.target.value === "" ? null : [e.target.value as TipoDocumento] })}><option value="">Todos</option>{TIPOS_DOCUMENTO.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Período <select value={periodo} onChange={(e) => mudarPeriodo(e.target.value)}>{PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <button type="button" className="con-mini" data-tom="primario" disabled={busca.params.consulta.trim() === "" || busca.buscando} onClick={() => void store.buscar()}>Buscar</button>
        <button type="button" className="con-mini" disabled={busca.params.consulta.trim() === ""} onClick={() => void store.previaContexto()} title="Mostra o contexto que um agente receberia para esta tarefa">Prévia do contexto</button>
        <button type="button" className="con-mini" onClick={aoFechar}>Fechar busca</button>
      </div>
      {busca.buscando ? <p role="status">Buscando…</p> : null}
      {busca.erro !== null ? <p className="con-faixa" data-tom="erro" role="alert">{busca.erro}</p> : null}
      {desc !== null && r !== null ? <p role="status"><Badge tom={desc.tom}>{r.estado}</Badge> {desc.texto} <span className="meta">{r.latencia_ms} ms · {r.modelo}</span></p> : null}
      {r !== null && r.resultados.length === 0 && r.estado !== "desligado" ? <EstadoVazio icone="busca" titulo="Nada encontrado" texto="Tente outras palavras, o modo lexical ou um período maior. Se o índice estiver vazio, reindexe em Fontes." /> : null}
      {r !== null && r.resultados.length > 0 ? (
        <ul className="con-resultados" aria-label="Resultados">
          {r.resultados.map((x) => {
            const dado = busca.feedbacks[`chunk:${x.chunk_id}`];
            return (
              <li key={x.chunk_id} className="con-resultado">
                <p>{x.trecho}</p>
                <div className="meta"><strong>{x.fonte.titulo}</strong> · {linhaDeFonte(x.fonte)} · escore {x.escore.toFixed(2)} · {x.braco}</div>
                <div className="acoes" role="group" aria-label={`Ações do resultado ${x.fonte.titulo}`}>
                  {FEEDBACK.map(([v, t]) => (
                    <button key={v} type="button" className="con-mini" aria-pressed={dado === v} disabled={dado !== undefined} onClick={() => void store.darFeedback("chunk", x.chunk_id, v)} title={`Marcar este resultado como ${t.toLowerCase()}`}>{t}</button>
                  ))}
                  <button type="button" className="con-mini" onClick={() => aoVerNoGrafo(x.fonte.titulo)}>Ver no grafo</button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {busca.previa !== null ? (
        <section aria-label="Prévia do contexto">
          <h2>Contexto que um agente receberia</h2>
          <p className="meta">{busca.previa.sinais.ja_existe ? "Já existe algo parecido. " : ""}{busca.previa.sinais.houve_correcao ? "Houve correção anterior. " : ""}{busca.previa.sinais.decisoes_relacionadas} {busca.previa.sinais.decisoes_relacionadas === 1 ? "decisão relacionada" : "decisões relacionadas"} · {busca.previa.estado}</p>
          <pre className="con-previa" tabIndex={0}>{busca.previa.markdown}</pre>
        </section>
      ) : null}
    </div>
  );
}
