// Estado da tela Chat (Fase 15). Tokens de `chat:token` são acumulados num buffer e aplicados UMA vez por quadro (coalescência);
// a mensagem completa (`chat:mensagem`) substitui o parcial. Nada aqui interpreta HTML: o texto é sempre texto.
import { useSyncExternalStore } from "react";
import type { CliChat, ConversaChatDto, ConversaCompleta, EventoChat, EventoChatProgresso, FaixaChat, MensagemChatDto, ModoChat, PedidoDecidirPlano, PerfilChatEstado, PlanoChatDto } from "../../compartilhado/chat";
import { ade } from "../ade";
import { mesclarMensagem, reduzirToken, validarComposer } from "../telas/chat/logica";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";
import { ehCanalAusente } from "./carga";

type Api = NonNullable<ReturnType<typeof ade>>["chat"];

export interface EstadoStoreChat {
  disponivel: boolean;
  workspaceId: string | null;
  conversas: readonly ConversaChatDto[];
  conversasCarregadas: boolean;
  atualId: string | null;
  conversa: ConversaChatDto | null;
  mensagens: readonly MensagemChatDto[];
  planos: readonly PlanoChatDto[];
  progresso: Readonly<Record<string, readonly EventoChatProgresso[]>>;
  perfil: PerfilChatEstado | null;
  modo: ModoChat;
  carregando: boolean;
  erro: string | null;
  enviando: boolean;
  transmitindoId: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export interface OpcoesStoreChat { api?: () => Api | undefined; avisar?: (texto: string, tom?: TomAviso) => unknown; quadro?: (fn: () => void) => void }

export function criarStoreChat(op: OpcoesStoreChat = {}) {
  const obterApi = op.api ?? (() => ade()?.chat);
  const avisar = op.avisar ?? avisarPadrao;
  const quadro = op.quadro ?? ((fn: () => void) => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn()); else setTimeout(fn, 16); });
  const ouvintes = new Set<() => void>();
  const inicial = (): EstadoStoreChat => ({
    disponivel: true, workspaceId: null, conversas: [], conversasCarregadas: false, atualId: null, conversa: null, mensagens: [], planos: [], progresso: {},
    perfil: null, modo: "perguntar", carregando: false, erro: null, enviando: false, transmitindoId: null,
  });
  let estado = inicial();
  let usuarios = 0;
  let desligar: (() => void) | null = null;
  let geracao = 0;
  const buffer = new Map<string, string>();
  let quadroAgendado = false;

  const publicar = (p: Partial<EstadoStoreChat>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const usavel = (a: Api | undefined): a is Api => a !== undefined && typeof a.listarConversas === "function";
  const falha = (e: unknown, prefixo: string): string | null => {
    if (ehCanalAusente(e)) { publicar({ disponivel: false }); return null; }
    return `${prefixo}: ${msg(e)}`;
  };

  function descarregarBuffer(): void {
    if (buffer.size === 0) return;
    let msgs: readonly MensagemChatDto[] = estado.mensagens;
    for (const [id, delta] of buffer) msgs = reduzirToken(msgs, id, delta);
    buffer.clear();
    publicar({ mensagens: msgs });
  }

  function aoEvento(e: EventoChat): void {
    switch (e.canal) {
      case "chat:token": {
        buffer.set(e.payload.mensagem_id, (buffer.get(e.payload.mensagem_id) ?? "") + e.payload.delta);
        if (estado.transmitindoId !== e.payload.mensagem_id) publicar({ transmitindoId: e.payload.mensagem_id });
        if (quadroAgendado) return;
        quadroAgendado = true;
        quadro(() => { quadroAgendado = false; descarregarBuffer(); });
        return;
      }
      case "chat:mensagem": {
        const m = e.payload.mensagem;
        if (m.conversa_id !== estado.atualId) return;
        buffer.delete(m.id);
        publicar({ mensagens: mesclarMensagem(estado.mensagens, m), ...(m.estado !== "transmitindo" && estado.transmitindoId === m.id ? { transmitindoId: null } : {}), ...(m.papel === "assistente" && m.estado !== "transmitindo" ? { enviando: false } : {}) });
        return;
      }
      case "chat:plano": {
        const p = e.payload.plano;
        if (p.conversa_id !== estado.atualId) return;
        const ja = estado.planos.some((x) => x.id === p.id);
        publicar({ planos: ja ? estado.planos.map((x) => (x.id === p.id ? p : x)) : [...estado.planos, p] });
        return;
      }
      case "chat:progresso": {
        const lista = estado.progresso[e.payload.plano_id] ?? [];
        const resto = lista.filter((x) => x.pane_id !== e.payload.pane_id || e.payload.pane_id === null);
        publicar({ progresso: { ...estado.progresso, [e.payload.plano_id]: [...resto, e.payload].slice(-40) } });
      }
    }
  }

  async function guardar<T>(fn: (a: Api) => Promise<T>, prefixo: string): Promise<T | null> {
    const a = obterApi();
    if (!usavel(a)) { publicar({ disponivel: false }); return null; }
    try { return await fn(a); } catch (e) { const t = falha(e, prefixo); if (t !== null) { publicar({ erro: t }); avisar(t, "erro"); } return null; }
  }
  const aplicarCompleta = (c: ConversaCompleta): void => publicar({ atualId: c.conversa.id, conversa: c.conversa, mensagens: c.mensagens, planos: c.planos, carregando: false, erro: null, modo: c.conversa.modo });

  const api = {
    obter: (): EstadoStoreChat => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    reiniciar(): void { geracao++; buffer.clear(); estado = inicial(); ouvintes.forEach((o) => o()); },
    iniciar(): () => void {
      usuarios++;
      if (usuarios === 1 && desligar === null) {
        const a = obterApi();
        const cancelar = a !== undefined && typeof a.assinar === "function" ? a.assinar(aoEvento) : () => undefined;
        desligar = () => { cancelar(); desligar = null; };
      }
      return () => { usuarios = Math.max(0, usuarios - 1); if (usuarios === 0) desligar?.(); };
    },
    definirModo(modo: ModoChat): void { publicar({ modo }); },

    async definirWorkspace(id: string | null): Promise<void> {
      if (id === estado.workspaceId) return;
      geracao++; buffer.clear();
      const modo = estado.modo;
      estado = { ...inicial(), workspaceId: id, modo };
      ouvintes.forEach((o) => o());
      if (id === null) return;
      const g = geracao;
      publicar({ carregando: true });
      const [conversas, perfil] = await Promise.all([guardar((a) => a.listarConversas(id), "Não foi possível listar as conversas"), guardar((a) => a.lerPerfil(id), "Não foi possível ler o perfil do chat")]);
      if (g !== geracao) return;
      publicar({ conversas: conversas ?? [], conversasCarregadas: true, perfil, carregando: false });
      const primeira = conversas?.[0];
      if (primeira !== undefined) await api.abrirConversa(primeira.id);
    },
    async abrirConversa(id: string): Promise<void> {
      const g = geracao;
      buffer.clear();
      publicar({ atualId: id, carregando: true, erro: null, transmitindoId: null });
      const c = await guardar((a) => a.lerConversa(id), "Não foi possível abrir a conversa");
      if (g !== geracao) return;
      if (c === null) { publicar({ carregando: false }); return; }
      aplicarCompleta(c);
    },
    async novaConversa(modo: ModoChat = estado.modo): Promise<ConversaChatDto | null> {
      const w = estado.workspaceId;
      if (w === null) return null;
      const c = await guardar((a) => a.criarConversa({ workspace_id: w, modo, titulo: null, mission_alvo_id: null, indexar: false }), "Não foi possível criar a conversa");
      if (c === null) return null;
      publicar({ conversas: [c, ...estado.conversas], atualId: c.id, conversa: c, mensagens: [], planos: [], modo, erro: null });
      return c;
    },
    async apagarConversa(id: string): Promise<void> {
      const r = await guardar((a) => a.apagarConversa(id), "Não foi possível apagar a conversa");
      if (r?.ok !== true) return;
      const restantes = estado.conversas.filter((c) => c.id !== id);
      publicar({ conversas: restantes });
      if (estado.atualId === id) {
        const prox = restantes[0];
        if (prox !== undefined) await api.abrirConversa(prox.id);
        else publicar({ atualId: null, conversa: null, mensagens: [], planos: [] });
      }
    },

    /** Envia no modo atual; cria a conversa se não houver. Devolve false se a mensagem for inválida. */
    async enviar(texto: string, missionAlvoId: string | null = null): Promise<boolean> {
      if (!validarComposer(texto).ok || estado.enviando) return false;
      let id = estado.atualId;
      if (id === null) { const c = await api.novaConversa(); if (c === null) return false; id = c.id; }
      const modo = estado.modo;
      const otimista: MensagemChatDto = { id: `local-${Date.now()}`, conversa_id: id, papel: "usuario", texto, citacoes: [], plano_id: null, estado: "completa", criado_em: new Date().toISOString() };
      publicar({ mensagens: mesclarMensagem(estado.mensagens, otimista), enviando: true, erro: null });
      const r = await guardar((a) => a.enviar({ conversa_id: id as string, texto, modo, mission_alvo_id: missionAlvoId }), "Não foi possível enviar a mensagem");
      if (r === null) { publicar({ enviando: false, mensagens: estado.mensagens.filter((m) => m.id !== otimista.id) }); return false; }
      publicar({ transmitindoId: r.mensagem_id });
      return true;
    },
    async parar(): Promise<void> {
      const id = estado.transmitindoId;
      if (id === null) { publicar({ enviando: false }); return; }
      await guardar((a) => a.parar(id), "Não foi possível parar");
      descarregarBuffer();
      publicar({ transmitindoId: null, enviando: false });
    },
    async decidirPlano(pedido: PedidoDecidirPlano): Promise<boolean> {
      const p = await guardar((a) => a.decidirPlano(pedido), "Não foi possível registrar a decisão");
      if (p === null) return false;
      publicar({ planos: estado.planos.map((x) => (x.id === p.id ? p : x)) });
      return true;
    },
    async pararPlano(planoId: string): Promise<void> { await guardar((a) => a.pararPlano(planoId), "Não foi possível parar o plano"); },
    async gravarPerfil(p: { cli: CliChat; modelo: string | null; esforco: string | null; faixa: FaixaChat }): Promise<boolean> {
      const w = estado.workspaceId;
      if (w === null) return false;
      const r = await guardar((a) => a.gravarPerfil({ workspace_id: w, ...p }), "Não foi possível gravar o perfil do chat");
      if (r === null) return false;
      publicar({ perfil: r });
      return true;
    },
  };
  return api;
}

export type StoreChat = ReturnType<typeof criarStoreChat>;
export const storeChat: StoreChat = criarStoreChat();
export function useChat(store: StoreChat = storeChat): EstadoStoreChat {
  return useSyncExternalStore(store.assinar, store.obter);
}
