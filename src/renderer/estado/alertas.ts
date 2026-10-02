// Estado leve dos alertas (Fase 20): contagem, últimos 50, indicadores de canal, pedido de pareamento e plano pendente no desktop.
// NADA no boot além de UMA leitura `contar()` e as assinaturas; a leitura dos canais (rodapé) é em ocioso. Eventos de uma mesma
// rajada viram UMA notificação de re-render (microtask). API ausente = "indisponível", nunca erro.
import { useSyncExternalStore } from "react";
import type { AlertaVisao, ApiAlertas, CanalVisao, EventoPareamentoTelegram, PlanoPendenteDesktop } from "../../compartilhado/alertas";
import { ade } from "../ade";

export const MAX_RECENTES = 50;

export interface EstadoAlertas {
  disponivel: boolean;
  contagem: { nao_lidos: number; criticos: number };
  recentes: readonly AlertaVisao[];
  canais: readonly CanalVisao[];
  pedidoPareamento: { pedido_id: string; nome: string; user_id: number } | null;
  planosPendentes: readonly PlanoPendenteDesktop[];
}

export interface DepsStoreAlertas {
  api: () => ApiAlertas | undefined;
  agora?: () => number;
  /** ocioso: padrão `requestIdleCallback`/`setTimeout`. */
  ocioso?: (fn: () => void) => void;
}

const usavel = (a: ApiAlertas | undefined): a is ApiAlertas => a !== undefined && typeof a.contar === "function" && typeof a.assinarNovo === "function";

export function criarStoreAlertas({ api: obter, agora = Date.now, ocioso }: DepsStoreAlertas) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoAlertas = { disponivel: true, contagem: { nao_lidos: 0, criticos: 0 }, recentes: [], canais: [], pedidoPareamento: null, planosPendentes: [] };
  let desligar: Array<() => void> = [];
  let ligado = false;
  let agendado = false;
  const publicar = (p: Partial<EstadoAlertas>): void => {
    estado = { ...estado, ...p };
    if (agendado) return;
    agendado = true;
    queueMicrotask(() => { agendado = false; ouvintes.forEach((o) => o()); });
  };
  const emOcioso = ocioso ?? ((fn: () => void): void => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 3000 });
    else setTimeout(fn, 1500);
  });

  const lerCanais = (api: ApiAlertas): void => {
    if (typeof api.canais?.listar !== "function") return;
    void Promise.resolve().then(() => api.canais.listar()).then((c) => publicar({ canais: c }), () => undefined);
  };

  function iniciar(): () => void {
    if (ligado) return parar;
    const api = obter();
    if (!usavel(api)) { publicar({ disponivel: false }); return parar; }
    ligado = true;
    void Promise.resolve().then(() => api.contar()).then((c) => publicar({ contagem: c }), () => publicar({ disponivel: false }));
    desligar = [
      api.assinarNovo((a) => publicar({ recentes: [a, ...estado.recentes.filter((r) => r.id !== a.id)].slice(0, MAX_RECENTES) })),
      api.assinarContagem((c) => publicar({ contagem: c })),
      api.assinarMudou(({ ids }) => {
        // alertas lidos fora desta janela: marca localmente e deixa a contagem vir pelo evento próprio
        const set = new Set(ids);
        const em = new Date(agora()).toISOString();
        publicar({ recentes: estado.recentes.map((r) => (set.has(r.id) && r.lido_em === null ? { ...r, lido_em: em } : r)) });
      }),
      api.assinarCanal((c) => publicar({ canais: [...estado.canais.filter((x) => x.id !== c.id), c] })),
      api.assinarPareamento((e: EventoPareamentoTelegram) => publicar({ pedidoPareamento: e.estado === "pedido" && e.pedido !== undefined ? e.pedido : null })),
      api.assinarPlanoPendente((p) => publicar({ planosPendentes: [...estado.planosPendentes.filter((x) => x.plano_id !== p.plano_id), p] })),
    ];
    emOcioso(() => { if (ligado) lerCanais(api); });
    return parar;
  }
  function parar(): void {
    desligar.forEach((d) => d());
    desligar = [];
    ligado = false;
  }

  return {
    obter: (): EstadoAlertas => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    iniciar,
    parar,
    /** o painel carrega os últimos itens ao abrir (o store só acumula o que chega por evento). */
    async carregarRecentes(limite = 8): Promise<void> {
      const api = obter();
      if (!usavel(api)) return;
      try {
        const p = await api.listar({ estado: "todos", depois_id: null, limite });
        const vistos = new Set<string>();
        const juntos = [...estado.recentes, ...p.itens].filter((a) => (vistos.has(a.id) ? false : (vistos.add(a.id), true)));
        juntos.sort((a, b) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0));
        publicar({ recentes: juntos.slice(0, MAX_RECENTES) });
      } catch { /* o painel mostra o que tem */ }
    },
    async marcarTodosLidos(): Promise<void> {
      const api = obter();
      if (!usavel(api)) return;
      try {
        await api.marcarTodosLidos();
        const em = new Date(agora()).toISOString();
        publicar({ recentes: estado.recentes.map((r) => (r.lido_em === null ? { ...r, lido_em: em } : r)), contagem: { nao_lidos: 0, criticos: 0 } });
      } catch { /* a contagem real vem por evento */ }
    },
    removerPlano(plano_id: string): void { publicar({ planosPendentes: estado.planosPendentes.filter((p) => p.plano_id !== plano_id) }); },
    limparPareamento(): void { publicar({ pedidoPareamento: null }); },
  };
}
export type StoreAlertas = ReturnType<typeof criarStoreAlertas>;
export const storeAlertas: StoreAlertas = criarStoreAlertas({ api: () => ade()?.alertas });

export function useAlertas(store: StoreAlertas = storeAlertas): EstadoAlertas {
  return useSyncExternalStore(store.assinar, store.obter, store.obter);
}
