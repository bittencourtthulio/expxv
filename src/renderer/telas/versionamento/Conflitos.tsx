import { useCallback, useEffect, useState } from "react";
import type { ArquivoConflito, HunkConflito, InfoConflito, Resolucao, ResultadoDesfazerOperacao, ResultadoOperacao } from "../../../compartilhado/vcs-tipos";
import { Badge } from "../../componentes/Badge";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import { mensagemDe, useVcs } from "./contexto";
import { DialogoCampo } from "./Dialogos";

type Lido = ArquivoConflito & { info: InfoConflito; eol: "lf" | "crlf" };
type TipoNova = "mesclar" | "rebase" | "cherry_pick" | "reverter";
const ROTULO_OP: Record<TipoNova, string> = { mesclar: "Merge", rebase: "Rebase", cherry_pick: "Cherry-pick", reverter: "Reverter commit" };

export function Conflitos() {
  const { estado } = useVcs();
  if (estado.tipo === "svn") return <ConflitosSvn />;
  return (
    <div className="vc-pagina">
      <EmCurso />
      <ListaConflitos />
      <Operacoes />
    </div>
  );
}

function EmCurso() {
  const { api, alvo, estado, rodar, recarregar, avisar } = useVcs();
  const op = estado.operacao;
  const [abortar, setAbortar] = useState(false);
  if (op === null || op.operacao === null) return null;
  const seguir = async (qual: "continuar" | "pular"): Promise<void> => {
    const r = await rodar(() => api.operacao(alvo, qual, {}));
    if (r !== undefined) { avisar(r.resultado === "conflito" ? `Ainda há conflitos: ${r.conflitos.join(", ")}` : `${op.operacao}: ${r.resultado}`); await recarregar(); }
  };
  return (
    <div className="vc-banner" role="status">
      <strong>{op.operacao} em andamento</strong>{op.total !== undefined ? ` · passo ${op.passo ?? "?"}/${op.total}` : ""}{op.parado === "conflito" ? " · resolva os conflitos e continue" : op.parado === "parado" ? " · parado para sua edição" : ""}
      <span className="vc-banner-acoes">
        <button type="button" className="botao botao-primario vc-compacto" disabled={op.conflitos.length > 0} title={op.conflitos.length > 0 ? "Resolva e marque todos os conflitos antes" : "Continuar"} onClick={() => void seguir("continuar")}>Continuar</button>
        {op.operacao !== "merge" ? <button type="button" className="botao vc-compacto" onClick={() => void seguir("pular")}>Pular</button> : null}
        <button type="button" className="botao botao-perigo vc-compacto" onClick={() => setAbortar(true)}>Abortar</button>
      </span>
      {abortar ? <DialogoConfirmacao titulo={`Abortar ${op.operacao}?`} perigoso rotuloConfirmar="Abortar" texto="A operação volta ao estado anterior; resoluções de conflito já feitas nela são descartadas." aoCancelar={() => setAbortar(false)} aoConfirmar={() => { setAbortar(false); void rodar(() => api.operacao(alvo, "abortar", {})).then(() => recarregar()); }} /> : null}
    </div>
  );
}

function ListaConflitos() {
  const { api, alvo, estado, rodar, recarregar, avisar } = useVcs();
  const [lista, setLista] = useState<InfoConflito[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [lido, setLido] = useState<Lido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => { try { setLista(await api.conflitos(alvo, "listar", {})); } catch (e) { setErro(mensagemDe(e)); setLista([]); } }, [api, alvo]);
  useEffect(() => { void carregar(); }, [carregar, estado.status.contagens.conflitos]);
  useEffect(() => {
    setLido(null);
    if (sel === null) return;
    let vivo = true;
    api.conflitos(alvo, "ler", { caminho: sel }).then((l) => { if (vivo) setLido(l); }, () => { if (vivo) setLido(null); });
    return () => { vivo = false; };
  }, [api, alvo, sel]);
  const depois = async (): Promise<void> => { setSel(null); await carregar(); await recarregar(); };
  return (
    <section className="vc-secao" aria-label="Conflitos">
      <h3 className="vc-h3">Conflitos {lista !== null ? <Badge tom={lista.length > 0 ? "alerta" : "sucesso"}>{lista.length}</Badge> : null}</h3>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      {lista !== null && lista.length === 0 ? <div className="vc-vazio">Nenhum conflito.</div> : (
        <div className="vc-conflitos">
          <ul className="vc-lista-simples" aria-label="Arquivos em conflito">
            {(lista ?? []).map((c) => (
              <li key={c.caminho}><button type="button" className="vc-arq-nome" aria-pressed={sel === c.caminho} onClick={() => setSel(c.caminho)}><span className="vc-letra">!</span><span className="vc-nome">{c.caminho}</span><span className="vc-pasta">{c.tipo}{c.hunks > 0 ? ` · ${c.hunks} trecho(s)` : ""}</span></button></li>
            ))}
          </ul>
          <div className="vc-conflito-corpo">
            {sel === null ? <div className="vc-d-vazio">Escolha um arquivo.</div> : lido === null ? <div aria-busy="true" className="vc-d-vazio">Carregando…</div> : lido.info.tipo === "texto" ? (
              <TresVias arquivo={lido} caminho={sel} aoAplicado={depois} />
            ) : (
              <div className="vc-secao">
                <p>Conflito {lido.info.tipo}{lido.info.lado !== undefined ? ` (${lido.info.lado})` : ""}: escolha o lado que vale para o arquivo inteiro.</p>
                <div className="vc-secao-barra">
                  {lido.info.opcoes.map((o) => <button key={o} type="button" className="botao vc-compacto" onClick={() => void rodar(() => api.conflitos(alvo, "resolver_arquivo", { caminho: sel, escolha: o })).then((r) => { if (r !== undefined) { avisar(`${sel}: resolvido (${o}).`); return depois(); } })}>{o === "nossa" ? "Ficar com a nossa" : o === "deles" ? "Ficar com a deles" : "Remover arquivo"}</button>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TresVias({ arquivo, caminho, aoAplicado }: { arquivo: Lido; caminho: string; aoAplicado: () => Promise<void> }) {
  const { api, alvo, rodar, avisar } = useVcs();
  const [res, setRes] = useState<Record<string, Resolucao>>({});
  const [edit, setEdit] = useState<string | null>(null);
  const [foco, setFoco] = useState(0);
  const hunks = arquivo.hunks;
  const h: HunkConflito | undefined = hunks[foco];
  const resolvidos = hunks.filter((x) => res[String(x.id)] !== undefined).length;
  const textoDe = (x: HunkConflito, r: Resolucao | undefined): string => {
    if (r === undefined) return "⟨pendente⟩";
    if (r === "nossa") return x.nossa; if (r === "deles") return x.deles; if (r === "base") return x.base ?? ""; if (r === "ambas") return `${x.nossa}${x.nossa.endsWith("\n") || x.nossa === "" ? "" : "\n"}${x.deles}`;
    return r.editar;
  };
  const escolher = (r: Resolucao): void => { if (h !== undefined) setRes((m) => ({ ...m, [String(h.id)]: r })); };
  const aplicar = async (): Promise<void> => {
    const r = await rodar(() => api.conflitos(alvo, "resolver_hunks", { caminho, resolucoes: res, marcar: true }));
    if (r !== undefined) { avisar(r.marcado ? `${caminho}: resolvido e marcado.` : `${caminho}: restam ${r.restantes} trecho(s).`); await aoAplicado(); }
  };
  if (h === undefined) return <div className="vc-d-vazio">Sem trechos de conflito (marcadores já removidos).</div>;
  return (
    <div className="vc-tresvias">
      <div className="vc-diff-barra">
        <span className="vc-diff-titulo">{caminho} · trecho {foco + 1}/{hunks.length} · {resolvidos} resolvido(s)</span>
        <button type="button" className="vc-mini" disabled={foco === 0} onClick={() => setFoco(foco - 1)}>Anterior</button>
        <button type="button" className="vc-mini" disabled={foco >= hunks.length - 1} onClick={() => setFoco(foco + 1)}>Próximo</button>
      </div>
      <div className="vc-vias">
        <section aria-label="Nossa"><h4>Nossa · {h.rotuloNossa}</h4><pre>{h.nossa}</pre></section>
        <section aria-label="Base"><h4>Base{h.rotuloBase !== null ? ` · ${h.rotuloBase}` : ""}</h4><pre>{h.base ?? "(sem base: estilo merge)"}</pre></section>
        <section aria-label="Deles"><h4>Deles · {h.rotuloDeles}</h4><pre>{h.deles}</pre></section>
      </div>
      <div className="vc-secao-barra" role="group" aria-label="Resolução do trecho">
        <button type="button" className="botao vc-compacto" aria-pressed={res[String(h.id)] === "nossa"} onClick={() => escolher("nossa")}>Nossa</button>
        <button type="button" className="botao vc-compacto" disabled={h.base === null} aria-pressed={res[String(h.id)] === "base"} onClick={() => escolher("base")}>Base</button>
        <button type="button" className="botao vc-compacto" aria-pressed={res[String(h.id)] === "deles"} onClick={() => escolher("deles")}>Deles</button>
        <button type="button" className="botao vc-compacto" aria-pressed={res[String(h.id)] === "ambas"} onClick={() => escolher("ambas")}>Ambas</button>
        <button type="button" className="botao vc-compacto" onClick={() => setEdit(textoDe(h, res[String(h.id)] ?? "ambas"))}>Editar…</button>
      </div>
      <section className="vc-resultado" aria-label="Resultado do trecho"><h4>Resultado</h4><pre>{textoDe(h, res[String(h.id)])}</pre></section>
      <div className="vc-secao-barra"><button type="button" className="botao botao-primario vc-compacto" disabled={resolvidos === 0} onClick={() => void aplicar()}>{resolvidos === hunks.length ? "Aplicar e marcar resolvido" : `Aplicar ${resolvidos} de ${hunks.length}`}</button></div>
      {edit !== null ? (
        <Dialogo titulo="Editar resultado do trecho" aoFechar={() => setEdit(null)} largura={720}>
          <div className="dialogo-corpo"><textarea className="vc-editor" aria-label="Texto final do trecho" data-foco-inicial rows={14} value={edit} onChange={(e) => setEdit(e.target.value)} /></div>
          <div className="dialogo-acoes"><button type="button" className="botao" onClick={() => setEdit(null)}>Cancelar</button><button type="button" className="botao botao-primario" onClick={() => { escolher({ editar: edit }); setEdit(null); }}>Usar este texto</button></div>
        </Dialogo>
      ) : null}
    </div>
  );
}

function Operacoes() {
  const { api, alvo, estado, rodar, recarregar, avisar } = useVcs();
  const [nova, setNova] = useState<TipoNova | null>(null);
  const [previa, setPrevia] = useState<{ tipo: TipoNova; rev: string; r: ResultadoOperacao } | null>(null);
  const [desfazer, setDesfazer] = useState<ResultadoDesfazerOperacao | null>(null);
  const emCurso = estado.operacao?.operacao != null;
  const simular = async (tipo: TipoNova, rev: string): Promise<ResultadoOperacao | undefined> => {
    if (tipo === "mesclar") return rodar(() => api.operacao(alvo, "mesclar", { rev, sem_ff: false, squash: false, mensagem: null, simular: true }));
    if (tipo === "rebase") return rodar(() => api.operacao(alvo, "rebase", { base: rev, simular: true }));
    if (tipo === "cherry_pick") return rodar(() => api.operacao(alvo, "cherry_pick", { revs: [rev], mainline: null, simular: true }));
    return rodar(() => api.operacao(alvo, "reverter", { revs: [rev], mainline: null, simular: true }));
  };
  const executar = async (tipo: TipoNova, rev: string): Promise<ResultadoOperacao | undefined> => {
    if (tipo === "mesclar") return rodar(() => api.operacao(alvo, "mesclar", { rev, sem_ff: false, squash: false, mensagem: null, simular: false }));
    if (tipo === "rebase") return rodar(() => api.operacao(alvo, "rebase", { base: rev, simular: false }));
    if (tipo === "cherry_pick") return rodar(() => api.operacao(alvo, "cherry_pick", { revs: [rev], mainline: null, simular: false }));
    return rodar(() => api.operacao(alvo, "reverter", { revs: [rev], mainline: null, simular: false }));
  };
  return (
    <section className="vc-secao" aria-label="Operações">
      <h3 className="vc-h3">Operações</h3>
      <div className="vc-secao-barra">
        {(Object.keys(ROTULO_OP) as TipoNova[]).map((t) => <button key={t} type="button" className="botao vc-compacto" disabled={emCurso || estado.status.contagens.conflitos > 0} title={emCurso ? "Há uma operação em andamento" : `Simula antes de executar`} onClick={() => setNova(t)}>{ROTULO_OP[t]}…</button>)}
        <button type="button" className="botao vc-compacto" disabled={emCurso} onClick={() => void rodar(() => api.historico(alvo, "desfazer_ultima", { simular: true })).then((r) => { if (r !== undefined) setDesfazer(r); })}>Desfazer última operação…</button>
      </div>
      {nova !== null ? <DialogoCampo titulo={`${ROTULO_OP[nova]}: simulação primeiro`} rotulo={nova === "rebase" ? "Base (branch ou commit)" : "Branch ou commit"} rotuloConfirmar="Simular" aoCancelar={() => setNova(null)} aoConfirmar={(rev) => { const t = nova; setNova(null); void simular(t, rev).then((r) => { if (r !== undefined) setPrevia({ tipo: t, rev, r }); }); }} texto={<p>Nada é alterado na simulação.</p>} /> : null}
      {previa !== null ? (
        <Dialogo titulo={`${ROTULO_OP[previa.tipo]} de ${previa.rev}`} aoFechar={() => setPrevia(null)} largura={560}>
          <div className="dialogo-corpo">
            <p>{previa.r.commits !== undefined ? `${previa.r.commits.length} commit(s) entrariam.` : "Simulação concluída."}</p>
            {previa.r.conflitosPrevistos !== undefined && previa.r.conflitosPrevistos.length > 0 ? <><p className="vc-aviso" role="alert">Conflitos previstos:</p><ul className="vc-lista-simples">{previa.r.conflitosPrevistos.map((c) => <li key={c}><code>{c}</code></li>)}</ul></> : <p>Nenhum conflito previsto.</p>}
            {previa.r.avisosTexto?.map((a) => <p key={a} className="vc-aviso" role="note">{a}</p>)}
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" data-foco-inicial onClick={() => setPrevia(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" onClick={() => { const p = previa; setPrevia(null); void executar(p.tipo, p.rev).then(async (r) => { if (r !== undefined) { avisar(r.resultado === "conflito" ? `Conflitos: ${r.conflitos.join(", ")}` : `${ROTULO_OP[p.tipo]}: ${r.resultado}`); await recarregar(); } }); }}>Executar {ROTULO_OP[previa.tipo].toLowerCase()}</button>
          </div>
        </Dialogo>
      ) : null}
      {desfazer !== null ? (
        desfazer.seguro ? (
          <DialogoConfirmacao titulo="Desfazer a última operação?" rotuloConfirmar="Desfazer" perigoso texto={<>Desfaz <strong>{desfazer.operacao}</strong> ({desfazer.de.slice(0, 7)} → {desfazer.para.slice(0, 7)}) em modo {desfazer.modo}. {desfazer.mudariam.length > 0 ? `${desfazer.mudariam.length} arquivo(s) mudam de conteúdo.` : "Nenhum arquivo muda de conteúdo."}</>} aoCancelar={() => setDesfazer(null)} aoConfirmar={() => { setDesfazer(null); void rodar(() => api.historico(alvo, "desfazer_ultima", { simular: false })).then(async (r) => { if (r !== undefined) { avisar(r.seguro && r.desfeito ? "Operação desfeita." : "Nada foi desfeito."); await recarregar(); } }); }} />
        ) : (
          <Dialogo titulo="Não é seguro desfazer" aoFechar={() => setDesfazer(null)}><div className="dialogo-corpo"><p>{desfazer.motivo}</p></div><div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={() => setDesfazer(null)}>Entendi</button></div></Dialogo>
        )
      ) : null}
    </section>
  );
}

function ConflitosSvn() {
  const { api, alvo, estado, rodar, recarregar, avisar } = useVcs();
  const [lista, setLista] = useState<Array<{ caminho: string; tipo: string }> | null>(null);
  const carregar = useCallback(async () => { try { setLista(await api.svn(alvo, "conflitos", {})); } catch { setLista([]); } }, [api, alvo]);
  useEffect(() => { void carregar(); }, [carregar, estado.status.contagens.conflitos]);
  const resolver = async (c: string, aceitar: "mine-full" | "theirs-full" | "working"): Promise<void> => {
    if ((await rodar(() => api.svn(alvo, "resolver", { caminhos: [c], aceitar }))) !== undefined) { avisar(`${c}: resolvido.`); await carregar(); await recarregar(); }
  };
  return (
    <div className="vc-pagina">
      <section className="vc-secao" aria-label="Conflitos SVN">
        <h3 className="vc-h3">Conflitos (SVN)</h3>
        {lista === null ? <div aria-busy="true" className="vc-vazio">Carregando…</div> : lista.length === 0 ? <div className="vc-vazio">Nenhum conflito. Atualize a cópia para buscar mudanças do servidor.</div> : (
          <ul className="vc-lista-simples">{lista.map((c) => (
            <li key={c.caminho}><code>{c.caminho}</code> <Badge tom="alerta">{c.tipo}</Badge>
              <span className="vc-ramo-acoes">
                <button type="button" className="vc-mini" onClick={() => void resolver(c.caminho, "mine-full")}>Ficar com o meu</button>
                <button type="button" className="vc-mini" onClick={() => void resolver(c.caminho, "theirs-full")}>Ficar com o do servidor</button>
                <button type="button" className="vc-mini" onClick={() => void resolver(c.caminho, "working")}>Já editei: marcar resolvido</button>
              </span></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
