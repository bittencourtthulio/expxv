import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { EstadoWorkspaces, Permissao, Workspace, WorktreeInfo } from "../../compartilhado/dominio";
import { ade } from "../ade";

/** O store só usa estas; o painel de workspaces tem a própria fatia (resumo/ativar/encerrar/revelar). */
type Api = Pick<ApiAde["workspaces"], "estado" | "abrir" | "definirAtual" | "remover" | "definirPermissao" | "worktrees" | "assinar">;

export interface EstadoWs {
  atual: Workspace | null;
  recentes: readonly Workspace[];
  /** o primeiro estado já chegou (evita piscar o estado vazio). */
  carregado: boolean;
  erro: string | null;
  disponivel: boolean;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function criarStoreWorkspaces({ api: obter }: { api: () => Api | undefined }) {
  const ouvintes = new Set<() => void>();
  let iniciado: Promise<void> | null = null;
  let estado: EstadoWs = { atual: null, recentes: [], carregado: false, erro: null, disponivel: true };

  const publicar = (p: Partial<EstadoWs>): void => {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  };
  const aplicar = (e: EstadoWorkspaces): void => publicar({ atual: e.atual, recentes: e.recentes, carregado: true });
  const falha = (prefixo: string, e: unknown): void => publicar({ erro: `${prefixo}: ${msg(e)}` });

  return {
    obter: (): EstadoWs => estado,
    assinar(o: () => void): () => void {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    /** UMA assinatura do main; o estado inicial chega junto. Idempotente. */
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        const api = obter();
        if (api === undefined) { publicar({ carregado: true, disponivel: false }); return; }
        api.assinar(aplicar);
        try { aplicar(await api.estado()); } catch (e) { publicar({ carregado: true }); falha("Não foi possível ler os workspaces", e); }
      })();
      return iniciado;
    },
    /** `caminho` null abre o diálogo nativo (só o main abre diálogos). */
    async abrir(caminho: string | null = null): Promise<Workspace | null> {
      try {
        publicar({ erro: null });
        return (await obter()?.abrir(caminho)) ?? null;
      } catch (e) { falha("Não foi possível abrir a pasta", e); return null; }
    },
    async definirAtual(id: string): Promise<void> {
      try { await obter()?.definirAtual(id); } catch (e) { falha("Não foi possível trocar de workspace", e); }
    },
    async remover(id: string): Promise<boolean> {
      try { return (await obter()?.remover(id)) ?? false; } catch (e) { falha("Não foi possível remover da lista", e); return false; }
    },
    async definirPermissao(id: string, permissao: Permissao): Promise<void> {
      try { await obter()?.definirPermissao(id, permissao); } catch (e) { falha("Não foi possível mudar a permissão", e); }
    },
    async worktrees(id: string): Promise<WorktreeInfo[]> {
      try { return (await obter()?.worktrees(id)) ?? []; } catch (e) { falha("Não foi possível listar os worktrees", e); return []; }
    },
    limparErro(): void { if (estado.erro !== null) publicar({ erro: null }); },
  };
}

export type StoreWorkspaces = ReturnType<typeof criarStoreWorkspaces>;
export const storeWorkspaces: StoreWorkspaces = criarStoreWorkspaces({ api: () => ade()?.workspaces });

export function useWorkspaces(store: StoreWorkspaces = storeWorkspaces): EstadoWs {
  return useSyncExternalStore(store.assinar, store.obter);
}
