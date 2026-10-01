import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { Conta, ProvedorInfo } from "../../compartilhado/dominio";
import { ade } from "../ade";

type Api = ApiAde["provedores"];

export interface EstadoProv {
  /** null = ainda não carregou. */
  lista: readonly ProvedorInfo[] | null;
  carregando: boolean;
  erro: string | null;
  disponivel: boolean;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function criarStoreProvedores({ api: obter }: { api: () => Api | undefined }) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoProv = { lista: null, carregando: false, erro: null, disponivel: true };
  let emCurso: Promise<void> | null = null;
  const publicar = (p: Partial<EstadoProv>): void => {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  };
  const trocarConta = (conta: Conta): void => {
    if (estado.lista === null) return;
    publicar({ lista: estado.lista.map((p) => (p.ferramenta.id === conta.provedor ? { ...p, contas: p.contas.some((c) => c.id === conta.id) ? p.contas.map((c) => (c.id === conta.id ? conta : c)) : [...p.contas, conta] } : p)) });
  };

  return {
    obter: (): EstadoProv => estado,
    assinar(o: () => void): () => void {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    /** Carrega uma vez (cache do main); `forcar` refaz a detecção. Chamadas simultâneas se juntam. */
    carregar(forcar = false): Promise<void> {
      if (emCurso !== null) return emCurso;
      const api = obter();
      if (api === undefined) { publicar({ lista: [], disponivel: false }); return Promise.resolve(); }
      publicar({ carregando: true, erro: null });
      emCurso = api.listar(forcar)
        .then((lista) => publicar({ lista, carregando: false }))
        .catch((e) => publicar({ lista: estado.lista ?? [], carregando: false, erro: `Não foi possível detectar as CLIs: ${msg(e)}` }))
        .finally(() => { emCurso = null; });
      return emCurso;
    },
    async criarConta(provedor: string, rotulo: string): Promise<boolean> {
      try { trocarConta(await obter()!.criarConta(provedor, rotulo)); publicar({ erro: null }); return true; }
      catch (e) { publicar({ erro: `Não foi possível criar a conta: ${msg(e)}` }); return false; }
    },
    async habilitarConta(id: string, habilitada: boolean): Promise<void> {
      try { const c = await obter()!.habilitarConta(id, habilitada); if (c !== null) trocarConta(c); }
      catch (e) { publicar({ erro: `Não foi possível alterar a conta: ${msg(e)}` }); }
    },
    async diagnostico(): Promise<string> {
      try { return (await obter()!.diagnostico()).texto; } catch (e) { return `Falha ao gerar o diagnóstico: ${msg(e)}`; }
    },
  };
}

export type StoreProvedores = ReturnType<typeof criarStoreProvedores>;
export const storeProvedores: StoreProvedores = criarStoreProvedores({ api: () => ade()?.provedores });

export function useProvedores(store: StoreProvedores = storeProvedores): EstadoProv {
  return useSyncExternalStore(store.assinar, store.obter);
}
