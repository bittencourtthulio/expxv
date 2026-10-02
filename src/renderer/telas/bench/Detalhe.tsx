import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiBench, DetalheResultado } from "../../../compartilhado/bench";
import { MAX_LOG_PAGINA } from "../../../compartilhado/bench";
import { Virtualizada } from "../../componentes/Virtualizada";
import { VISUAL_ESTADO, anexarLog, custoTexto, duracaoTexto, notaTexto } from "./logica";

const ALTURA_LINHA_LOG = 16;
const decodificador = new TextDecoder("utf-8");

/** Painel lateral (recolhível): métricas, checagens, nota manual, entregas, prompt efetivo e log lido por PÁGINAS de 64 KiB (só as linhas visíveis existem no DOM). */
export function Detalhe({ api, resultadoId, aoFechar, aoRerodar, aoMudou }: { api: ApiBench; resultadoId: string; aoFechar: () => void; aoRerodar: (d: DetalheResultado) => void; aoMudou: () => void }) {
  const [d, setD] = useState<DetalheResultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [obs, setObs] = useState("");
  const [log, setLog] = useState("");
  const [proximo, setProximo] = useState(0);
  const [fimLog, setFimLog] = useState(false);
  const [previa, setPrevia] = useState<{ nome: string; texto: string } | null>(null);
  const seq = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++seq.current;
    try {
      const x = await api.resultado(resultadoId);
      if (meu !== seq.current) return;
      setD(x); setErro(null);
      setNota(x.qualidade === null ? "" : String(x.qualidade));
    } catch (e) { if (meu === seq.current) setErro(e instanceof Error ? e.message : "Falha ao ler o resultado."); }
  }, [api, resultadoId]);
  useEffect(() => { setD(null); setLog(""); setProximo(0); setFimLog(false); setPrevia(null); void carregar(); }, [carregar]);

  const maisLog = async (): Promise<void> => {
    try {
      const p = await api.logLer(resultadoId, proximo, MAX_LOG_PAGINA);
      setLog((l) => anexarLog(l, p.texto));
      setProximo(p.proximo);
      if (p.texto === "" || (d !== null && p.proximo >= d.log_bytes)) setFimLog(true);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao ler o log."); }
  };
  const linhas = useMemo(() => (log === "" ? [] : log.split("\n")), [log]);

  const salvarNota = async (): Promise<void> => {
    const n = Number(nota.replace(",", "."));
    if (nota.trim() === "" || !Number.isFinite(n) || n < 0 || n > 10) { setErro("A nota vai de 0 a 10."); return; }
    try { await api.notaManual(resultadoId, n, obs.trim() === "" ? null : obs.trim()); setErro(null); await carregar(); aoMudou(); } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao gravar a nota."); }
  };
  const abrirArtefato = async (nome: string, tipo: string): Promise<void> => {
    if (!tipo.startsWith("text/") && tipo !== "application/json") { setPrevia({ nome, texto: "(binário: sem pré-visualização)" }); return; }
    try {
      const a = await api.artefatoLer(resultadoId, nome);
      const t = decodificador.decode(a.bytes.subarray(0, 20_000));
      setPrevia({ nome, texto: a.bytes.length > 20_000 ? `${t}\n… (cortado)` : t }); // sempre TEXTO: o artefato é dado não confiável, nunca é renderizado
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao ler o artefato."); }
  };

  if (d === null) return <aside className="bn-detalhe" aria-label="Detalhe do resultado">{erro !== null ? <p role="alert" className="bn-erro">{erro}</p> : <p role="status" className="bn-meta">Carregando…</p>}</aside>;
  const v = VISUAL_ESTADO[d.estado];
  const final = d.estado !== "enfileirado" && d.estado !== "executando" && d.estado !== "substituido";
  return (
    <aside className="bn-detalhe" aria-label="Detalhe do resultado">
      <header className="bn-det-cab">
        <h3>{d.tarefa} · {d.alvo}</h3>
        <button type="button" className="bn-btn" onClick={aoFechar} aria-label="Recolher o detalhe">Fechar</button>
      </header>
      <p className="bn-linha-estado" data-tom={v.tom}><span aria-hidden="true">{v.glifo}</span> {v.rotulo} · tentativa {d.tentativa}{d.aviso !== null ? ` · ${d.aviso}` : ""}</p>
      <dl className="bn-resumo">
        <dt>Duração</dt><dd>{duracaoTexto(d.duracao_s)}</dd>
        <dt>Custo</dt><dd>{custoTexto(d.custo_usd)}{d.custo_usd !== null ? ` (${d.custo_fonte === "relatorio_cli" ? "relatado pela CLI" : "tokens × preço"}${d.custo_tipo === "equivalente_api" ? ", equivalente à API" : ""})` : ""}</dd>
        <dt>Tokens</dt><dd>{d.tokens_in ?? "?"} entrada · {d.tokens_out ?? "?"} saída · {d.turnos ?? "?"} turno(s)</dd>
        <dt>Nota</dt><dd>{notaTexto(d.qualidade)} ({d.juiz_estado})</dd>
        <dt>Isolamento</dt><dd>{d.isolamento === "garantido" ? "garantido" : "parcial (a CLI pode ler configuração própria)"}</dd>
      </dl>
      <h4>Checagens</h4>
      {d.checagens.length === 0 ? <p className="bn-meta">Sem checagens automáticas.</p> : (
        <ul className="bn-checagens">{d.checagens.map((c, i) => <li key={i} data-ok={c.ok}><span aria-hidden="true">{c.ok ? "✓" : "✕"}</span> {c.tipo} <code>{c.alvo}</code>{c.critica ? " (crítica)" : ""}: {c.ok ? "ok" : (c.detalhe ?? "falhou")}</li>)}</ul>
      )}
      {final && (
        <>
          <h4>Nota manual</h4>
          <div className="bn-acoes">
            <label className="bn-campo">Nota (0–10)<input inputMode="decimal" value={nota} onChange={(e) => setNota(e.target.value)} style={{ width: 64 }} /></label>
            <label className="bn-campo">Observação<input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} /></label>
            <button type="button" className="bn-btn" onClick={() => void salvarNota()}>Gravar nota</button>
            <button type="button" className="bn-btn" onClick={() => aoRerodar(d)}>Re-rodar…</button>
          </div>
        </>
      )}
      <h4>Entregas ({d.artefatos.length})</h4>
      {d.artefatos.length === 0 ? <p className="bn-meta">Nenhum arquivo entregue.</p> : (
        <ul className="bn-artefatos">{d.artefatos.map((a) => <li key={a.nome}><button type="button" className="bn-link" onClick={() => void abrirArtefato(a.nome, a.tipo)}>{a.nome}</button> <span className="bn-meta">{a.bytes} B</span></li>)}</ul>
      )}
      {previa !== null && <pre className="bn-previa" aria-label={`Conteúdo de ${previa.nome}`}>{previa.texto}</pre>}
      <details>
        <summary>Prompt efetivo</summary>
        <pre className="bn-previa">{d.prompt_efetivo}</pre>
      </details>
      <h4>Log</h4>
      {d.log_bytes === 0 ? <p className="bn-meta">Sem log.</p> : (
        <>
          <div className="bn-log">
            {linhas.length === 0 ? <p className="bn-meta">{d.log_bytes} bytes. Carregue a primeira página.</p> : <Virtualizada itens={linhas} alturaItem={ALTURA_LINHA_LOG} chave={(_l, i) => String(i)} renderizar={(l) => <code className="bn-log-linha">{l}</code>} rotulo="Linhas do log" alturaPadrao={200} />}
          </div>
          <button type="button" className="bn-btn" disabled={fimLog} onClick={() => void maisLog()}>{log === "" ? "Carregar log" : fimLog ? "Fim do log" : "Carregar mais (64 KiB)"}</button>
        </>
      )}
      {erro !== null && <p role="alert" className="bn-erro">{erro}</p>}
    </aside>
  );
}
