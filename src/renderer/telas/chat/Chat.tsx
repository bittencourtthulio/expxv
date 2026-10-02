import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CitacaoChat, CliChat, FaixaChat, ModoChat } from "../../../compartilhado/chat";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Icone } from "../../componentes/Icone";
import { storeChat, useChat, type StoreChat } from "../../estado/chat";
import { aoPedirChat, pedirConhecimento } from "../../estado/conhecimento-acoes";
import { pedirTela } from "../../estado/navegacao";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { Mensagens } from "./Mensagens";
import { CLIS_CHAT, LIMITE_COMPOSER, descreverSemLlm, validarComposer } from "./logica";
import "./chat.css";

const FAIXAS: ReadonlyArray<[FaixaChat, string]> = [["rapido", "Rápido"], ["medio", "Médio"], ["profundo", "Profundo"]];
const ESFORCOS: ReadonlyArray<[string, string]> = [["", "esforço: padrão"], ["baixo", "esforço: baixo"], ["medio", "esforço: médio"], ["alto", "esforço: alto"], ["maximo", "esforço: máximo"]];
const COMANDOS: ReadonlyArray<[string, string]> = [["/perguntar", "responder só com o conhecimento do projeto"], ["/orquestrar", "propor um plano e abrir os terminais"]];
const MODOS: ReadonlyArray<[ModoChat, string]> = [["perguntar", "Perguntar ao RAG"], ["orquestrar", "Pedir ao orquestrador"]];
const DICA: Record<ModoChat, string> = {
  perguntar: "Pergunte ao conhecimento do projeto: “o login já existe?”, “por que escolhemos X?”",
  orquestrar: "Peça ao orquestrador: “preciso implementar X”. Ele consulta o conhecimento, melhora o prompt e propõe um plano para você aprovar.",
};

export interface PropsTelaChat { store?: StoreChat }

export function TelaChat({ store = storeChat }: PropsTelaChat) {
  const { atual } = useWorkspaces(storeWorkspaces);
  const c = useChat(store);
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const modoBotoes = useRef<Array<HTMLButtonElement | null>>([]);
  const wsId = atual?.id ?? null;

  useEffect(() => store.iniciar(), [store]);
  useEffect(() => { void store.definirWorkspace(wsId); }, [store, wsId]);
  useEffect(() => aoPedirChat((p) => {
    if (p === "perguntar" || p === "orquestrar") store.definirModo(p);
    setTimeout(() => campo.current?.focus(), 0);
  }), [store]);

  const semLlm = c.perfil !== null ? descreverSemLlm(c.perfil) : { semLlm: false, motivo: null };
  const clisOk = c.perfil?.clis.filter((x) => x.disponivel).map((x) => x.cli) ?? [];
  const validacao = validarComposer(texto);
  const perfil = c.perfil?.perfil ?? null;

  const enviar = useCallback(async (): Promise<void> => {
    const t = texto.trim();
    if (t === "/perguntar" || t === "/orquestrar") { store.definirModo(t === "/perguntar" ? "perguntar" : "orquestrar"); setTexto(""); return; }
    if (!validarComposer(texto).ok || c.enviando) return;
    const ok = await store.enviar(texto);
    if (ok) setTexto("");
    campo.current?.focus();
  }, [texto, c.enviando, store]);

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar(); return; }
    if (e.key === "Escape" && c.enviando) { e.preventDefault(); e.stopPropagation(); void store.parar(); }
  };

  const trechos = useCallback(async (cit: CitacaoChat): Promise<string[] | null> => {
    const a = ade()?.conhecimento;
    if (a === undefined || wsId === null) return null;
    try { const d = await a.detalheDocumento(wsId, cit.documento_id); return d === null ? null : d.chunks.map((x) => x.trecho); } catch { return null; }
  }, [wsId]);

  const gravarPerfil = (p: Partial<{ cli: CliChat; modelo: string | null; esforco: string | null; faixa: FaixaChat }>): void => {
    void store.gravarPerfil({ cli: perfil?.cli ?? "claude", modelo: perfil?.modelo ?? null, esforco: perfil?.esforco ?? null, faixa: perfil?.faixa ?? "medio", ...p });
  };

  const corpo = (() => {
    if (c.erro !== null && c.mensagens.length === 0) return <div className="chat-vazio" role="alert"><p>{c.erro}</p><button type="button" className="chat-mini" onClick={() => void store.definirWorkspace(null).then(() => store.definirWorkspace(wsId))}>Tentar de novo</button></div>;
    if (c.carregando && c.mensagens.length === 0) return <p className="chat-vazio" role="status" aria-busy="true">Carregando conversa…</p>;
    if (c.mensagens.length === 0) {
      return (
        <EstadoVazio icone="chat" titulo={c.modo === "perguntar" ? "Pergunte ao conhecimento do projeto" : "Peça ao orquestrador"} texto={DICA[c.modo]}>
          {c.perfil !== null && clisOk.length === 0 ? <p className="meta">Nenhuma CLI está pronta. Instale o Claude Code ou o Codex, ou abra o terminal da CLI para fazer login. Enquanto isso, o chat só busca no conhecimento.</p> : null}
        </EstadoVazio>
      );
    }
    return <Mensagens mensagens={c.mensagens} planos={c.planos} progresso={c.progresso} transmitindoId={c.transmitindoId} aoDecidir={(p) => store.decidirPlano(p)} aoPararPlano={(id) => void store.pararPlano(id)} aoTrechos={trechos} aoAbrirFonte={() => pedirConhecimento("fontes")} aoAbrirTela={pedirTela} clisDisponiveis={clisOk} />;
  })();

  if (!c.disponivel) return <section className="chat" data-modo="leitura" data-largura="padrao" aria-label="Chat"><EstadoVazio icone="chat" titulo="Chat indisponível" texto="Este recurso só funciona dentro do aplicativo. Abra o aplicativo desktop." /></section>;
  if (atual === null) return <section className="chat" data-modo="leitura" data-largura="padrao" aria-label="Chat"><EstadoVazio icone="workspaces" titulo="Nenhum projeto aberto" texto="O chat conversa com o conhecimento de um projeto. Abra uma pasta em Workspaces para começar." /></section>;

  return (
    <section className="chat" data-modo="leitura" data-largura="padrao" aria-label="Chat">
      <nav className="chat-lateral" aria-label="Conversas">
        <div className="chat-barra"><h2>Conversas</h2><button type="button" className="chat-icone-btn" aria-label="Nova conversa" title="Nova conversa" onClick={() => { void store.novaConversa().then(() => campo.current?.focus()); }}><Icone nome="mais" /></button></div>
        {c.conversasCarregadas && c.conversas.length === 0 ? <p className="meta">Nenhuma conversa ainda.</p> : null}
        <ul className="chat-conversas">
          {c.conversas.map((v) => (
            <li key={v.id} className="chat-conversa" aria-current={v.id === c.atualId ? "true" : undefined}>
              <button type="button" onClick={() => void store.abrirConversa(v.id)} title={v.titulo}>{v.titulo}</button>
              <button type="button" className="chat-icone-btn" aria-label={`Apagar conversa ${v.titulo}`} title="Apagar conversa" onClick={() => void store.apagarConversa(v.id)}><Icone nome="lixeira" /></button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="chat-principal">
        <div className="chat-barra" role="toolbar" aria-label="Controles do chat">
          <div className="chat-modo" role="radiogroup" aria-label="Modo do chat">
            {MODOS.map(([valor, rotulo], i) => (
              <button
                key={valor}
                ref={(el) => { modoBotoes.current[i] = el; }}
                type="button"
                role="radio"
                aria-checked={c.modo === valor}
                tabIndex={c.modo === valor ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  store.definirModo(valor === "perguntar" ? "orquestrar" : "perguntar");
                  modoBotoes.current[i === 0 ? 1 : 0]?.focus();
                }}
                onClick={() => store.definirModo(valor)}
              >
                {rotulo}
              </button>
            ))}
          </div>
          {c.perfil !== null ? (
            <>
              <select aria-label="CLI do chat" value={perfil?.cli ?? ""} onChange={(e) => gravarPerfil({ cli: e.target.value as CliChat })}>
                {perfil === null ? <option value="">CLI…</option> : null}
                {CLIS_CHAT.map((k) => { const e = c.perfil?.clis.find((x) => x.cli === k); const off = e !== undefined && !e.disponivel; return <option key={k} value={k} disabled={off}>{k}{off ? ` — indisponível: ${e.motivo ?? "sem motivo"}` : ""}</option>; })}
              </select>
              <input aria-label="Modelo do chat" type="text" autoComplete="off" placeholder="modelo (padrão)" style={{ width: 160, minHeight: "var(--campo-altura)", padding: "0 var(--espaco-3)", border: "1px solid var(--borda-campo)", borderRadius: "var(--raio-pequeno)", background: "var(--superficie)", color: "var(--texto)", font: "var(--fs-campo) var(--fonte)" }} defaultValue={perfil?.modelo ?? ""} key={`m-${perfil?.cli}-${perfil?.modelo}`} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (perfil?.modelo ?? "")) gravarPerfil({ modelo: v === "" ? null : v }); }} />
              <select aria-label="Esforço do chat" value={perfil?.esforco ?? ""} onChange={(e) => gravarPerfil({ esforco: e.target.value === "" ? null : e.target.value })}>{ESFORCOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              <select aria-label="Faixa do chat" value={perfil?.faixa ?? "medio"} onChange={(e) => gravarPerfil({ faixa: e.target.value as FaixaChat })}>{FAIXAS.map(([v, t]) => <option key={v} value={v}>Faixa: {t}</option>)}</select>
            </>
          ) : null}
        </div>
        {semLlm.semLlm ? <p className="chat-faixa" data-tom="info" role="status">Modo busca sem LLM: {semLlm.motivo} As respostas listam só o que o conhecimento do projeto encontrar, sem texto gerado.</p> : null}
        {c.modo === "orquestrar" && semLlm.semLlm ? <p className="chat-faixa" role="status">O orquestrador precisa de uma CLI disponível para melhorar o prompt e propor o plano.</p> : null}
        {c.erro !== null && c.mensagens.length > 0 ? <p className="chat-faixa" data-tom="erro" role="alert">{c.erro}</p> : null}
        {corpo}
        <div className="chat-composer">
          {texto.startsWith("/") && !texto.includes(" ") ? (
            <ul className="chat-atalhos" aria-label="Comandos rápidos">{COMANDOS.filter(([k]) => k.startsWith(texto.trim())).map(([k, d]) => <li key={k}><button type="button" className="chat-mini" onClick={() => { setTexto(k); campo.current?.focus(); }}>{k}</button> {d}</li>)}</ul>
          ) : null}
          <label htmlFor="chat-composer" className="chat-sr">Mensagem para o {c.modo === "perguntar" ? "conhecimento do projeto" : "orquestrador"}</label>
          <textarea ref={campo} id="chat-composer" value={texto} placeholder={c.modo === "perguntar" ? "Pergunte ao RAG… (Enter envia, Shift+Enter quebra a linha)" : "Peça ao orquestrador… (Enter envia, Shift+Enter quebra a linha)"} aria-invalid={texto.length > LIMITE_COMPOSER} aria-describedby="chat-composer-ajuda" onChange={(e) => setTexto(e.target.value)} onKeyDown={aoTeclar} />
          <div className="chat-composer-linha">
            <span id="chat-composer-ajuda" className="grow" role={validacao.ok || texto === "" ? undefined : "alert"}>{!validacao.ok && texto !== "" ? validacao.motivo : `${texto.length}/${LIMITE_COMPOSER} · Esc interrompe a resposta`}</span>
            {c.enviando ? <button type="button" className="chat-mini" data-tom="perigo" onClick={() => void store.parar()}>Parar</button> : null}
            <button type="button" className="chat-mini" data-tom="primario" disabled={!validacao.ok || c.enviando} onClick={() => void enviar()}>{c.modo === "perguntar" ? "Perguntar" : "Pedir"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
