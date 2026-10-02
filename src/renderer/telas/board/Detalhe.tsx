import { useEffect, useRef, useState } from "react";
import type { CardBoard, CardDetalhe } from "../../../compartilhado/custo";
import { ade } from "../../ade";
import { pedirTela } from "../../estado/navegacao";
import { CUSTO_DESCONHECIDO, LEGENDA_CUSTO, explicarCusto, formatarCusto, formatarTokens, formatarValorUsd, totalTokens } from "../../estado/custo-formato";
import { duracao, GLIFO_SELO, ROTULO_COLUNA, ROTULO_SELO, ROTULO_SUITE } from "./rotulos";

export interface PropsDetalhe {
  card: CardBoard;
  aoFechar: () => void;
  aoIrPara: (taskId: string) => void;
  aoDelegar: (c: CardBoard) => void;
}
type Estado = { s: "carregando" } | { s: "erro"; texto: string } | { s: "ok"; d: CardDetalhe };

const ORIGEM: Record<string, string> = { cli: "medido pela CLI", proxy: "medido pelo proxy", tabela: "tabela de preços", desconhecido: "sem preço" };

/** Painel lateral de 320 px (`role=complementary`): contrato, dependências, janela, custo por modelo, Panes, handoffs e rastro. Esc fecha. */
export function Detalhe({ card, aoFechar, aoIrPara, aoDelegar }: PropsDetalhe) {
  const [estado, setEstado] = useState<Estado>({ s: "carregando" });
  const [aviso, setAviso] = useState<string | null>(null);
  const raiz = useRef<HTMLElement>(null);

  useEffect(() => {
    let vivo = true;
    const api = ade()?.board;
    if (api === undefined) { setEstado({ s: "erro", texto: "Esta janela não está ligada ao app." }); return undefined; }
    api.cardDetalhe({ workspace_id: card.workspace_id, trabalho_id: card.trabalho_id, task_id: card.task_id }).then(
      (d) => { if (vivo) setEstado({ s: "ok", d }); },
      () => { if (vivo) setEstado({ s: "erro", texto: "Não foi possível abrir o detalhe do card." }); },
    );
    return () => { vivo = false; };
  }, [card]);
  useEffect(() => { raiz.current?.focus(); }, [card.chave]);

  const c = estado.s === "ok" ? estado.d : null;
  const abrirArquivo = async (): Promise<void> => {
    try { setAviso((await ade()!.board.abrirArquivo({ workspace_id: card.workspace_id, trabalho_id: card.trabalho_id, task_id: card.task_id })).ok ? null : "Não foi possível abrir o arquivo."); }
    catch { setAviso("Não foi possível abrir o arquivo."); }
  };
  const copiar = async (): Promise<void> => {
    try {
      const r = await ade()!.metodo.comandoSugerido(card.workspace_id, card.trabalho_id, "retomar", null);
      await navigator.clipboard.writeText(r.comando);
      setAviso(`Comando copiado: ${r.comando}`);
    } catch { setAviso("Não foi possível copiar o comando."); }
  };
  const podeDelegar = card.coluna === "a_fazer" && card.selos.includes("pronta") && !card.selos.includes("delegada");

  return (
    <aside ref={raiz} className="bd-detalhe" role="complementary" aria-label={`Detalhe de ${card.task_id}`} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); aoFechar(); } }}>
      <header className="bd-detalhe-cab">
        <strong>{card.task_id}</strong>
        <span className="bd-detalhe-coluna">{ROTULO_COLUNA[card.coluna]}</span>
        <button type="button" className="botao-mini" aria-label="Fechar detalhe" onClick={aoFechar}>×</button>
      </header>
      <h2 className="bd-detalhe-titulo">{card.titulo}</h2>
      <p className="bd-linha-selos">
        {card.selos.map((s) => <span key={s} className="bd-selo" data-selo={s}><span aria-hidden="true">{GLIFO_SELO[s]}</span> {ROTULO_SELO[s]}</span>)}
        <span className="bd-selo">{ROTULO_SUITE[card.suite]}</span>
        {card.fase !== null ? <span className="bd-selo">fase {card.fase}</span> : null}
      </p>
      <div className="bd-acoes">
        <button type="button" className="botao-mini" onClick={() => void abrirArquivo()}>Abrir arquivo</button>
        <button type="button" className="botao-mini" disabled={card.executor === null && (c?.panes.length ?? 0) === 0} onClick={() => pedirTela("terminais")}>Abrir Pane</button>
        <button type="button" className="botao-mini" onClick={() => void copiar()}>Copiar comando do método</button>
        {podeDelegar ? <button type="button" className="botao-mini" onClick={() => aoDelegar(card)}>Delegar</button> : null}
      </div>
      {aviso !== null ? <p className="bd-nota" role="status">{aviso}</p> : null}
      {estado.s === "carregando" ? <p className="bd-nota" aria-busy="true">Abrindo…</p> : null}
      {estado.s === "erro" ? <p role="alert" className="erro-caixa">{estado.texto}</p> : null}
      {c !== null ? (
        <>
          {c.violacoes.length > 0 ? <section aria-label="Violações"><h3>Violações</h3><ul className="bd-lista">{c.violacoes.map((v, i) => <li key={i}>{v}</li>)}</ul></section> : null}
          <section aria-label="Contrato">
            <h3>Contrato</h3>
            {([["Objetivo", c.contrato.objetivo], ["Critério de aceite", c.contrato.criterio_aceite], ["Teste de integração", c.contrato.teste_integracao], ["Teste funcional", c.contrato.teste_funcional], ["Teste de regressão", c.contrato.teste_regressao]] as const).map(([r, v]) => (
              <p key={r} className="bd-contrato"><span>{r}</span>{v ?? "—"}</p>
            ))}
          </section>
          <section aria-label="Dependências">
            <h3>Dependências</h3>
            {card.depende_de.length === 0 ? <p className="bd-nota">Nenhuma.</p> : <p className="bd-deps">{card.depende_de.map((d) => <button key={d} type="button" className="bd-link" onClick={() => aoIrPara(d)}>{d}</button>)}</p>}
          </section>
          <section aria-label="Janela">
            <h3>Janela</h3>
            {c.janela === null ? <p className="bd-nota">Sem janela observada (o uso desta task, se houver, fica em “sem card”).</p>
              : <p>{c.janela.inicio.slice(0, 16).replace("T", " ")} → {c.janela.fim === null ? "em andamento" : c.janela.fim.slice(0, 16).replace("T", " ")} · origem {c.janela.origem === "banco" ? "banco" : "rastro"} · {duracao(card.duracao_observada_ms)}</p>}
          </section>
          <section aria-label="Custo">
            <h3>Custo <small>{LEGENDA_CUSTO}</small></h3>
            <p title={explicarCusto(c.custo)}><strong>{formatarCusto(c.custo)}</strong> · {formatarTokens(totalTokens(c.custo.tokens))} tokens{card.selos.includes("descartada") ? " · custo preservado (card descartado)" : ""}</p>
            {c.custo_por_modelo.length === 0 ? <p className="bd-nota">Nenhum uso observado neste card.</p> : (
              <ul className="bd-lista" aria-label="Custo por modelo">
                {c.custo_por_modelo.map((m, i) => (
                  <li key={`${m.modelo ?? "?"}-${i}`}>
                    <span>{m.modelo ?? "modelo desconhecido"}</span>
                    <span>{formatarTokens(m.tokens.entrada + m.tokens.cache_leitura)} in · {formatarTokens(m.tokens.saida)} out</span>
                    <span className="bd-custo" data-desconhecido={m.usd === null || undefined} title={ORIGEM[m.origem]}>{m.usd === null ? CUSTO_DESCONHECIDO : formatarValorUsd(m.usd, m.aproximado)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Panes">
            <h3>Panes</h3>
            {c.panes.length === 0 ? <p className="bd-nota">Nenhum Pane.</p> : <ul className="bd-lista">{c.panes.map((p) => <li key={p.pane_id}><span>{p.cli}{p.modelo !== null ? ` · ${p.modelo}` : ""}</span><span>{p.conta_rotulo ?? "—"} · {p.papel}</span></li>)}</ul>}
          </section>
          <section aria-label="Handoffs">
            <h3>Handoffs</h3>
            {c.handoffs.length === 0 ? <p className="bd-nota">Nenhum.</p> : <ul className="bd-lista">{c.handoffs.map((h) => <li key={h.id}><span>{h.status}</span><span>{h.resumo}</span></li>)}</ul>}
          </section>
          <section aria-label="Rastro da task">
            <h3>Rastro</h3>
            {c.rastro.length === 0 ? <p className="bd-nota">Sem eventos.</p> : <ul className="bd-lista">{c.rastro.map((r, i) => <li key={i}><span>{r.ts.slice(5, 16).replace("T", " ")}</span><span>{r.evento}{r.detalhe !== "" ? ` — ${r.detalhe}` : ""}</span></li>)}</ul>}
          </section>
        </>
      ) : null}
    </aside>
  );
}
