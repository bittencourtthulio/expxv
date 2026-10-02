import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommitLog, DetalheCommit, EntradaLogSvn, LinhaBlame, LinhaBlameSvn, LinhaGrafo, CursorLog } from "../../../compartilhado/vcs-tipos";
import { VirtualLista } from "../../componentes/VirtualLista";
import { mensagemDe, useVcs } from "./contexto";
import { DiffView } from "./diff/DiffView";
import { ALTURA_LINHA_LOG, GrafoLinha } from "./Grafo";

const fmtData = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }); };

export function Historico({ abrir }: { abrir: { hash: string; n: number } | null }) {
  const { estado } = useVcs();
  return estado.tipo === "svn" ? <HistoricoSvn /> : <HistoricoGit abrir={abrir} />;
}

function HistoricoGit({ abrir }: { abrir: { hash: string; n: number } | null }) {
  const { api, alvo, estado } = useVcs();
  const [commits, setCommits] = useState<CommitLog[]>([]);
  const [grafo, setGrafo] = useState<LinhaGrafo[] | null>(null);
  const [proximo, setProximo] = useState<CursorLog | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [autor, setAutor] = useState("");
  const [caminho, setCaminho] = useState("");
  const [regex, setRegex] = useState(false);
  const [todos, setTodos] = useState(true);
  const [aplicado, setAplicado] = useState({ busca: "", autor: "", caminho: "", regex: false, todos: true });
  const [detalhe, setDetalhe] = useState<DetalheCommit | null>(null);
  const [blame, setBlame] = useState<{ caminho: string; linhas: LinhaBlame[] } | null>(null);

  const carregar = useCallback(async (cursor: CursorLog | null, anexar: boolean) => {
    setCarregando(true);
    setErro(null);
    try {
      const p = await api.historico(alvo, "log", { limite: 200, cursor, rev: null, todos: aplicado.todos, busca: aplicado.busca || null, regex: aplicado.regex, autor: aplicado.autor || null, caminho: aplicado.caminho || null });
      setCommits((c) => (anexar ? [...c, ...p.commits] : p.commits));
      setGrafo((g) => (p.grafo === null ? null : anexar && g !== null ? [...g, ...p.grafo] : p.grafo));
      setProximo(p.proximo);
    } catch (e) { setErro(mensagemDe(e)); } finally { setCarregando(false); }
  }, [api, alvo, aplicado]);
  useEffect(() => { void carregar(null, false); }, [carregar, estado.status.oid]);

  const abrirDetalhe = useCallback(async (hash: string) => {
    setBlame(null);
    try { setDetalhe(await api.historico(alvo, "detalhe", { rev: hash })); } catch (e) { setErro(mensagemDe(e)); }
  }, [api, alvo]);
  useEffect(() => { if (abrir !== null) void abrirDetalhe(abrir.hash); }, [abrir, abrirDetalhe]);

  const verBlame = async (c: string): Promise<void> => {
    try { setBlame({ caminho: c, linhas: await api.historico(alvo, "blame", { caminho: c, rev: null }) }); setDetalhe(null); } catch (e) { setErro(mensagemDe(e)); }
  };
  const larguraMax = useMemo(() => (grafo ?? []).reduce((m, g) => Math.max(m, g.largura), 1), [grafo]);

  return (
    <div className="vc-historico">
      <div className="vc-col-lista">
        <form className="vc-filtros" role="search" aria-label="Filtrar histórico" onSubmit={(e) => { e.preventDefault(); setAplicado({ busca: busca.trim(), autor: autor.trim(), caminho: caminho.trim(), regex, todos }); }}>
          <input className="vc-campo" aria-label="Buscar na mensagem" placeholder="Mensagem…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <input className="vc-campo" aria-label="Autor" placeholder="Autor" value={autor} onChange={(e) => setAutor(e.target.value)} />
          <input className="vc-campo" aria-label="Caminho" placeholder="Caminho" value={caminho} onChange={(e) => setCaminho(e.target.value)} />
          <label><input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> regex</label>
          <label><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> todas as refs</label>
          <button type="submit" className="vc-mini">Filtrar</button>
          {caminho.trim() !== "" ? <button type="button" className="vc-mini" onClick={() => void verBlame(caminho.trim())}>Blame</button> : null}
        </form>
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        {commits.length === 0 && !carregando ? <div className="vc-vazio">Nenhum commit{aplicado.busca || aplicado.autor || aplicado.caminho ? " com esses filtros" : " ainda"}.</div> : (
          <VirtualLista itens={commits} alturaItem={ALTURA_LINHA_LOG} rotulo="Commits" chave={(c) => c.hash} className="vc-lista" extra={10} renderItem={(c, i) => (
            <button type="button" className="vc-commit-linha-log" data-ativo={detalhe?.hash === c.hash || undefined} onClick={() => void abrirDetalhe(c.hash)}>
              {grafo !== null && grafo[i] !== undefined ? <GrafoLinha g={grafo[i] as LinhaGrafo} larguraMax={larguraMax} /> : null}
              <span className="vc-assunto">{c.assunto}</span>
              {c.refs.slice(0, 3).map((r) => <span key={r} className="vc-ref">{r.replace("HEAD -> ", "")}</span>)}
              <span className="vc-pasta">{c.autor} · {fmtData(c.data)} · <code>{c.hashCurto}</code></span>
            </button>
          )} />
        )}
        <div className="vc-rodape-lista">
          {proximo !== null ? <button type="button" className="vc-mini" disabled={carregando} onClick={() => void carregar(proximo, true)}>{carregando ? "Carregando…" : "Carregar mais"}</button> : <span className="vc-pasta">{commits.length} commits</span>}
        </div>
      </div>
      <div className="vc-col-diff">
        {blame !== null ? <BlameView caminho={blame.caminho} linhas={blame.linhas} aoAbrir={(h) => void abrirDetalhe(h)} /> : detalhe !== null ? (
          <>
            <div className="vc-detalhe-commit">
              <strong>{detalhe.assunto}</strong>
              <span className="vc-pasta">{detalhe.autor} &lt;{detalhe.email}&gt; · {new Date(detalhe.data).toLocaleString("pt-BR")} · <code>{detalhe.hash}</code> · +{detalhe.insercoes} −{detalhe.delecoes}</span>
              {detalhe.corpo.trim() !== "" && detalhe.corpo.trim() !== detalhe.assunto ? <pre className="vc-corpo">{detalhe.corpo}</pre> : null}
            </div>
            <DiffView diff={detalhe.diff} rotulo="Diff do commit" />
          </>
        ) : <div className="vc-d-vazio">Escolha um commit para ver os detalhes e o diff.</div>}
      </div>
    </div>
  );
}

function BlameView({ caminho, linhas, aoAbrir }: { caminho: string; linhas: LinhaBlame[]; aoAbrir: (h: string) => void }) {
  return (
    <div className="vc-blame">
      <div className="vc-diff-barra"><span className="vc-diff-titulo">Blame · {caminho}</span></div>
      <VirtualLista itens={linhas} alturaItem={18} rotulo="Blame" chave={(l) => String(l.linha)} className="vc-d-lista" extra={20} renderItem={(l, i) => (
        <div className="vc-d-linha">
          <button type="button" className="vc-blame-autor" title={`${l.resumo}\n${l.hash}`} onClick={() => aoAbrir(l.hash)}>{i > 0 && linhas[i - 1]?.hash === l.hash ? "" : `${l.hash.slice(0, 7)} ${l.autor}`}</button>
          <span className="vc-d-num">{l.linha}</span>
          <span className="vc-d-texto">{l.conteudo}</span>
        </div>
      )} />
    </div>
  );
}

function HistoricoSvn() {
  const { api, alvo, estado } = useVcs();
  const [entradas, setEntradas] = useState<EntradaLogSvn[]>([]);
  const [proximo, setProximo] = useState<number | null>(null);
  const [sel, setSel] = useState<EntradaLogSvn | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [caminho, setCaminho] = useState("");
  const [blame, setBlame] = useState<LinhaBlameSvn[] | null>(null);
  const carregar = useCallback(async (desde: number | null, anexar: boolean) => {
    setCarregando(true);
    try {
      const p = await api.svn(alvo, "log", { limite: 200, desde, caminho: null });
      setEntradas((e) => (anexar ? [...e, ...p.entradas] : p.entradas));
      setProximo(p.proximo);
    } catch (e) { setErro(mensagemDe(e)); } finally { setCarregando(false); }
  }, [api, alvo]);
  useEffect(() => { void carregar(null, false); }, [carregar, estado.status.oid]);
  return (
    <div className="vc-historico">
      <div className="vc-col-lista">
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        {entradas.length === 0 && !carregando ? <div className="vc-vazio">Sem revisões.</div> : (
          <VirtualLista itens={entradas} alturaItem={ALTURA_LINHA_LOG} rotulo="Revisões" chave={(e) => String(e.revisao)} className="vc-lista" renderItem={(e) => (
            <button type="button" className="vc-commit-linha-log" data-ativo={sel?.revisao === e.revisao || undefined} onClick={() => { setSel(e); setBlame(null); }}>
              <span className="vc-ref">r{e.revisao}</span><span className="vc-assunto">{e.mensagem.split("\n")[0]}</span><span className="vc-pasta">{e.autor} · {fmtData(e.data)}</span>
            </button>
          )} />
        )}
        <div className="vc-rodape-lista">{proximo !== null ? <button type="button" className="vc-mini" disabled={carregando} onClick={() => void carregar(proximo, true)}>Carregar mais</button> : null}</div>
      </div>
      <div className="vc-col-diff">
        <form className="vc-filtros" onSubmit={(ev) => { ev.preventDefault(); if (caminho.trim() !== "") void api.svn(alvo, "blame", { caminho: caminho.trim(), revisao: null }).then(setBlame, (e) => setErro(mensagemDe(e))); }}>
          <input className="vc-campo" aria-label="Arquivo para blame" placeholder="Arquivo (relativo)" value={caminho} onChange={(e) => setCaminho(e.target.value)} />
          <button type="submit" className="vc-mini">Blame</button>
        </form>
        {blame !== null ? (
          <VirtualLista itens={blame} alturaItem={18} rotulo="Blame SVN" chave={(l) => String(l.linha)} className="vc-d-lista" renderItem={(l) => <div className="vc-d-linha"><span className="vc-blame-autor">{l.revisao !== null ? `r${l.revisao} ${l.autor ?? ""}` : ""}</span><span className="vc-d-num">{l.linha}</span><span className="vc-d-texto">{l.texto ?? ""}</span></div>} />
        ) : sel !== null ? (
          <div className="vc-detalhe-commit"><strong>r{sel.revisao} · {sel.autor}</strong><pre className="vc-corpo">{sel.mensagem}</pre>
            <ul className="vc-lista-simples">{sel.caminhos.map((c) => <li key={c.caminho}><span className="vc-letra">{c.acao}</span> <code>{c.caminho}</code></li>)}</ul></div>
        ) : <div className="vc-d-vazio">Escolha uma revisão.</div>}
      </div>
    </div>
  );
}
