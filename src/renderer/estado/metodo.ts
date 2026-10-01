import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { IndiceProjeto } from "../../nucleo/metodo/tipos";
import { ade } from "../ade";

export interface EstadoMetodo {
  workspaceId: string | null;
  indice: IndiceProjeto | null;
  /** false até a primeira resposta do main (a tela abre antes; nada bloqueia). */
  carregado: boolean;
  erro: string | null;
}

interface Deps {
  api: () => ApiAde | undefined;
  /** janela de coalescência entre o primeiro evento e a releitura. */
  atrasoMs?: number;
}

/** Store mínimo do Método: UMA assinatura de `metodo:mudou`; eventos coalescidos em uma releitura. */
export function criarStoreMetodo({ api, atrasoMs = 120 }: Deps) {
  let estado: EstadoMetodo = { workspaceId: null, indice: null, carregado: false, erro: null };
  const ouvintes = new Set<() => void>();
  let ativos = 0;
  let cancelarMetodo: (() => void) | null = null;
  let cancelarWorkspaces: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let geracao = 0;

  const definir = (parcial: Partial<EstadoMetodo>) => {
    estado = { ...estado, ...parcial };
    ouvintes.forEach((o) => o());
  };

  const ler = () => {
    const a = api();
    const id = estado.workspaceId;
    if (!a || !id) return;
    const minha = ++geracao;
    a.metodo.estado(id).then(
      (indice) => {
        if (minha === geracao && estado.workspaceId === id) definir({ indice, carregado: true, erro: null });
      },
      (e: unknown) => {
        if (minha === geracao && estado.workspaceId === id) definir({ carregado: true, erro: e instanceof Error ? e.message : "Falha ao ler o método." });
      },
    );
  };

  const agendar = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      ler();
    }, atrasoMs);
  };

  const definirWorkspace = (id: string | null) => {
    if (id === estado.workspaceId && estado.carregado) return;
    if (id === estado.workspaceId) return;
    geracao++;
    definir({ workspaceId: id, indice: null, carregado: id === null, erro: null });
    if (id) ler();
  };

  return {
    obter: () => estado,
    assinar(o: () => void) {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    definirWorkspace,
    recarregar: ler,
    /** liga as assinaturas (uma só, mesmo com vários chamadores) e devolve o desligar. */
    iniciar(): () => void {
      const a = api();
      ativos++;
      if (ativos === 1) {
        if (!a) {
          definir({ carregado: true });
        } else {
          cancelarMetodo = a.metodo.assinar((e) => {
            if (e.workspace_id === estado.workspaceId) agendar();
          });
          cancelarWorkspaces = a.workspaces.assinar((e) => definirWorkspace(e.atual?.id ?? null));
          a.workspaces.estado().then(
            (e) => definirWorkspace(e.atual?.id ?? null),
            () => definir({ carregado: true }),
          );
        }
      }
      let ligado = true;
      return () => {
        if (!ligado) return;
        ligado = false;
        ativos--;
        if (ativos === 0) {
          cancelarMetodo?.();
          cancelarWorkspaces?.();
          cancelarMetodo = cancelarWorkspaces = null;
          if (timer) clearTimeout(timer);
          timer = null;
        }
      };
    },
  };
}

export type StoreMetodo = ReturnType<typeof criarStoreMetodo>;

export const storeMetodo: StoreMetodo = criarStoreMetodo({ api: ade });

export function useMetodo(store: StoreMetodo = storeMetodo): EstadoMetodo {
  return useSyncExternalStore(store.assinar, store.obter, store.obter);
}
