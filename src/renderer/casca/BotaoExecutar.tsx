import "./executar.css";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { apresentarBotao, atalhosDeExecucao } from "../../nucleo/executar/maquina";
import { formatarDuracao } from "../../nucleo/executar/saida";
import { Icone } from "../componentes/Icone";
import { aoPedirExecutar, ligarAtalhosExecutar } from "../estado/executar-acoes";
import { estadoAtivo, storeExecutar, useExecutar, type StoreExecutar } from "../estado/executar";
import { storeAssistenteExecutar, useAssistenteExecutar, type StoreAssistente } from "../estado/executar-assistente";

// Diálogos (confiança e editor de configurações) só entram no JS quando alguém precisa deles.
const Dialogos = lazy(() => import("../telas/executar/Dialogos"));
// O assistente de IA (consentimento, análise, proposta) também só entra no JS quando alguém o abre.
const Assistente = lazy(() => import("../telas/executar/Assistente"));

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Texto anunciado a leitores de tela SÓ nas mudanças de fase (sem o cronômetro, que mudaria a cada segundo). */
function anuncio(fase: string, nome: string | null, mensagem: string | null, porta: number | null): string {
  const n = nome ?? "Projeto";
  if (fase === "preparando") return `${n}: preparando.`;
  if (fase === "rodando") return `${n}: rodando${porta !== null ? ` na porta ${porta}` : ""}.`;
  if (fase === "parando") return `${n}: parando.`;
  if (fase === "concluida" || fase === "falhou" || fase === "parada") return mensagem ?? `${n}: terminou.`;
  return "";
}

/**
 * ▶ Executar / ■ Parar do cabeçalho (grupo ESQUERDO, ao lado do seletor de workspace): ▶ roda a configuração padrão do workspace;
 * vira ■ Parar enquanto roda; o chevron abre o menu com as configurações (detectadas ou do usuário), Reiniciar, Editar e Definir como padrão.
 * F5 / Shift+F5 / Ctrl|⌘+Shift+F5 (⌘R, ⌘., ⌘⇧R no macOS). Nada é lido do projeto antes de abrir o menu ou clicar.
 */
export function BotaoExecutar({ store = storeExecutar, assistente = storeAssistenteExecutar }: { store?: StoreExecutar; assistente?: StoreAssistente }) {
  const ui = useExecutar(store);
  const ass = useAssistenteExecutar(assistente);
  const [aberto, setAberto] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const raiz = useRef<HTMLDivElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);

  useEffect(() => store.ligar(), [store]);
  useEffect(() => ligarAtalhosExecutar(store), [store]);
  useEffect(() => aoPedirExecutar(() => { setAberto(true); }), []);

  // o relógio só corre com execução ativa (nada de timer ocioso no cabeçalho)
  const ativa = estadoAtivo(ui.estado);
  useEffect(() => {
    if (!ativa) return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [ativa]);

  // menu: lê a lista e o histórico SÓ ao abrir (detecção lazy, com cache por mtime no main)
  useEffect(() => {
    if (!aberto) return;
    void store.carregarLista();
    void store.carregarHistorico();
  }, [aberto, store]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (raiz.current !== null && !raiz.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    (raiz.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? raiz.current?.querySelector<HTMLElement>('[role="menuitem"]'))?.focus();
  }, [aberto, ui.lista]);

  const fechar = useCallback(() => { setAberto(false); gatilho.current?.focus(); }, []);
  const teclar = (e: KeyboardEvent) => {
    if (e.key === "Escape" && aberto) { e.stopPropagation(); fechar(); return; }
    if (!aberto) return;
    const itens = [...(raiz.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
    const i = itens.indexOf(document.activeElement as HTMLElement);
    const ir = e.key === "ArrowDown" ? (i + 1) % itens.length : e.key === "ArrowUp" ? (i - 1 + itens.length) % itens.length : e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : -1;
    if (ir >= 0 && itens.length > 0) { e.preventDefault(); itens[ir]?.focus(); }
  };

  if (!ui.disponivel || ui.workspaceId === null) return null;

  const padrao = ui.lista?.configuracoes.find((c) => c.padrao)?.nome ?? null;
  const atalhos = atalhosDeExecucao(MAC);
  const est = ui.estado ?? { fase: "ocioso" as const, workspace_id: ui.workspaceId, execucao_id: null, config_id: null, nome: null, tipo: null, passo: 0, passos_total: 0, sessao_id: null, iniciado_em: null, terminado_em: null, porta: null, url: null, codigo: null, sinal: null, mensagem: null };
  const b = apresentarBotao(est, padrao, agora, atalhos);
  const rodandoHa = est.iniciado_em !== null && ativa ? formatarDuracao(agora - est.iniciado_em) : null;
  const clique = () => { setAberto(false); void (b.acao === "parar" ? store.parar() : store.executar()); };
  const rodar = (id: string) => { fechar(); void store.executar(id); };
  const itens = ui.lista?.configuracoes ?? [];

  return (
    <div className="topo-exec" ref={raiz} onKeyDown={teclar} onBlur={(e) => { if (aberto && !raiz.current?.contains(e.relatedTarget as Node | null)) setAberto(false); }} data-fase={est.fase} data-tom={b.tom}>
      <button type="button" className="topo-workspace topo-exec-botao" data-acao={b.acao} aria-label={b.aria} title={b.tooltip} disabled={b.desabilitado || ui.ocupado} onClick={clique}>
        <Icone nome={b.acao === "parar" ? "parar" : "executar"} />
        <span className="topo-exec-rotulo">{b.rotulo}</span>
      </button>
      <button ref={gatilho} type="button" className="topo-icone topo-exec-chevron" aria-label="Configurações de execução" title="Configurações de execução" aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <Icone nome="chevronBaixo" />
      </button>
      {b.chip !== null ? (
        <span className="topo-exec-chip" data-tom={b.tom} title={b.tooltip} aria-hidden="true">
          {est.fase === "rodando" && rodandoHa !== null ? `rodando há ${rodandoHa}${est.porta !== null ? ` · porta ${est.porta}` : ""}` : b.chip}
        </span>
      ) : null}
      {ativa && est.url !== null ? (
        <button type="button" className="topo-icone topo-exec-link" aria-label={`Abrir ${est.url} no navegador`} title={`Abrir no navegador (${est.url})`} onClick={() => void store.abrirNavegador()}>
          <Icone nome="externo" />
        </button>
      ) : null}
      <span className="exec-anuncio" role="status" aria-live="polite">{anuncio(est.fase, est.nome, est.mensagem, est.porta)}</span>
      {ui.erro !== null ? <span className="topo-exec-erro" role="alert" title={ui.erro}>{ui.erro}</span> : null}

      {aberto ? (
        <div className="topo-exec-menu" role="menu" aria-label="Configurações de execução">
          {ui.lista === null ? <p className="topo-exec-vazio" role="presentation">Detectando o projeto…</p> : null}
          {ui.lista !== null && itens.length === 0 ? <p className="topo-exec-vazio" role="presentation">Nenhuma configuração detectada neste projeto. A IA da sua CLI pode ler o projeto e propor a configuração.</p> : null}
          {itens.map((c) => (
            <div key={c.id} className="topo-exec-linha" role="presentation">
              <button type="button" role="menuitem" className="topo-exec-item" title={(c.avisos ?? []).length > 0 ? `${c.comando}\n${(c.avisos ?? []).map((a) => a.mensagem).join("\n")}` : c.comando} aria-label={`Executar ${c.nome}${c.padrao ? " (padrão)" : ""}${(c.avisos ?? []).length > 0 ? `. Atenção: ${(c.avisos ?? []).map((a) => a.mensagem).join(" ")}` : ""}`} onClick={() => rodar(c.id)}>
                <Icone nome={c.tipo === "build" ? "codigo" : c.tipo === "teste" ? "relatorios" : "executar"} />
                <span className="topo-exec-nome">{c.nome}{c.padrao ? <small> · padrão</small> : null}</span>
                {(c.avisos ?? []).length > 0 ? <span className="topo-exec-aviso" aria-hidden="true"><Icone nome="aviso" /></span> : null}
                <small className="topo-exec-comando">{c.comando}</small>
              </button>
              <button type="button" role="menuitem" className="topo-exec-estrela" data-ligada={c.padrao || undefined} aria-label={c.padrao ? `${c.nome} é a configuração padrão` : `Definir ${c.nome} como padrão`} title={c.padrao ? "Configuração padrão" : "Definir como padrão"} onClick={() => void store.definirPadrao(c.id)}>
                <Icone nome="estrela" />
              </button>
            </div>
          ))}
          <div className="topo-exec-separador" role="separator" />
          {ativa ? <button type="button" role="menuitem" className="topo-exec-item" onClick={() => { fechar(); void store.reiniciar(est.config_id ?? undefined); }}><Icone nome="atualizar" /><span className="topo-exec-nome">Reiniciar</span><small className="topo-exec-comando">{atalhos.alternativo.reiniciar}</small></button> : null}
          {ativa ? <button type="button" role="menuitem" className="topo-exec-item" onClick={() => { fechar(); void store.parar(); }}><Icone nome="parar" /><span className="topo-exec-nome">Parar</span><small className="topo-exec-comando">{atalhos.alternativo.parar}</small></button> : null}
          <button type="button" role="menuitem" className="topo-exec-item" data-assistente title="A IA da sua CLI lê um resumo do projeto e propõe as configurações; você revisa antes de salvar" onClick={() => { setAberto(false); void assistente.abrir(); }}><Icone nome="faiscas" /><span className="topo-exec-nome">Configurar com IA…</span></button>
          <button type="button" role="menuitem" className="topo-exec-item" onClick={() => { setAberto(false); store.abrirEditor(itens.length === 0 ? "novo" : "editar"); }}><Icone nome="config" /><span className="topo-exec-nome">Editar configurações…</span></button>
          {ui.historico.length > 0 ? (
            <div className="topo-exec-historico" role="group" aria-label="Últimas execuções">
              {ui.historico.slice(0, 3).map((h) => (
                <p key={h.execucao_id} role="presentation" data-resultado={h.resultado}>
                  <span>{h.nome}</span>
                  <small>{h.resultado === "sucesso" ? "ok" : h.resultado === "parada" ? "parado" : `código ${h.codigo ?? "?"}`} · {formatarDuracao(h.duracao_ms)}</small>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {ui.confirmacao !== null || ui.editor !== false ? (
        <Suspense fallback={null}>
          <Dialogos store={store} assistente={assistente} />
        </Suspense>
      ) : null}
      {ass.fase !== "fechado" ? (
        <Suspense fallback={null}>
          <Assistente store={assistente} executar={store} />
        </Suspense>
      ) : null}
    </div>
  );
}
