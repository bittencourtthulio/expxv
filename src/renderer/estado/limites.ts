// Estado dos limites (Fase 9): snapshot por conta + cota geral. Uma assinatura de `limites:evento`; só os componentes que
// leem este store re-renderizam (P-103). API ausente/parcial (testes, navegador) = "indisponível", nunca erro.
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { AccountUsage, CotaGeral, EventoLimites, JanelaManual, RespostaLimites } from "../../compartilhado/limites";
import { ade } from "../ade";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";
import { formatarPct, rotulosCurtos } from "./limites-formato";

type Api = ApiAde["limites"];

export interface EstadoLimites {
  contas: readonly AccountUsage[];
  geral: CotaGeral | null;
  rotulos: Readonly<Record<string, string>>;
  /** false = canal ausente (fora do Electron ou main sem os canais). */
  disponivel: boolean;
  carregado: boolean;
  carregando: boolean;
  erro: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function criarStoreLimites({ api: obter, avisar = avisarPadrao }: { api: () => Api | undefined; avisar?: (t: string, tom?: TomAviso) => unknown }) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoLimites = { contas: [], geral: null, rotulos: {}, disponivel: true, carregado: false, carregando: false, erro: null };
  let iniciado: Promise<void> | null = null;
  let emCurso: Promise<void> | null = null;
  const publicar = (p: Partial<EstadoLimites>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };
  const aplicar = (r: RespostaLimites): void => publicar({ contas: r.contas, geral: r.geral, rotulos: rotulosCurtos(r.contas), carregado: true, carregando: false, erro: null });
  const usavel = (a: Api | undefined): a is Api => a !== undefined && typeof a.snapshot === "function";

  const ler = (forcar: boolean, contaId?: string): Promise<void> => {
    if (emCurso !== null && !forcar) return emCurso;
    const api = obter();
    if (!usavel(api)) { publicar({ disponivel: false, carregado: true, carregando: false }); return Promise.resolve(); }
    publicar({ carregando: true });
    const p = Promise.resolve().then(() => (forcar && typeof api.atualizar === "function" ? api.atualizar(contaId) : api.snapshot()))
      .then(aplicar)
      .catch((e) => publicar({ carregando: false, carregado: true, erro: `Não foi possível ler os limites: ${msg(e)}` }))
      .finally(() => { if (emCurso === p) emCurso = null; });
    emCurso = p;
    return p;
  };

  const aoEvento = (e: EventoLimites): void => {
    if (e.tipo === "atualizado") void ler(false);
    else if (e.tipo === "consumo_alto") {
      avisar(`Conta ${estado.rotulos[e.conta_id] ?? e.conta_id}: consumo em ${formatarPct(e.used_pct)}.`, "aviso");
      void ler(false);
    } else if (e.tipo === "limite_atingido") {
      avisar(`Conta ${estado.rotulos[e.conta_id] ?? e.conta_id} atingiu o limite.`, "erro");
      void ler(false);
    } else if (e.tipo === "provedor_indisponivel") avisar(`Limites de ${e.provider} indisponíveis: ${e.motivo}`, "aviso");
  };

  return {
    obter: (): EstadoLimites => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    /** Uma assinatura do main e a primeira leitura. Idempotente. */
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        const api = obter();
        if (!usavel(api)) { publicar({ disponivel: false, carregado: true }); return; }
        if (typeof api.assinar === "function") api.assinar(aoEvento);
        await ler(false);
      })();
      return iniciado;
    },
    /** "Atualizar": força a leitura na fonte (uma conta ou todas). */
    atualizar: (contaId?: string): Promise<void> => ler(true, contaId),
    async definirManual(contaId: string, janela: JanelaManual, usadoPct: number, reiniciaEm: string | null): Promise<boolean> {
      try { await obter()!.definirManual(contaId, janela, usadoPct, reiniciaEm); await ler(false); return true; }
      catch (e) { publicar({ erro: `Não foi possível gravar o valor manual: ${msg(e)}` }); return false; }
    },
    async limparManual(contaId: string, janela?: JanelaManual): Promise<void> {
      try { await obter()!.limparManual(contaId, janela); await ler(false); }
      catch (e) { publicar({ erro: `Não foi possível limpar o valor manual: ${msg(e)}` }); }
    },
  };
}

export type StoreLimites = ReturnType<typeof criarStoreLimites>;
export const storeLimites: StoreLimites = criarStoreLimites({ api: () => ade()?.limites });
export function useLimites(store: StoreLimites = storeLimites): EstadoLimites {
  return useSyncExternalStore(store.assinar, store.obter);
}
