// Store do painel de workspaces (D-450…): preferências persistidas (fixado, largura, ordem, favoritos, recolhidos, modo) e o resumo
// agregado do main. NADA acontece até o painel montar (`ativar`): só então assina o evento coalescido e pede o primeiro resumo;
// ao desmontar (`desativar`) solta tudo e avisa o main, que para de acompanhar sessões. Sem polling.
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { ResultadoEncerrarAgente, ResumoWorkspaces } from "../../compartilhado/workspaces-resumo";
import { ade } from "../ade";
import {
  alternarEm, criarCoalescedor, gravarPrefsPainel, lerPrefsPainel, limitarLargura, PREFS_PADRAO_PAINEL,
  type ArmazemLike, type ModoPainel, type PrefsPainelWorkspaces,
} from "./painel-workspaces-logica";

type Api = ApiAde["workspaces"];

export const COALESCER_RESUMO_MS = 250;

export interface EstadoPainelWorkspaces {
  prefs: PrefsPainelWorkspaces;
  resumo: ResumoWorkspaces | null;
  /** o painel está montado e acompanhando o main. */
  ativo: boolean;
  carregando: boolean;
  erro: string | null;
  disponivel: boolean;
}

interface Deps {
  api: () => Api | undefined;
  armazem?: ArmazemLike | null;
  /** só testes: gancho do coalescedor */
  coalescer?: typeof criarCoalescedor;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function criarStorePainelWorkspaces({ api: obter, armazem, coalescer = criarCoalescedor }: Deps) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoPainelWorkspaces = { prefs: armazem === undefined ? lerPrefsPainel() : lerPrefsPainel(armazem), resumo: null, ativo: false, carregando: false, erro: null, disponivel: true };
  let cancelarAssinatura: (() => void) | null = null;
  let geracao = 0;
  const coalescido = coalescer<ResumoWorkspaces>((r) => publicar({ resumo: r, erro: null, carregando: false }), COALESCER_RESUMO_MS);

  function publicar(p: Partial<EstadoPainelWorkspaces>): void {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  }
  function prefs(mudanca: Partial<PrefsPainelWorkspaces>): void {
    const novo = { ...estado.prefs, ...mudanca };
    gravarPrefsPainel(novo, armazem);
    publicar({ prefs: novo });
  }

  return {
    obter: (): EstadoPainelWorkspaces => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },

    // ---- preferências
    definirFixado(fixado: boolean): void { if (fixado !== estado.prefs.fixado) prefs({ fixado }); },
    alternarFixado(): void { prefs({ fixado: !estado.prefs.fixado }); },
    definirLargura(l: number): void { const largura = limitarLargura(l); if (largura !== estado.prefs.largura) prefs({ largura }); },
    alternarFavorito(id: string): void { prefs({ favoritos: alternarEm(estado.prefs.favoritos, id) }); },
    definirOrdem(ordem: readonly string[]): void { prefs({ ordem: [...ordem] }); },
    alternarRecolhido(id: string): void { prefs({ recolhidos: alternarEm(estado.prefs.recolhidos, id) }); },
    expandirTodos(): void { prefs({ recolhidos: [] }); },
    recolherTodos(ids: readonly string[]): void { prefs({ recolhidos: [...ids] }); },
    definirModo(modo: ModoPainel): void { if (modo !== estado.prefs.modo) prefs({ modo }); },

    // ---- ao vivo (só com o painel montado)
    async ativar(): Promise<void> {
      if (estado.ativo) return;
      const a = obter();
      if (a === undefined || typeof a.resumo !== "function") { publicar({ disponivel: false, carregando: false }); return; }
      const minha = ++geracao;
      publicar({ ativo: true, carregando: estado.resumo === null, disponivel: true });
      cancelarAssinatura = a.assinarResumo((r) => coalescido.agendar(r));
      try {
        await a.ativarResumo(true);
        const r = await a.resumo();
        if (geracao === minha && estado.ativo) publicar({ resumo: r, carregando: false, erro: null });
      } catch (e) {
        if (geracao === minha) publicar({ carregando: false, erro: `Não foi possível ler os workspaces: ${msg(e)}` });
      }
    },
    desativar(): void {
      if (!estado.ativo) return;
      geracao += 1;
      coalescido.cancelar();
      cancelarAssinatura?.();
      cancelarAssinatura = null;
      publicar({ ativo: false });
      void obter()?.ativarResumo(false).catch(() => undefined);
    },
    /** Pede um resumo novo agora (depois de uma ação do dono). */
    async atualizar(): Promise<void> {
      const a = obter();
      if (a === undefined || !estado.ativo) return;
      try { publicar({ resumo: await a.resumo(), erro: null }); } catch (e) { publicar({ erro: `Não foi possível atualizar: ${msg(e)}` }); }
    },

    // ---- ações
    async encerrarAgente(workspaceId: string, sessaoId: string): Promise<ResultadoEncerrarAgente> {
      const a = obter();
      if (a === undefined) return { ok: false, motivo: "falhou" };
      try {
        const r = await a.encerrarAgente(workspaceId, sessaoId);
        void this.atualizar();
        return r;
      } catch (e) {
        publicar({ erro: `Não foi possível terminar o agente: ${msg(e)}` });
        return { ok: false, motivo: "falhou" };
      }
    },
    async copiarCaminho(workspaceId: string): Promise<boolean> {
      try { return (await obter()?.copiarCaminho(workspaceId)) ?? false; } catch { return false; }
    },
    async revelar(workspaceId: string): Promise<boolean> {
      try { return (await obter()?.revelar(workspaceId)) ?? false; } catch { return false; }
    },
    limparErro(): void { if (estado.erro !== null) publicar({ erro: null }); },
  };
}

export type StorePainelWorkspaces = ReturnType<typeof criarStorePainelWorkspaces>;
export const storePainelWorkspaces: StorePainelWorkspaces = criarStorePainelWorkspaces({ api: () => ade()?.workspaces });

export function usePainelWorkspaces(store: StorePainelWorkspaces = storePainelWorkspaces): EstadoPainelWorkspaces {
  return useSyncExternalStore(store.assinar, store.obter);
}
/** Primitivo: só re-renderiza quem usa quando o booleano muda (a casca lê isto, nunca o resumo). */
export function usePainelFixado(store: StorePainelWorkspaces = storePainelWorkspaces): boolean {
  return useSyncExternalStore(store.assinar, () => store.obter().prefs.fixado);
}
export function usePainelLargura(store: StorePainelWorkspaces = storePainelWorkspaces): number {
  return useSyncExternalStore(store.assinar, () => store.obter().prefs.largura);
}

export { PREFS_PADRAO_PAINEL };
