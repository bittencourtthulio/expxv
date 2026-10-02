// Estado do medidor de CPU e memória (D-530…): espelha o evento coalescido `sistema:amostra` (≤ 1 por 2 s). Sem polling aqui; o main só
// amostra enquanto este store está "ligado" (preferência `medidor_sistema_mostrar`, padrão LIGADO). API ausente = indisponível, nunca erro.
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import { CHAVE_MEDIDOR_MOSTRAR, PONTOS_HISTORICO, type AmostraSistema, type TomSistema } from "../../compartilhado/sistema";
import { ade } from "../ade";
import { anuncioDeTransicao, tomGeral } from "./sistema-formato";

export interface EstadoSistema {
  disponivel: boolean;
  /** preferência "mostrar o medidor" (padrão ligado). */
  mostrar: boolean;
  amostra: AmostraSistema | null;
  historicoCpu: readonly number[];
  historicoRam: readonly number[];
  /** texto para a região viva: só muda ao cruzar limiar. */
  anuncio: string;
  aberto: boolean;
}

interface Deps {
  api: () => ApiAde["sistema"] | undefined;
  config: () => ApiAde["config"] | undefined;
}

const VAZIO: EstadoSistema = { disponivel: true, mostrar: true, amostra: null, historicoCpu: [], historicoRam: [], anuncio: "", aberto: false };

export function criarStoreSistema({ api, config }: Deps) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoSistema = VAZIO;
  let iniciado: Promise<void> | null = null;
  let cancelar: (() => void) | null = null;
  let tom: TomSistema = "normal";
  const publicar = (p: Partial<EstadoSistema>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };

  const aoAmostra = (a: AmostraSistema): void => {
    if (!estado.mostrar) return;
    const novo = tomGeral(a);
    const anuncio = anuncioDeTransicao(tom, novo, a);
    tom = novo;
    const corta = (l: readonly number[], v: number): readonly number[] => (l.length >= PONTOS_HISTORICO ? [...l.slice(l.length - PONTOS_HISTORICO + 1), v] : [...l, v]);
    publicar({ amostra: a, historicoCpu: corta(estado.historicoCpu, a.cpu), historicoRam: corta(estado.historicoRam, a.ram), ...(anuncio === null ? {} : { anuncio }) });
  };

  const ligarMain = (): void => {
    const a = api();
    if (a === undefined || typeof a.assinar !== "function") { publicar({ disponivel: false }); return; }
    cancelar ??= typeof a.aoAmostra === "function" ? a.aoAmostra(aoAmostra) : null;
    void Promise.resolve(a.assinar(true)).catch(() => undefined);
  };
  const desligarMain = (): void => {
    cancelar?.(); cancelar = null;
    void Promise.resolve(api()?.assinar?.(false)).catch(() => undefined);
  };

  return {
    obter: (): EstadoSistema => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    /** lê a preferência e, ligado, assina o main. Idempotente. */
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        if (api() === undefined) { publicar({ disponivel: false }); return; }
        let mostrar = true;
        try { const v = await config()?.ler(CHAVE_MEDIDOR_MOSTRAR); if (typeof v === "boolean") mostrar = v; } catch { /* padrão */ }
        publicar({ mostrar });
        if (mostrar) ligarMain();
      })();
      return iniciado;
    },
    /** "Mostrar/ocultar medidor": persiste e liga/desliga a amostragem no main (oculto = zero timers). */
    async definirMostrar(mostrar: boolean): Promise<void> {
      await this.iniciar();
      if (estado.mostrar === mostrar) return;
      if (mostrar) publicar({ mostrar: true }); else { tom = "normal"; publicar({ mostrar: false, aberto: false, amostra: null, historicoCpu: [], historicoRam: [], anuncio: "" }); }
      void Promise.resolve(config()?.gravar(CHAVE_MEDIDOR_MOSTRAR, mostrar)).catch(() => undefined);
      if (mostrar) ligarMain(); else desligarMain();
    },
    alternarMostrar(): Promise<void> { return this.definirMostrar(!estado.mostrar); },
    abrir: (): void => { if (estado.mostrar && estado.disponivel) publicar({ aberto: true }); },
    fechar: (): void => { if (estado.aberto) publicar({ aberto: false }); },
    alternar(): void { if (estado.aberto) publicar({ aberto: false }); else if (estado.mostrar && estado.disponivel) publicar({ aberto: true }); },
  };
}

export type StoreSistema = ReturnType<typeof criarStoreSistema>;
export const storeSistema: StoreSistema = criarStoreSistema({ api: () => ade()?.sistema, config: () => ade()?.config });

export function useSistema<T>(seletor: (e: EstadoSistema) => T, store: StoreSistema = storeSistema): T {
  return useSyncExternalStore(store.assinar, () => seletor(store.obter()));
}
