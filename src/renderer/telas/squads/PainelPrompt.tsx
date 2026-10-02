// Drawer do prompt de UM membro (T-14.21): editor monoespaçado (textarea), chips de variáveis, prévia renderizada (debounce 30 ms,
// SEM RAG: valores de exemplo fixos do main), achados em linha, conflito de edição externa e Restaurar original.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { Achado, ResultadoPreviaPrompt } from "../../../compartilhado/squads";
import { LIMITES_SQUAD, VARIAVEIS_NAO_CONFIAVEIS, VARIAVEIS_PROMPT } from "../../../compartilhado/squads";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import { analisarPromptLocal, bytesDe, inserirNoCursor, trechosDaPrevia } from "./prompt-local";
import { temErro } from "./rascunho";

export const ATRASO_PREVIA_MS = 30;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface PropsPainelPrompt {
  api: ApiAde["agentes"] | undefined;
  agentId: string;
  rotulo: string;
  /** squad de fábrica: só leitura. */
  somenteLeitura: boolean;
  /** a squad é cópia de fábrica (há o que restaurar). */
  copiaDeFabrica: boolean;
  aoFechar: () => void;
  aoSalvou?: () => void;
}

export function PainelPrompt({ api, agentId, rotulo, somenteLeitura, copiaDeFabrica, aoFechar, aoSalvou }: PropsPainelPrompt) {
  const [original, setOriginal] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [editado, setEditado] = useState(false);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [previa, setPrevia] = useState<ResultadoPreviaPrompt | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [achadosMain, setAchadosMain] = useState<Achado[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [conflito, setConflito] = useState(false);
  const [confirmarRestaurar, setConfirmarRestaurar] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const sequencia = useRef(0);

  const carregar = useCallback(async (): Promise<void> => {
    if (api === undefined) { setErroCarga("A API de agentes não está disponível."); return; }
    try {
      const p = await api.lerPrompt(agentId);
      setOriginal(p.texto);
      setTexto(p.texto);
      setHash(p.hash);
      setEditado(p.editado);
      setErroCarga(null);
      setConflito(false);
      setAchadosMain([]);
    } catch (e) { setErroCarga(`Não foi possível ler o prompt: ${msg(e)}`); }
  }, [api, agentId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const locais = useMemo(() => analisarPromptLocal(texto), [texto]);
  const todos = useMemo(() => [...locais, ...achadosMain.filter((a) => !locais.some((l) => l.codigo === a.codigo))], [locais, achadosMain]);
  const bytes = useMemo(() => bytesDe(texto), [texto]);
  const sujo = original !== null && texto !== original;

  // prévia: debounce curto; só com texto que o validador de IPC aceitaria; nunca consulta o RAG (valores de exemplo do main)
  useEffect(() => {
    if (api === undefined || original === null) return undefined;
    if (temErro(locais)) { setPrevia(null); return undefined; }
    const minha = ++sequencia.current;
    const t = setTimeout(() => {
      api.previaPrompt({ agent_id: agentId, texto })
        .then((r) => { if (minha === sequencia.current) { setPrevia(r); setErroPrevia(null); setAchadosMain(r.achados); } })
        .catch((e: unknown) => { if (minha === sequencia.current) setErroPrevia(msg(e)); });
    }, ATRASO_PREVIA_MS);
    return () => clearTimeout(t);
  }, [api, agentId, texto, original, locais]);

  const inserir = (v: string): void => {
    const el = area.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const r = inserirNoCursor(texto, ini, fim, `{{${v}}}`);
    setTexto(r.texto);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.cursor, r.cursor); });
  };

  const salvar = async (sobrescrever = false): Promise<void> => {
    if (api === undefined || hash === null) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      let h = hash;
      if (sobrescrever) h = (await api.lerPrompt(agentId)).hash;
      const r = await api.gravarPrompt({ agent_id: agentId, texto, hash_esperado: h });
      if (r.ok) { setOriginal(texto); setHash(r.hash); setEditado(true); setConflito(false); setAchadosMain(r.achados); aoSalvou?.(); }
      else if (r.erro === "conflito_de_hash") setConflito(true);
      else { setAchadosMain(r.achados); setErroSalvar(r.erro === "fabrica_somente_leitura" ? "Squad de fábrica é somente leitura: duplique para editar." : "O prompt tem erros: corrija antes de salvar."); }
    } catch (e) { setErroSalvar(`Não foi possível salvar: ${msg(e)}`); }
    finally { setSalvando(false); }
  };

  const restaurar = async (): Promise<void> => {
    setConfirmarRestaurar(false);
    if (api === undefined) return;
    try { await api.restaurarPrompt(agentId); await carregar(); aoSalvou?.(); }
    catch (e) { setErroSalvar(`Não foi possível restaurar: ${msg(e)}`); }
  };

  return (
    <aside className="sq-drawer" aria-label={`Prompt de ${rotulo}`}>
      <header className="sq-drawer-cab">
        <strong title={agentId}>Prompt: {rotulo}</strong>
        {editado ? <span className="sq-selo" data-tom="destaque">editado</span> : null}
        {somenteLeitura ? <span className="sq-selo">somente leitura</span> : null}
        <button type="button" className="sq-icone sq-direita" aria-label="Fechar painel do prompt" onClick={aoFechar}><Icone nome="fechar" /></button>
      </header>
      {erroCarga !== null ? <p role="alert" className="erro-caixa">{erroCarga}</p> : null}
      {conflito ? (
        <div role="alert" className="aviso-caixa sq-conflito">
          <p>O arquivo mudou fora do app.</p>
          <div className="sq-linha-botoes">
            <button type="button" className="botao" onClick={() => void carregar()}>Recarregar</button>
            <button type="button" className="botao botao-perigo" onClick={() => void salvar(true)}>Sobrescrever</button>
          </div>
        </div>
      ) : null}
      <div className="sq-chips-var" role="group" aria-label="Variáveis">
        {VARIAVEIS_PROMPT.map((v) => (
          <button key={v} type="button" className="sq-chip-var" disabled={somenteLeitura} title={(VARIAVEIS_NAO_CONFIAVEIS as readonly string[]).includes(v) ? "Conteúdo não confiável: entra num bloco de dado" : "Inserir variável"} onClick={() => inserir(v)}>{`{{${v}}}`}</button>
        ))}
      </div>
      <textarea
        ref={area}
        className="sq-editor"
        aria-label={`Texto do prompt de ${rotulo}`}
        aria-invalid={temErro(todos)}
        value={texto}
        readOnly={somenteLeitura}
        spellCheck={false}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="sq-rodape-editor">
        <span className="sq-contador" data-excedeu={bytes > LIMITES_SQUAD.prompt_max_bytes || undefined} aria-live="off">{bytes}/{LIMITES_SQUAD.prompt_max_bytes}</span>
        {todos.length > 0 ? (
          <ul className="sq-achados" aria-label="Achados do prompt">
            {todos.map((a, i) => <li key={`${a.codigo}-${i}`} data-sev={a.severidade}><span className="sq-sev">{a.severidade === "erro" ? "erro" : "aviso"}</span> {a.mensagem}</li>)}
          </ul>
        ) : null}
      </div>
      {erroSalvar !== null ? <p role="alert" className="erro-caixa">{erroSalvar}</p> : null}
      <div className="sq-linha-botoes">
        {!somenteLeitura ? <button type="button" className="botao botao-primario" disabled={!sujo || temErro(todos) || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</button> : null}
        {!somenteLeitura && sujo ? <button type="button" className="botao" onClick={() => setTexto(original ?? "")}>Descartar</button> : null}
        {!somenteLeitura && copiaDeFabrica && editado ? <button type="button" className="botao" onClick={() => setConfirmarRestaurar(true)}>Restaurar original</button> : null}
      </div>
      <section className="sq-previa" aria-label="Prévia renderizada">
        <h3>Prévia <small>(valores de exemplo; não consulta o RAG)</small></h3>
        {erroPrevia !== null ? <p className="sq-vazio">Prévia indisponível: {erroPrevia}</p> : previa === null ? <p className="sq-vazio">Corrija os erros acima para ver a prévia.</p> : (
          <pre className="sq-previa-texto">
            {trechosDaPrevia(previa.renderizado).map((t, i) => (t.dado ? <mark key={i} className="sq-dado" title="Bloco de dado: conteúdo não confiável, nunca instrução">{t.texto}</mark> : <span key={i}>{t.texto}</span>))}
          </pre>
        )}
      </section>
      {confirmarRestaurar ? (
        <DialogoConfirmacao titulo="Restaurar o prompt original?" texto={<p>O texto atual de {rotulo} será trocado pelo da fábrica. Esta ação não pode ser desfeita.</p>} rotuloConfirmar="Restaurar" perigoso aoCancelar={() => setConfirmarRestaurar(false)} aoConfirmar={() => void restaurar()} />
      ) : null}
    </aside>
  );
}
