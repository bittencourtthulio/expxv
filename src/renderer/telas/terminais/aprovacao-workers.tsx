// Aprovações dos workers (D-640): seletor dos 3 níveis (o que o agente faz sozinho / o que continua bloqueado), selo por CLI, confirmação DIGITADA do nível Total,
// seção das Configurações (padrão global), ajustes por projeto e o indicador do cabeçalho do painel do worker. Nada de segredo: só níveis, selos e texto curto.
import "./aprovacao-workers.css";
import { memo, useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";
import {
  DESCRICAO_NIVEL_APROVACAO, NIVEIS_APROVACAO_WORKER, PALAVRA_LIBERAR_TUDO, ROTULO_CURTO_NIVEL_APROVACAO, ROTULO_SELO_APROVACAO, SELO_APROVACAO_POR_CLI, confirmacaoTotalValida, seloAprovacaoDaCli,
  type NivelAprovacaoWorker, type PedidoAprovacaoWorkers, type PreferenciaAprovacaoWorkers,
} from "../../../compartilhado/aprovacao-workers";
import type { AprovacaoDoPane } from "../../../compartilhado/painel-livre";
import type { ApiAde } from "../../../compartilhado/ipc";
import { Dialogo } from "../../componentes/Dialogo";
import { ade } from "../../ade";

type ApiPainelLivre = ApiAde["painelLivre"];
/** Parte da API que estes componentes usam (os testes injetam só isto). */
export type ApiAprovacaoParaTeste = ApiPainelLivre;
const NOME_CLI: Readonly<Record<string, string>> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", grok: "Grok", gemini: "Gemini CLI", qwen: "Qwen Code", aider: "Aider", kilo: "Kilo Code" };
const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : "Não foi possível salvar.");

/** Selos de cada CLI (honestos): quem garante o nível, quem só cumpre em parte e quem continua perguntando. */
export function SelosPorCli({ cli }: { cli?: string | undefined }): ReactElement {
  const lista = cli === undefined ? [...Object.keys(SELO_APROVACAO_POR_CLI), "gemini"] : [cli];
  return (
    <ul className="apw-selos" aria-label="Quanto cada CLI cumpre do nível automático">
      {lista.map((c) => {
        const selo = seloAprovacaoDaCli(c);
        return <li key={c} data-selo={selo}><strong>{NOME_CLI[c] ?? c}</strong> {ROTULO_SELO_APROVACAO[selo]}</li>;
      })}
      {cli === undefined ? <li data-selo="pergunta"><strong>Demais CLIs</strong> {ROTULO_SELO_APROVACAO.pergunta}</li> : null}
    </ul>
  );
}

export interface PropsSeletorNiveis {
  nivel: NivelAprovacaoWorker;
  aoMudar(n: NivelAprovacaoWorker): void;
  confirmacao: string;
  aoConfirmacao(t: string): void;
  /** CLI em foco (mostra só o selo dela); ausente = a tabela de todas. */
  cli?: string | undefined;
  desabilitado?: boolean;
  rotulo?: string;
}

/** Três níveis com descrição simples; o Total pede a palavra digitada e mostra aviso vermelho. */
export function SeletorNiveisAprovacao({ nivel, aoMudar, confirmacao, aoConfirmacao, cli, desabilitado = false, rotulo = "Aprovações dos workers" }: PropsSeletorNiveis): ReactElement {
  const id = useId();
  const perigo = useRef<HTMLDivElement>(null);
  // dentro de um diálogo com rolagem, o aviso e o campo da palavra precisam ficar à vista ao escolher o Total
  useEffect(() => { if (nivel === "total" && typeof perigo.current?.scrollIntoView === "function") perigo.current.scrollIntoView({ block: "nearest" }); }, [nivel]);
  return (
    <div className="apw">
      <div role="radiogroup" aria-label={rotulo} className="apw-niveis">
        {NIVEIS_APROVACAO_WORKER.map((n) => {
          const d = DESCRICAO_NIVEL_APROVACAO[n];
          return (
            <label key={n} className="apw-nivel" data-marcado={nivel === n || undefined} data-nivel={n}>
              <input type="radio" name={`apw-${id}`} value={n} checked={nivel === n} disabled={desabilitado} onChange={() => aoMudar(n)} />
              <span className="apw-corpo">
                <strong>{d.titulo}</strong>
                <span><b>Pode sozinho:</b> {d.pode}</span>
                <span><b>Continua bloqueado:</b> {d.bloqueado}</span>
              </span>
            </label>
          );
        })}
      </div>
      {nivel === "total" ? (
        <div role="alert" className="apw-perigo" ref={perigo}>
          <p><strong>Perigo.</strong> O worker passa a executar sem pedir nada, dentro de um worktree isolado. Push, apagar em massa, sudo, ssh e leitura de chaves continuam bloqueados, mas o resto roda sem você ver. Vale só no Claude Code e nunca na raiz do projeto.</p>
          <label className="apw-confirmar">
            Para liberar, digite <code>{PALAVRA_LIBERAR_TUDO}</code>
            <input type="text" value={confirmacao} disabled={desabilitado} autoComplete="off" spellCheck={false} aria-invalid={confirmacao !== "" && !confirmacaoTotalValida(confirmacao)} onChange={(e) => aoConfirmacao(e.target.value)} />
          </label>
        </div>
      ) : null}
      <SelosPorCli cli={cli} />
    </div>
  );
}

/** Carrega e grava a preferência de um escopo (`null` = padrão global). */
export function useAprovacaoWorkers(workspaceId: string | null, api?: ApiPainelLivre): {
  pref: PreferenciaAprovacaoWorkers | null; erro: string | null; ocupado: boolean; salvar(p: Omit<PedidoAprovacaoWorkers, "workspace_id">): Promise<boolean>;
} {
  const pl = api ?? ade()?.painelLivre;
  const [pref, setPref] = useState<PreferenciaAprovacaoWorkers | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (pl === undefined) return;
    let vivo = true;
    void pl.aprovacao({ workspace_id: workspaceId }).then((r) => { if (vivo) setPref(r); }).catch((e: unknown) => { if (vivo) setErro(mensagemDe(e)); });
    return () => { vivo = false; };
  }, [pl, workspaceId]);
  const salvar = useCallback(async (p: Omit<PedidoAprovacaoWorkers, "workspace_id">): Promise<boolean> => {
    if (pl === undefined) return false;
    setOcupado(true);
    setErro(null);
    try {
      setPref(await pl.aprovacao({ workspace_id: workspaceId, ...p }));
      return true;
    } catch (e) {
      setErro(mensagemDe(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }, [pl, workspaceId]);
  return { pref, erro, ocupado, salvar };
}

/** Configurações > Terminais: padrão global dos workers (vale para projetos sem valor próprio). */
export const SecaoAprovacaoWorkers = memo(function SecaoAprovacaoWorkers({ api }: { api?: ApiPainelLivre | undefined }): ReactElement {
  const { pref, erro, ocupado, salvar } = useAprovacaoWorkers(null, api);
  const [nivel, setNivel] = useState<NivelAprovacaoWorker | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const atual = nivel ?? pref?.nivel ?? "automatico_seguro";
  const mudou = pref !== null && atual !== pref.nivel;
  const podeSalvar = mudou && (atual !== "total" || confirmacaoTotalValida(confirmacao)) && !ocupado;
  const aplicar = async (): Promise<void> => {
    if (!(await salvar({ nivel: atual, ...(atual === "total" ? { confirmacao } : {}) }))) return;
    setNivel(null);
    setConfirmacao("");
  };
  return (
    <section className="cfg-secao apw-secao" aria-label="Aprovações dos workers">
      <h2>Aprovações dos workers (orquestração)</h2>
      <p className="cfg-ajuda">O que os agentes abertos por um orquestrador podem fazer sem pedir a sua permissão. Vale para projetos que não têm valor próprio; o orquestrador em si segue a permissão do projeto. Nunca aprova por você assinatura, risco ALTO nem merge.</p>
      <SeletorNiveisAprovacao nivel={atual} aoMudar={(n) => { setNivel(n); if (n !== "total") setConfirmacao(""); }} confirmacao={confirmacao} aoConfirmacao={setConfirmacao} desabilitado={pref === null || ocupado} />
      <div className="cfg-linha">
        <button type="button" className={atual === "total" ? "botao botao-perigo" : "botao botao-primario"} disabled={!podeSalvar} onClick={() => void aplicar()}>Salvar padrão</button>
        {pref !== null && !mudou ? <span className="cfg-ajuda" role="status">Padrão atual: {ROTULO_CURTO_NIVEL_APROVACAO[pref.nivel]}.</span> : null}
      </div>
      {erro !== null ? <p role="alert" className="cfg-erro">{erro}</p> : null}
    </section>
  );
});

/** Ajustes de UM projeto (aberto pelo cartão do workspace): nível próprio ou herdado, raiz e confiança. */
export function AjustesAprovacaoProjeto({ workspaceId, nome, aoFechar, api }: { workspaceId: string; nome: string; aoFechar(): void; api?: ApiPainelLivre | undefined }): ReactElement {
  const { pref, erro, ocupado, salvar } = useAprovacaoWorkers(workspaceId, api);
  const [nivel, setNivel] = useState<NivelAprovacaoWorker | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [raizPendente, setRaizPendente] = useState(false);
  const atual = nivel ?? pref?.nivel ?? "automatico_seguro";
  const mudou = pref !== null && (atual !== pref.nivel || (nivel !== null && !pref.proprio));
  const podeSalvar = mudou && (atual !== "total" || confirmacaoTotalValida(confirmacao)) && !ocupado;
  return (
    <Dialogo titulo={`Aprovações dos workers em ${nome}`} aoFechar={aoFechar}>
      <div className="dialogo-corpo apw-dialogo">
        {pref !== null && !pref.proprio ? <p className="cfg-ajuda">Este projeto usa o padrão global: {ROTULO_CURTO_NIVEL_APROVACAO[pref.padrao_global]}.</p> : null}
        <SeletorNiveisAprovacao nivel={atual} aoMudar={(n) => { setNivel(n); if (n !== "total") setConfirmacao(""); }} confirmacao={confirmacao} aoConfirmacao={setConfirmacao} desabilitado={pref === null || ocupado} />
        <div className="apw-opcoes">
          <label>
            <input type="checkbox" checked={pref?.confiavel !== false} disabled={pref === null || ocupado} onChange={(e) => void salvar({ confiavel: e.target.checked })} />
            Projeto confiável (comandos como npm run executam código do repositório; desmarcado, os workers perguntam tudo)
          </label>
          <label>
            <input type="checkbox" checked={pref?.permitir_raiz === true || raizPendente} disabled={pref === null || ocupado} onChange={(e) => { if (e.target.checked) setRaizPendente(true); else void salvar({ permitir_raiz: false }); }} />
            Permitir também na raiz do projeto (sem worktree próprio o worker edita a sua árvore principal)
          </label>
          {raizPendente ? (
            <div role="alert" className="apw-perigo">
              <p>Sem worktree, o worker edita direto a árvore principal do projeto (a lista de comandos permitidos e as negativas continuam valendo, e o nível Total nunca vale na raiz). Confirma?</p>
              <div className="cfg-linha">
                <button type="button" className="botao botao-perigo" onClick={() => { void salvar({ permitir_raiz: true }).then(() => setRaizPendente(false)); }}>Sim, permitir na raiz</button>
                <button type="button" className="botao" onClick={() => setRaizPendente(false)}>Cancelar</button>
              </div>
            </div>
          ) : null}
        </div>
        {erro !== null ? <p role="alert" className="cfg-erro">{erro}</p> : null}
      </div>
      <div className="dialogo-acoes">
        {pref?.proprio === true ? <button type="button" className="botao" disabled={ocupado} onClick={() => { void salvar({ herdar: true }).then(() => { setNivel(null); setConfirmacao(""); }); }}>Voltar ao padrão global</button> : null}
        <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Fechar</button>
        <button type="button" className={atual === "total" ? "botao botao-perigo" : "botao botao-primario"} disabled={!podeSalvar} onClick={() => { void salvar({ nivel: atual, ...(atual === "total" ? { confirmacao } : {}) }).then((ok) => { if (ok) { setNivel(null); setConfirmacao(""); } }); }}>Salvar nível</button>
      </div>
    </Dialogo>
  );
}

/** Linha do cartão do workspace: nível vigente + botão para alterar (abre `AjustesAprovacaoProjeto`). */
export function LinhaAprovacaoDoProjeto({ workspaceId, nome, api }: { workspaceId: string; nome: string; api?: ApiPainelLivre | undefined }): ReactElement | null {
  const pl = api ?? ade()?.painelLivre;
  const [aberto, setAberto] = useState(false);
  const [pref, setPref] = useState<PreferenciaAprovacaoWorkers | null>(null);
  useEffect(() => {
    if (pl === undefined || aberto) return;
    let vivo = true;
    void pl.aprovacao({ workspace_id: workspaceId }).then((r) => { if (vivo) setPref(r); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [pl, workspaceId, aberto]);
  if (pl === undefined) return null;
  const rotulo = pref === null ? "…" : ROTULO_CURTO_NIVEL_APROVACAO[pref.nivel];
  return (
    <div className="apw-linha-projeto">
      <span className="apw-chip" data-nivel={pref?.nivel} title="O que os agentes abertos por um orquestrador fazem sem pedir permissão neste projeto">aprovações dos workers: {rotulo}{pref !== null && !pref.proprio ? " (padrão)" : ""}</span>
      <button type="button" className="botao" aria-label={`Alterar aprovações dos workers de ${nome}`} onClick={() => setAberto(true)}>Alterar</button>
      {aberto ? <AjustesAprovacaoProjeto workspaceId={workspaceId} nome={nome} api={pl} aoFechar={() => setAberto(false)} /> : null}
    </div>
  );
}

/** Indicador do cabeçalho do painel do worker ("aprovações: automático seguro"); some em painel que não é worker com política. */
export function IndicadorAprovacaoWorker({ paneId, api }: { paneId: string; api?: ApiPainelLivre | undefined }): ReactElement | null {
  const pl = api ?? ade()?.painelLivre;
  const [info, setInfo] = useState<AprovacaoDoPane | null>(null);
  useEffect(() => {
    if (pl === undefined) return;
    let vivo = true;
    void pl.aprovacaoDoPane(paneId).then((r) => { if (vivo) setInfo(r); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [pl, paneId]);
  if (info === null) return null;
  const rebaixado = info.nivel !== info.nivel_pedido;
  const texto = `aprovações: ${ROTULO_CURTO_NIVEL_APROVACAO[info.nivel]}`;
  const detalhe = [`${texto} (${ROTULO_SELO_APROVACAO[info.selo]})`, rebaixado ? `Configurado: ${ROTULO_CURTO_NIVEL_APROVACAO[info.nivel_pedido]}.` : "", ...info.avisos].filter((x) => x !== "").join("\n");
  return <span className="apw-chip apw-chip-cabecalho" data-nivel={info.nivel} data-selo={info.selo} data-rebaixado={rebaixado || undefined} role="status" aria-label={detalhe} title={detalhe}>{texto}</span>;
}

/** Segundos de espera contínua antes de avisar que o worker está esperando a aprovação do dono. */
export const PRAZO_WORKER_AGUARDANDO_MS = 8_000;

/**
 * Worker de orquestração parado em "aguardando" por mais de `prazoMs` (a CLI está pedindo uma aprovação: nível "perguntar" ou ação fora da lista).
 * Mostra o aviso e o botão "Ir para o painel" (o foco leva o dono até o prompt da CLI); nunca aprova nada por ele.
 */
export function AvisoWorkerAguardando({ aguardando, emFoco, aoIr, prazoMs = PRAZO_WORKER_AGUARDANDO_MS }: { aguardando: boolean; emFoco: boolean; aoIr(): void; prazoMs?: number }): ReactElement | null {
  const [passou, setPassou] = useState(false);
  useEffect(() => {
    setPassou(false);
    if (!aguardando) return;
    const t = setTimeout(() => setPassou(true), prazoMs);
    return () => clearTimeout(t);
  }, [aguardando, prazoMs]);
  if (!aguardando || !passou) return null;
  return (
    <span className="apw-aguardando" role="status">
      <span>Worker aguardando sua aprovação</span>
      {emFoco ? null : <button type="button" onClick={aoIr}>Ir para o painel</button>}
    </span>
  );
}
