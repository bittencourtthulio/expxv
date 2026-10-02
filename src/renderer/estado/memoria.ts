// Estado da tela Memória (Fase 8, T-08.21). `useSyncExternalStore`: só quem lê re-renderiza. Chunk lazy da tela: nada disto roda no boot.
// Evento `memoria:entrada_criada` NÃO recarrega a lista: é coalescido em 1 quadro e só o TOPO é buscado e mesclado (mesclarNovas).
import { useSyncExternalStore } from "react";
import type { ConfigMemoria, EntradaMemoria, EscopoMemoria, EstadoMemoriaApp, EventoMemoria, FonteMemoria, PedidoConfigMemoria, PreviaBrief, ResultadoRestaurar, TipoMemoria } from "../../compartilhado/memoria";
import { ade } from "../ade";
import { abaListaEntradas, escopoDaAba, mesclarNovas, type AbaMemoria } from "../telas/memoria/logica";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";
import { ehCanalAusente } from "./carga";

type Api = NonNullable<ReturnType<typeof ade>>["memoria"];

export const PAGINA = 100;

export interface FiltrosMemoria {
  aba: AbaMemoria;
  tipos: readonly TipoMemoria[];
  busca: string;
  missionId: string | null;
  paneId: string | null;
  origem: FonteMemoria | null;
}

export interface EstadoStoreMemoria {
  /** false = canal ausente (fora do Electron). */
  disponivel: boolean;
  workspaceId: string | null;
  estado: EstadoMemoriaApp | null;
  erroEstado: string | null;
  filtros: FiltrosMemoria;
  itens: readonly EntradaMemoria[];
  proximo: string | null;
  carregando: boolean;
  carregandoMais: boolean;
  erro: string | null;
  /** entradas criadas que não couberam na lista atual (filtro ativo): o usuário recarrega quando quiser. */
  novas: number;
  preferencias: readonly EntradaMemoria[];
  prefCarregado: boolean;
  prefErro: string | null;
  previas: Readonly<Record<string, PreviaBrief>>;
}

export const FILTROS_INICIAIS: FiltrosMemoria = { aba: "pane", tipos: [], busca: "", missionId: null, paneId: null, origem: null };
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface OpcoesStoreMemoria {
  api?: () => Api | undefined;
  avisar?: (texto: string, tom?: TomAviso) => unknown;
  /** agenda o fim do quadro (coalescência de eventos); em teste, execução controlada. */
  quadro?: (fn: () => void) => void;
}

export function criarStoreMemoria(op: OpcoesStoreMemoria = {}) {
  const obterApi = op.api ?? (() => ade()?.memoria);
  const avisar = op.avisar ?? avisarPadrao;
  const quadro = op.quadro ?? ((fn: () => void) => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn()); else setTimeout(fn, 16); });
  const ouvintes = new Set<() => void>();
  let estado: EstadoStoreMemoria = {
    disponivel: true, workspaceId: null, estado: null, erroEstado: null, filtros: FILTROS_INICIAIS, itens: [], proximo: null, carregando: false, carregandoMais: false, erro: null, novas: 0,
    preferencias: [], prefCarregado: false, prefErro: null, previas: {},
  };
  let iniciado = false;
  let listaPronta = false; // a lista da aba atual já foi pedida para este workspace
  let geracao = 0; // descarta respostas de pedidos velhos (troca de workspace/filtro no meio do voo)
  let pendentes = 0;
  let quadroAgendado = false;
  let buscaTimer: ReturnType<typeof setTimeout> | null = null;

  const publicar = (p: Partial<EstadoStoreMemoria>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const usavel = (a: Api | undefined): a is Api => a !== undefined && typeof a.listar === "function";
  const falhaCanal = (e: unknown, prefixo: string): string | null => {
    if (ehCanalAusente(e)) { publicar({ disponivel: false }); return null; }
    return `${prefixo}: ${msg(e)}`;
  };

  const pedidoDeListagem = (depois: string | null, limite: number) => {
    const f = estado.filtros;
    return {
      workspace_id: estado.workspaceId as string,
      escopo: escopoDaAba(f.aba) as EscopoMemoria,
      mission_id: f.missionId,
      pane_id: f.paneId,
      tipos: f.tipos.length === 0 ? null : [...f.tipos],
      busca: f.busca.trim() === "" ? null : f.busca.trim(),
      depois,
      limite,
    };
  };

  async function carregarEstado(): Promise<void> {
    const api = obterApi();
    if (!usavel(api) || estado.workspaceId === null) return;
    const g = geracao;
    try {
      const e = await api.estado(estado.workspaceId);
      if (g === geracao) publicar({ estado: e, erroEstado: null });
    } catch (e) {
      if (g === geracao) publicar({ erroEstado: falhaCanal(e, "Não foi possível ler o estado da memória") });
    }
  }

  async function recarregar(): Promise<void> {
    const api = obterApi();
    if (!usavel(api)) { publicar({ disponivel: false, carregando: false }); return; }
    if (estado.workspaceId === null || !abaListaEntradas(estado.filtros.aba)) { publicar({ itens: [], proximo: null, carregando: false, erro: null, novas: 0 }); return; }
    const g = ++geracao;
    listaPronta = true;
    publicar({ carregando: true, erro: null, novas: 0 });
    try {
      const p = await api.listar(pedidoDeListagem(null, PAGINA));
      if (g === geracao) publicar({ itens: p.itens, proximo: p.proximo, carregando: false });
    } catch (e) {
      if (g === geracao) publicar({ carregando: false, erro: falhaCanal(e, "Não foi possível ler as entradas") });
    }
  }

  async function carregarMais(): Promise<void> {
    const api = obterApi();
    if (!usavel(api) || estado.proximo === null || estado.carregandoMais || estado.carregando || estado.workspaceId === null) return;
    const g = geracao;
    publicar({ carregandoMais: true });
    try {
      const p = await api.listar(pedidoDeListagem(estado.proximo, PAGINA));
      if (g !== geracao) return;
      const ja = new Set(estado.itens.map((e) => e.id));
      publicar({ itens: [...estado.itens, ...p.itens.filter((e) => !ja.has(e.id))], proximo: p.proximo, carregandoMais: false });
    } catch (e) {
      if (g === geracao) publicar({ carregandoMais: false, erro: falhaCanal(e, "Não foi possível ler mais entradas") });
    }
  }

  /** Um lote de `entrada_criada`: busca só o topo e mescla; com busca/tipo/origem ativos só conta (sem recarregar nada). */
  async function aplicarLote(n: number): Promise<void> {
    const api = obterApi();
    if (!usavel(api) || estado.workspaceId === null) return;
    void carregarEstado(); // contagens e tamanho (uma leitura por lote, coalescida)
    const f = estado.filtros;
    if (!abaListaEntradas(f.aba) || estado.carregando) return;
    if (f.busca.trim() !== "" || f.tipos.length > 0 || f.origem !== null) { publicar({ novas: estado.novas + n }); return; }
    const g = geracao;
    try {
      const topo = await api.listar(pedidoDeListagem(null, Math.min(50, n + 5)));
      if (g === geracao) publicar({ itens: mesclarNovas(estado.itens, topo.itens) });
    } catch { /* o próximo evento ou o recarregar manual resolve */ }
  }

  function aoEvento(e: EventoMemoria): void {
    if (e.canal !== "memoria:entrada_criada") return;
    pendentes++;
    if (quadroAgendado) return;
    quadroAgendado = true;
    quadro(() => { quadroAgendado = false; const n = pendentes; pendentes = 0; void aplicarLote(n); });
  }

  const guardar = async <T>(fn: (api: Api) => Promise<T>, prefixo: string, tom: TomAviso = "erro"): Promise<T | null> => {
    const api = obterApi();
    if (!usavel(api)) return null;
    try { return await fn(api); } catch (e) { avisar(`${prefixo}: ${msg(e)}`, tom); return null; }
  };

  const api = {
    obter: (): EstadoStoreMemoria => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },

    /** Uma assinatura do main (idempotente). Sem canal = indisponível, nunca erro. */
    iniciar(): void {
      if (iniciado) return;
      iniciado = true;
      const a = obterApi();
      if (!usavel(a)) { publicar({ disponivel: false }); return; }
      if (typeof a.assinar === "function") a.assinar(aoEvento);
    },

    /** Volta ao estado inicial (troca de sessão, teste): descarta respostas em voo e a lista carregada. A assinatura de eventos continua. */
    reiniciar(): void {
      geracao++;
      listaPronta = false;
      pendentes = 0;
      if (buscaTimer !== null) { clearTimeout(buscaTimer); buscaTimer = null; }
      publicar({ disponivel: true, workspaceId: null, estado: null, erroEstado: null, filtros: FILTROS_INICIAIS, itens: [], proximo: null, carregando: false, carregandoMais: false, erro: null, novas: 0, preferencias: [], prefCarregado: false, prefErro: null, previas: {} });
    },

    async definirWorkspace(id: string | null): Promise<void> {
      if (id === estado.workspaceId) return;
      geracao++;
      listaPronta = false;
      publicar({ workspaceId: id, estado: null, erroEstado: null, itens: [], proximo: null, erro: null, novas: 0, filtros: { ...estado.filtros, missionId: null, paneId: null } });
      if (id === null) return;
      await carregarEstado();
    },

    /** A tela Memória pede a lista só quando abre (as Configurações só precisam do estado). Idempotente por workspace. */
    async garantirLista(): Promise<void> {
      if (!listaPronta) await recarregar();
    },

    carregarEstado,
    recarregar,
    carregarMais,

    /** Troca filtros; a busca por texto espera 250 ms (digitação), o resto recarrega na hora. */
    definirFiltros(patch: Partial<FiltrosMemoria>): void {
      const antes = estado.filtros;
      const f: FiltrosMemoria = { ...antes, ...patch };
      if (patch.missionId !== undefined && patch.missionId !== antes.missionId && patch.paneId === undefined) f.paneId = null;
      publicar({ filtros: f });
      if (buscaTimer !== null) { clearTimeout(buscaTimer); buscaTimer = null; }
      const soOrigem = Object.keys(patch).every((k) => k === "origem");
      if (soOrigem) return; // filtro de origem é do lado do cliente
      if (f.aba === "preferencias") { void api.carregarPreferencias(); return; }
      if (f.aba === "saude") { void carregarEstado(); return; }
      if (patch.busca !== undefined && Object.keys(patch).length === 1) buscaTimer = setTimeout(() => { buscaTimer = null; void recarregar(); }, 250);
      else void recarregar();
    },

    async esquecer(entradaId: string): Promise<boolean> {
      const r = await guardar((a) => a.esquecer(entradaId), "Não foi possível esquecer a entrada");
      if (r?.ok !== true) return false;
      publicar({ itens: estado.itens.filter((e) => e.id !== entradaId) }); // sem recarregar a lista inteira
      void carregarEstado();
      return true;
    },

    async esquecerPane(paneId: string): Promise<number | null> {
      const r = await guardar((a) => a.esquecerPane(paneId), "Não foi possível esquecer o Pane");
      if (r === null) return null;
      publicar({ itens: estado.itens.filter((e) => e.pane_id !== paneId) });
      void carregarEstado();
      return r.removidas;
    },

    /** Editar texto e/ou fixar (importância 5). A entrada devolvida substitui a da lista no lugar. */
    async atualizar(entradaId: string, mudanca: { conteudo?: string; importancia?: 1 | 2 | 3 | 4 | 5 }): Promise<EntradaMemoria | null> {
      const nova = await guardar((a) => a.atualizar({ entrada_id: entradaId, ...mudanca }), "Não foi possível atualizar a entrada");
      if (nova === null) return null;
      publicar({ itens: estado.itens.map((e) => (e.id === entradaId ? { ...e, ...nova, display_id: nova.display_id ?? e.display_id } : e)) });
      return nova;
    },

    async gravarConfig(patch: Omit<PedidoConfigMemoria, "workspace_id">): Promise<ConfigMemoria | null> {
      if (estado.workspaceId === null) return null;
      const c = await guardar((a) => a.gravarConfig({ workspace_id: estado.workspaceId as string, ...patch }), "Não foi possível gravar a configuração");
      if (c === null) return null;
      publicar({ estado: estado.estado === null ? estado.estado : { ...estado.estado, config: c } });
      void carregarEstado();
      return c;
    },

    async definirMissao(missionId: string, ativa: boolean | null): Promise<boolean> {
      const r = await guardar((a) => a.definirMissao(missionId, ativa), "Não foi possível gravar a chave da Missão");
      if (r === null) return false;
      if (estado.estado !== null) {
        const missoes = { ...(estado.estado.missoes ?? {}) };
        if (r.ativa === null) delete missoes[missionId]; else missoes[missionId] = r.ativa;
        publicar({ estado: { ...estado.estado, missoes } });
      }
      return true;
    },

    async purgar(escopo: EscopoMemoria | "tudo", confirmacao: string): Promise<number | null> {
      if (estado.workspaceId === null) return null;
      const r = await guardar((a) => a.purgar({ workspace_id: estado.workspaceId as string, escopo, confirmacao }), "Não foi possível apagar a memória");
      if (r === null) return null;
      await Promise.all([carregarEstado(), recarregar()]);
      return r.removidas;
    },

    /** O main abre o diálogo de salvar; `null` = cancelou (ou falhou, com aviso). */
    async exportar(escopo: EscopoMemoria | "tudo"): Promise<string | null> {
      if (estado.workspaceId === null) return null;
      const r = await guardar((a) => a.exportar(estado.workspaceId as string, escopo), "Não foi possível exportar");
      if (r?.caminho_salvo != null) avisar("Memória exportada.", "sucesso");
      return r?.caminho_salvo ?? null;
    },

    async carregarPreferencias(): Promise<void> {
      const a = obterApi();
      if (!usavel(a) || typeof a.preferenciasListar !== "function") { publicar({ disponivel: false, prefCarregado: true }); return; }
      try { publicar({ preferencias: await a.preferenciasListar(), prefCarregado: true, prefErro: null }); }
      catch (e) { publicar({ prefCarregado: true, prefErro: falhaCanal(e, "Não foi possível ler as preferências") }); }
    },
    async gravarPreferencia(id: string | null, conteudo: string, importancia: 1 | 2 | 3 | 4 | 5 = 3): Promise<EntradaMemoria | null> {
      const e = await guardar((a) => a.preferenciasGravar({ id, conteudo, importancia }), "Não foi possível gravar a preferência");
      if (e === null) return null;
      publicar({ preferencias: id === null && !estado.preferencias.some((p) => p.id === e.id) ? [e, ...estado.preferencias] : estado.preferencias.map((p) => (p.id === e.id ? e : p)) });
      return e;
    },
    async removerPreferencia(id: string): Promise<boolean> {
      const r = await guardar((a) => a.preferenciasRemover(id), "Não foi possível remover a preferência");
      if (r?.ok !== true) return false;
      publicar({ preferencias: estado.preferencias.filter((p) => p.id !== id) });
      return true;
    },

    /** Prévia do brief (somente leitura), com cache por Pane até o próximo `brief_montado`. */
    async previa(paneId: string, forcar = false): Promise<PreviaBrief | null> {
      const cache = estado.previas[paneId];
      if (cache !== undefined && !forcar) return cache;
      const p = await guardar((a) => a.briefPrevia(paneId), "Não foi possível montar a prévia do brief");
      if (p !== null) publicar({ previas: { ...estado.previas, [paneId]: p } });
      return p;
    },
    esquecerPrevia(paneId: string): void {
      if (estado.previas[paneId] === undefined) return;
      const { [paneId]: _x, ...resto } = estado.previas;
      void _x;
      publicar({ previas: resto });
    },

    async restaurar(paneId: string, modo: "auto" | "retomar" | "brief"): Promise<ResultadoRestaurar | null> {
      return guardar((a) => a.restaurar(paneId, modo), "Não foi possível restaurar o painel");
    },
  };
  return api;
}

export type StoreMemoria = ReturnType<typeof criarStoreMemoria>;
export const storeMemoria: StoreMemoria = criarStoreMemoria();
export function useMemoria(store: StoreMemoria = storeMemoria): EstadoStoreMemoria {
  return useSyncExternalStore(store.assinar, store.obter);
}
