// Estado de "Executar projeto" no renderer (D-430…): o botão ▶/■ do cabeçalho, o menu, o diálogo de confiança e o editor.
// Lazy de ponta a ponta: nada é lido do main antes da primeira interação (a configuração só é detectada ao abrir o menu); só uma assinatura
// barata do evento e, em ocioso, o estado do workspace atual (para o botão já nascer certo depois de um reload).
import { useSyncExternalStore } from "react";
import type { ConfigExecucaoIpc, EntradaHistoricoExecutar, EstadoExecucao, EventoExecutar, ListaExecucao, PedidoConfirmacaoExecutar, ResultadoIniciar } from "../../compartilhado/executar";
import type { ApiAde } from "../../compartilhado/ipc";
import { ade } from "../ade";
import { pedirTela } from "./navegacao";
import { storeTerminais } from "./terminais";
import { storeWorkspaces, type StoreWorkspaces } from "./workspaces";

type Api = ApiAde["executar"];

export interface EstadoExecutarUI {
  workspaceId: string | null;
  estado: EstadoExecucao | null;
  lista: ListaExecucao | null;
  historico: readonly EntradaHistoricoExecutar[];
  confirmacao: PedidoConfirmacaoExecutar | null;
  /** editor de configurações aberto; `novo` = assistente "Configurar" (nenhuma configuração ainda) */
  editor: false | "editar" | "novo";
  erro: string | null;
  ocupado: boolean;
  disponivel: boolean;
}

/** O que o terminal precisa saber das sessões do painel "Execução". */
export interface SessoesExecucaoUI {
  ids: ReadonlySet<string>;
  /** sessão nova → sessão que ela substitui (reuso do painel: mesma posição na grade) */
  anterior: ReadonlyMap<string, string>;
  /** sessão a focar assim que estiver na grade (preferência "focar"); `null` = nada pendente */
  foco: string | null;
}

export interface OpcoesStoreExecutar {
  api: () => Api | undefined;
  workspaces?: Pick<StoreWorkspaces, "obter" | "assinar">;
  /** fecha de vez a sessão que o painel reaproveitou (padrão: o store de terminais) */
  fecharSessao?: (id: string) => void;
  irParaTerminais?: () => void;
  /** espera máxima pela Tela antes de fechar a sessão antiga (padrão 1,8 s) */
  esperaTrocaMs?: number;
  /** em ocioso (padrão: `requestIdleCallback`/timeout) */
  ocioso?: (fn: () => void) => void;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const ATIVA = new Set(["preparando", "rodando", "parando"]);
export const estadoAtivo = (e: EstadoExecucao | null): boolean => e !== null && ATIVA.has(e.fase);

const agendarOcioso = (fn: () => void): void => {
  const w = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(fn, { timeout: 4_000 });
  else setTimeout(fn, 2_500);
};

export function criarStoreExecutar(op: OpcoesStoreExecutar) {
  const workspaces = op.workspaces ?? storeWorkspaces;
  const ouvintes = new Set<() => void>();
  const ouvintesSessoes = new Set<() => void>();
  let estado: EstadoExecutarUI = { workspaceId: null, estado: null, lista: null, historico: [], confirmacao: null, editor: false, erro: null, ocupado: false, disponivel: true };
  let sessoes: SessoesExecucaoUI = { ids: new Set(), anterior: new Map(), foco: null };
  const pendentesFechar = new Map<string, ReturnType<typeof setTimeout>>();
  let ligado = false;
  let desligar: Array<() => void> = [];

  const publicar = (p: Partial<EstadoExecutarUI>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const publicarSessoes = (p: Partial<SessoesExecucaoUI>): void => { sessoes = { ...sessoes, ...p }; ouvintesSessoes.forEach((o) => o()); };
  const ws = (): string | null => estado.workspaceId;
  const api = (): Api | undefined => op.api();
  const falha = (e: unknown): void => publicar({ erro: msg(e), ocupado: false });

  async function atualizarEstado(): Promise<void> {
    const id = ws();
    const a = api();
    if (id === null || a === undefined) return;
    try {
      const e = await a.estado(id);
      if (ws() === id) publicar({ estado: e });
    } catch { /* sem serviço ainda: o botão fica em ▶ */ }
  }

  async function carregarLista(): Promise<ListaExecucao | null> {
    const id = ws();
    const a = api();
    if (id === null || a === undefined) return null;
    try {
      const l = await a.listar(id);
      if (ws() === id) publicar({ lista: l });
      return l;
    } catch (e) { falha(e); return null; }
  }

  function aplicarResultado(r: ResultadoIniciar): void {
    if (r.resultado === "iniciado") publicar({ estado: r.estado, confirmacao: null, erro: null, ocupado: false });
    else if (r.resultado === "confirmar") publicar({ confirmacao: r.pedido, ocupado: false, erro: null });
    else { publicar({ editor: "novo", ocupado: false, erro: null }); void carregarLista(); }
  }

  async function chamar(fn: (a: Api, id: string) => Promise<ResultadoIniciar>): Promise<void> {
    const id = ws();
    const a = api();
    if (id === null || a === undefined || estado.ocupado) return;
    publicar({ ocupado: true, erro: null });
    try { aplicarResultado(await fn(a, id)); } catch (e) { falha(e); void atualizarEstado(); }
  }

  function liberarAnterior(id: string): void {
    const t = pendentesFechar.get(id);
    if (t === undefined) return;
    clearTimeout(t);
    pendentesFechar.delete(id);
    (op.fecharSessao ?? ((x: string) => storeTerminais.fechar(x)))(id);
  }

  function aoEvento(ev: EventoExecutar): void {
    if (ev.tipo === "estado") {
      if (ev.estado.workspace_id === ws()) publicar({ estado: ev.estado });
      return;
    }
    if (ev.tipo === "configuracoes") {
      if (ev.workspace_id === ws() && estado.lista !== null) void carregarLista();
      return;
    }
    // sessão do painel "Execução": rotula, troca no mesmo lugar e (preferência) leva o foco
    const ids = new Set(sessoes.ids);
    ids.add(ev.sessao_id);
    const anterior = new Map(sessoes.anterior);
    if (ev.anterior !== null) {
      anterior.set(ev.sessao_id, ev.anterior);
      ids.delete(ev.anterior);
      // a sessão antiga só sai do terminal DEPOIS de a Tela trocá-la no mesmo lugar (`liberarAnterior`); sem Tela montada, sai em instantes
      const antiga = ev.anterior;
      const t = setTimeout(() => liberarAnterior(antiga), op.esperaTrocaMs ?? 1_800);
      pendentesFechar.set(antiga, t);
    }
    publicarSessoes({ ids, anterior, foco: ev.focar ? ev.sessao_id : sessoes.foco });
    if (ev.focar) (op.irParaTerminais ?? (() => pedirTela("terminais")))();
  }

  function seguirWorkspace(): void {
    const id = workspaces.obter().atual?.id ?? null;
    if (id === ws()) return;
    publicar({ workspaceId: id, estado: null, lista: null, historico: [], confirmacao: null, erro: null, editor: false, ocupado: false });
    if (id !== null) (op.ocioso ?? agendarOcioso)(() => void atualizarEstado());
  }

  return {
    obter: (): EstadoExecutarUI => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    obterSessoes: (): SessoesExecucaoUI => sessoes,
    assinarSessoes(o: () => void): () => void { ouvintesSessoes.add(o); return () => void ouvintesSessoes.delete(o); },

    /** Liga a assinatura do evento e o seguimento do workspace atual. Idempotente; devolve o desligador. */
    ligar(): () => void {
      if (!ligado) {
        ligado = true;
        const a = api();
        if (a === undefined) publicar({ disponivel: false });
        else desligar.push(a.assinar(aoEvento));
        desligar.push(workspaces.assinar(seguirWorkspace));
        seguirWorkspace();
      }
      return () => { desligar.forEach((d) => d()); desligar = []; ligado = false; };
    },

    /** F5: executa a configuração padrão ou, se já roda, para. */
    async alternar(): Promise<void> {
      if (estadoAtivo(estado.estado)) await this.parar();
      else await this.executar();
    },
    async executar(configId?: string): Promise<void> { await chamar((a, id) => a.iniciar(id, configId)); },
    async parar(): Promise<void> {
      const id = ws();
      const a = api();
      if (id === null || a === undefined) return;
      try { await a.parar(id); } catch (e) { falha(e); }
    },
    async reiniciar(configId?: string): Promise<void> { await chamar((a, id) => a.reiniciar(id, configId)); },
    async confirmar(): Promise<void> {
      const p = estado.confirmacao;
      if (p === null) return;
      await chamar((a, id) => a.iniciar(id, p.config_id, p.hash));
    },
    cancelarConfirmacao(): void { publicar({ confirmacao: null }); },

    carregarLista,
    async carregarHistorico(): Promise<void> {
      const id = ws();
      const a = api();
      if (id === null || a === undefined) return;
      try { const h = await a.historico(id); if (ws() === id) publicar({ historico: h }); } catch { /* histórico é cortesia */ }
    },
    atualizarEstado,
    abrirEditor(modo: "editar" | "novo" = "editar"): void { publicar({ editor: modo, erro: null }); void carregarLista(); },
    fecharEditor(): void { publicar({ editor: false }); },
    async definirPadrao(configId: string): Promise<void> {
      const id = ws(); const a = api();
      if (id === null || a === undefined) return;
      try { publicar({ lista: await a.definirPadrao(id, configId) }); } catch (e) { falha(e); }
    },
    /** Devolve `null` se gravou, ou o texto do erro (para o editor mostrar ao lado do campo). */
    async gravar(config: ConfigExecucaoIpc, confirmouShell: boolean): Promise<string | null> {
      const id = ws(); const a = api();
      if (id === null || a === undefined) return "Execução indisponível.";
      try { publicar({ lista: await a.gravarConfig(id, config, confirmouShell), erro: null }); return null; } catch (e) { return msg(e); }
    },
    async remover(configId: string): Promise<void> {
      const id = ws(); const a = api();
      if (id === null || a === undefined) return;
      try { publicar({ lista: await a.removerConfig(id, configId) }); } catch (e) { falha(e); }
    },
    async revogar(configId?: string): Promise<void> {
      const id = ws(); const a = api();
      if (id === null || a === undefined) return;
      try { publicar({ lista: await a.revogarConfianca(id, configId) }); } catch (e) { falha(e); }
    },
    async abrirNavegador(): Promise<void> {
      const id = ws(); const a = api();
      if (id === null || a === undefined) return;
      try { await a.abrirUrl(id); } catch (e) { falha(e); }
    },
    limparErro(): void { if (estado.erro !== null) publicar({ erro: null }); },

    // ---- terminal
    ehSessaoDeExecucao: (sessaoId: string): boolean => sessoes.ids.has(sessaoId),
    /** a Tela já trocou a sessão antiga pela nova: pode fechar de vez */
    liberarAnterior,
    /** a Tela já focou: solta o pedido para não roubar o foco de novo */
    consumirFoco(sessaoId: string): void { if (sessoes.foco === sessaoId) publicarSessoes({ foco: null }); },
  };
}

export type StoreExecutar = ReturnType<typeof criarStoreExecutar>;
export const storeExecutar: StoreExecutar = criarStoreExecutar({ api: () => ade()?.executar });

export function useExecutar(store: StoreExecutar = storeExecutar): EstadoExecutarUI {
  return useSyncExternalStore(store.assinar, store.obter);
}
export function useSessoesExecucao(store: StoreExecutar = storeExecutar): SessoesExecucaoUI {
  return useSyncExternalStore(store.assinarSessoes, store.obterSessoes);
}
