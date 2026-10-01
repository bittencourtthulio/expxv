import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { DetalheMissao, EstadoMissao, EstadoPortoes, Mission, PedidoCriarMissao, PortaoMissao } from "../../compartilhado/dominio";
import { ade } from "../ade";

type Api = ApiAde["missoes"];

export const missaoTerminal = (e: EstadoMissao): boolean => e === "concluida" || e === "falhou" || e === "abortada";

export interface EstadoMis {
  workspaceId: string | null;
  itens: readonly Mission[];
  /** cursor da próxima página; null = acabou. */
  proximo: string | null;
  carregado: boolean;
  erro: string | null;
  /** missões não terminais (rodapé). */
  ativas: number;
  detalhes: Readonly<Record<string, DetalheMissao | null>>;
  /** portões de intake das missões observadas (`null` = a missão não existe) */
  portoes: Readonly<Record<string, EstadoPortoes | null>>;
}

interface Deps {
  api: () => Api | undefined;
  /** agenda a atualização coalescida; devolve o cancelamento. Padrão: 80 ms. */
  agendar?: (fn: () => void) => () => void;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const padraoAgendar = (fn: () => void): (() => void) => { const t = setTimeout(fn, 80); return () => clearTimeout(t); };

export function criarStoreMissoes({ api: obter, agendar = padraoAgendar }: Deps) {
  const ouvintes = new Set<() => void>();
  const observados = new Set<string>();
  let assinou = false;
  let pendente: (() => void) | null = null;
  let geracao = 0; // descarta respostas de um workspace que já não é o atual
  let estado: EstadoMis = { workspaceId: null, itens: [], proximo: null, carregado: false, erro: null, ativas: 0, detalhes: {}, portoes: {} };

  const publicar = (p: Partial<EstadoMis>): void => {
    estado = { ...estado, ...p };
    if (p.itens !== undefined) estado.ativas = p.itens.filter((m) => !missaoTerminal(m.estado)).length;
    ouvintes.forEach((o) => o());
  };

  /** Recarrega as páginas já carregadas (no mínimo a primeira). */
  async function recarregar(): Promise<void> {
    const api = obter();
    const ws = estado.workspaceId;
    if (api === undefined || ws === null) return;
    const g = geracao;
    const alvo = Math.max(estado.itens.length, 1);
    try {
      let itens: Mission[] = [];
      let proximo: string | null = null;
      do {
        const pag = await api.listar(ws, null, proximo);
        itens = itens.concat(pag.itens);
        proximo = pag.proximo;
      } while (proximo !== null && itens.length < alvo);
      if (g === geracao) publicar({ itens, proximo, carregado: true, erro: null });
    } catch (e) {
      if (g === geracao) publicar({ carregado: true, erro: `Não foi possível listar as missões: ${msg(e)}` });
    }
    await Promise.all([...observados].map((id) => carregarDetalhe(id)));
  }

  async function carregarDetalhe(id: string): Promise<void> {
    try {
      const api = obter();
      // portões: falha isolada (a tela segue sem o painel); detalhe e portões saem juntos, em paralelo
      const [d, p] = await Promise.all([api?.detalhe(id), api?.portoes?.(id)?.catch(() => undefined)]);
      publicar({ detalhes: { ...estado.detalhes, [id]: d ?? null }, ...(p === undefined ? {} : { portoes: { ...estado.portoes, [id]: p } }) });
    } catch (e) { publicar({ erro: `Não foi possível abrir a missão: ${msg(e)}` }); }
  }

  /** eventos em rajada viram uma única atualização. */
  const aoEvento = (e: { workspace_id: string }): void => {
    if (e.workspace_id !== estado.workspaceId || pendente !== null) return;
    const cancelar = agendar(() => { pendente = null; void recarregar(); });
    pendente = cancelar;
  };

  return {
    obter: (): EstadoMis => estado,
    assinar(o: () => void): () => void {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    /** UMA assinatura de eventos; troca de workspace só recarrega a lista. Idempotente por workspace. */
    definirWorkspace(id: string | null): Promise<void> {
      const api = obter();
      if (api !== undefined && !assinou) { assinou = true; api.assinar(aoEvento); }
      if (id === estado.workspaceId) return Promise.resolve();
      geracao++;
      observados.clear();
      publicar({ workspaceId: id, itens: [], proximo: null, carregado: id === null, erro: null, detalhes: {}, portoes: {} });
      return recarregar();
    },
    async carregarMais(): Promise<void> {
      const api = obter();
      const ws = estado.workspaceId;
      if (api === undefined || ws === null || estado.proximo === null) return;
      const g = geracao;
      try {
        const pag = await api.listar(ws, null, estado.proximo);
        if (g === geracao) publicar({ itens: estado.itens.concat(pag.itens), proximo: pag.proximo });
      } catch (e) { publicar({ erro: `Não foi possível listar as missões: ${msg(e)}` }); }
    },
    async criar(pedido: PedidoCriarMissao): Promise<Mission> {
      const m = await obter()!.criar(pedido);
      if (!estado.itens.some((i) => i.id === m.id)) publicar({ itens: [m, ...estado.itens] });
      return m;
    },
    observarDetalhe(id: string): Promise<void> { observados.add(id); return carregarDetalhe(id); },
    pararDetalhe(id: string): void { observados.delete(id); },
    async encerrar(id: string): Promise<void> { await obter()!.encerrar(id); await recarregar(); },
    async abortar(id: string): Promise<void> { await obter()!.abortar(id); await recarregar(); },
    /** Libera um portão (decisão da pessoa) e publica o estado devolvido pelo main. */
    async liberarPortao(id: string, portao: PortaoMissao): Promise<void> {
      const p = await obter()!.liberarPortao(id, portao);
      publicar({ portoes: { ...estado.portoes, [id]: p } });
    },
    limparErro(): void { if (estado.erro !== null) publicar({ erro: null }); },
  };
}

export type StoreMissoes = ReturnType<typeof criarStoreMissoes>;
export const storeMissoes: StoreMissoes = criarStoreMissoes({ api: () => ade()?.missoes });

export function useMissoes(store: StoreMissoes = storeMissoes): EstadoMis {
  return useSyncExternalStore(store.assinar, store.obter);
}
export function useMissoesAtivas(store: StoreMissoes = storeMissoes): number {
  return useSyncExternalStore(store.assinar, () => store.obter().ativas);
}
