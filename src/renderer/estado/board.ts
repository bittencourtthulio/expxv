// Store do Board (T-10.14): `useSyncExternalStore`; ao `board:evento` busca o snapshot e aplica COMPARTILHAMENTO ESTRUTURAL por `chave` de card
// (mesma referência para o card que não mudou ⇒ só o card alterado re-renderiza). Uma busca em voo por vez (a rajada vira 1 releitura).
// Trocar de workspace descarta o estado anterior. O renderer nunca envia caminho absoluto.
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import { COLUNAS_BOARD, type BoardModelo, type CardBoard, type ColunaBoard } from "../../compartilhado/custo";
import { ade } from "../ade";
import { FILTROS_VAZIOS, gravarFiltros, lerFiltros, type FiltrosUi } from "./board-filtros";

type ApiBoard = ApiAde["board"];
export interface EstadoBoard {
  workspaceId: string | null;
  filtros: FiltrosUi;
  modelo: BoardModelo | null;
  carregando: boolean;
  erro: string | null;
  disponivel: boolean;
  /** aumenta a cada snapshot aplicado; só para testes/aria-live. */
  revisao: number;
}

const igualLista = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
/** Igualdade campo a campo do card (barata; sem JSON.stringify). */
export function igualCard(a: CardBoard, b: CardBoard): boolean {
  return a.chave === b.chave && a.titulo === b.titulo && a.coluna === b.coluna && a.task_id === b.task_id && a.fase === b.fase && a.suite === b.suite && a.mission_id === b.mission_id &&
    a.handoff_status === b.handoff_status && a.duracao_observada_ms === b.duracao_observada_ms && a.trabalho_titulo === b.trabalho_titulo &&
    igualLista(a.selos, b.selos) && igualLista(a.depende_de, b.depende_de) &&
    a.custo.usd === b.custo.usd && a.custo.incompleto === b.custo.incompleto && a.custo.aproximado === b.custo.aproximado &&
    (a.executor === null ? b.executor === null : b.executor !== null && a.executor.pane_id === b.executor.pane_id && a.executor.cli === b.executor.cli && a.executor.modelo === b.executor.modelo && a.executor.conta_rotulo === b.executor.conta_rotulo);
}
function compartilharLista(antes: readonly CardBoard[] | undefined, depois: readonly CardBoard[]): CardBoard[] {
  if (antes === undefined || antes.length === 0) return depois as CardBoard[];
  const porChave = new Map<string, CardBoard>();
  for (const c of antes) porChave.set(c.chave, c);
  let tudoIgual = antes.length === depois.length;
  const saida = depois.map((c, i) => {
    const velho = porChave.get(c.chave);
    const ref = velho !== undefined && igualCard(velho, c) ? velho : c;
    if (tudoIgual && antes[i] !== ref) tudoIgual = false;
    return ref;
  });
  return tudoIgual ? (antes as CardBoard[]) : saida;
}
/** Compartilhamento estrutural do snapshot novo sobre o anterior (cards e colunas inalterados mantêm a referência). */
export function compartilharEstrutura(antes: BoardModelo | null, depois: BoardModelo): BoardModelo {
  if (antes === null) return depois;
  const colunas = {} as Record<ColunaBoard, CardBoard[]>;
  for (const c of COLUNAS_BOARD) colunas[c] = compartilharLista(antes.colunas[c], depois.colunas[c] ?? []);
  return { ...depois, colunas, descartados: compartilharLista(antes.descartados, depois.descartados ?? []) };
}

export interface DepsStoreBoard {
  api: () => ApiBoard | undefined;
  /** armazém de filtros (padrão localStorage). */
  armazem?: Parameters<typeof lerFiltros>[1];
}
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function criarStoreBoard({ api: obter, armazem }: DepsStoreBoard) {
  const ouvintes = new Set<() => void>();
  let cancelar: (() => void) | null = null;
  let geracao = 0;
  let emVoo = false;
  let refazer = false;
  let estado: EstadoBoard = { workspaceId: null, filtros: { ...FILTROS_VAZIOS }, modelo: null, carregando: false, erro: null, disponivel: true, revisao: 0 };
  const publicar = (p: Partial<EstadoBoard>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };

  async function recarregar(): Promise<void> {
    const api = obter();
    const ws = estado.workspaceId;
    if (api === undefined) { publicar({ disponivel: false, carregando: false }); return; }
    if (ws === null) return;
    if (emVoo) { refazer = true; return; }
    emVoo = true;
    const g = geracao;
    if (estado.modelo === null) publicar({ carregando: true, erro: null });
    try {
      const novo = await api.snapshot({ ...estado.filtros, workspace_id: ws });
      if (g === geracao) {
        // o filtro pode ter mudado durante o voo: o próprio ciclo seguinte (refazer) corrige
        publicar({ modelo: compartilharEstrutura(estado.modelo, novo), carregando: false, erro: null, revisao: estado.revisao + 1 });
      }
    } catch (e) {
      if (g === geracao) publicar({ carregando: false, erro: `Não foi possível montar o board: ${msg(e)}` });
    } finally {
      emVoo = false;
      if (refazer) { refazer = false; void recarregar(); }
    }
  }
  function ligar(): void {
    if (cancelar !== null) return;
    const api = obter();
    if (api === undefined) return;
    const a = api.assinar(() => void recarregar());
    // custo novo muda o custo leve dos cards: o snapshot é a fonte (o main só emite `board.changed` em `cost.updated`, mas garantimos)
    const c = ade()?.custo?.assinar((e) => { if (e.tipo === "atualizado") void recarregar(); });
    cancelar = () => { a(); c?.(); };
  }

  return {
    obter: (): EstadoBoard => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    iniciar(): void { ligar(); },
    encerrar(): void { cancelar?.(); cancelar = null; },
    /** descarta o estado do workspace anterior e carrega os filtros salvos do novo. */
    async definirWorkspace(id: string | null): Promise<void> {
      if (id === estado.workspaceId) return;
      geracao++;
      emVoo = false;
      refazer = false;
      publicar({ workspaceId: id, modelo: null, erro: null, carregando: false, filtros: id === null ? { ...FILTROS_VAZIOS } : lerFiltros(id, armazem), revisao: 0 });
      if (id !== null) await recarregar();
    },
    async definirFiltros(f: FiltrosUi): Promise<void> {
      if (estado.workspaceId !== null) gravarFiltros(estado.workspaceId, f, armazem);
      publicar({ filtros: f });
      await recarregar();
    },
    recarregar,
  };
}
export type StoreBoard = ReturnType<typeof criarStoreBoard>;
export const storeBoard: StoreBoard = criarStoreBoard({ api: () => ade()?.board });
export function useBoard(store: StoreBoard = storeBoard): EstadoBoard {
  return useSyncExternalStore(store.assinar, store.obter);
}
