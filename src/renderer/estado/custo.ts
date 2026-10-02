// Store mínimo do custo (T-10.14): `useSyncExternalStore`, uma entrada por (escopo, chave) VISÍVEL (com contagem de uso). O `custo:evento` coalescido
// do main só refaz as entradas que estão em uso; ao trocar de workspace tudo é descartado. Nada de conteúdo nem caminho absoluto passa por aqui.
import { useEffect, useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { CustoMissao, CustoResumo, EscopoCusto, EventoCusto } from "../../compartilhado/custo";
import { ade } from "../ade";

type ApiCusto = ApiAde["custo"];
export interface EntradaResumo {
  resumo: CustoResumo | CustoMissao | null;
  carregando: boolean;
  erro: string | null;
}
const VAZIA: EntradaResumo = { resumo: null, carregando: false, erro: null };
const chaveDe = (escopo: EscopoCusto, chave: string): string => `${escopo}|${chave}`;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface DepsStoreCusto {
  api: () => ApiCusto | undefined;
}

export function criarStoreCusto({ api: obter }: DepsStoreCusto) {
  const ouvintes = new Set<() => void>();
  const entradas = new Map<string, EntradaResumo>();
  const usos = new Map<string, number>();
  const alertas: EventoCusto[] = [];
  let cancelar: (() => void) | null = null;
  let geracao = 0;
  let agendado = false;
  const sujas = new Set<string>();
  const avisar = (): void => ouvintes.forEach((o) => o());
  const definir = (k: string, e: EntradaResumo): void => { entradas.set(k, e); avisar(); };

  async function buscar(escopo: EscopoCusto, chave: string): Promise<void> {
    const api = obter();
    const k = chaveDe(escopo, chave);
    if (api === undefined) return;
    const g = geracao;
    const antes = entradas.get(k) ?? VAZIA;
    if (!antes.carregando) definir(k, { ...antes, carregando: true });
    try {
      const resumo = await api.resumo({ escopo, chave });
      if (g === geracao && usos.has(k)) definir(k, { resumo, carregando: false, erro: null });
    } catch (e) {
      if (g === geracao && usos.has(k)) definir(k, { resumo: antes.resumo, carregando: false, erro: msg(e) });
    }
  }

  function aoEvento(e: EventoCusto): void {
    if (e.tipo === "atualizado") {
      for (const x of e.escopos ?? []) {
        const k = chaveDe(x.escopo, x.chave);
        if (usos.has(k)) sujas.add(k);
      }
      if (sujas.size > 0 && !agendado) {
        agendado = true;
        queueMicrotask(() => {
          agendado = false;
          const lote = [...sujas];
          sujas.clear();
          for (const k of lote) { const i = k.indexOf("|"); void buscar(k.slice(0, i) as EscopoCusto, k.slice(i + 1)); }
        });
      }
    } else {
      alertas.push(e);
      if (alertas.length > 20) alertas.shift();
      avisar();
    }
  }
  function ligar(): void {
    if (cancelar !== null) return;
    const api = obter();
    if (api === undefined) return;
    cancelar = api.assinar(aoEvento);
  }

  return {
    obter: (escopo: EscopoCusto, chave: string): EntradaResumo => entradas.get(chaveDe(escopo, chave)) ?? VAZIA,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    /** marca a entrada como em uso e a carrega; devolve a liberação (zero usos ⇒ a entrada sai da memória). */
    usar(escopo: EscopoCusto, chave: string): () => void {
      const k = chaveDe(escopo, chave);
      usos.set(k, (usos.get(k) ?? 0) + 1);
      ligar();
      if (!entradas.has(k)) void buscar(escopo, chave);
      return () => {
        const n = (usos.get(k) ?? 1) - 1;
        if (n > 0) { usos.set(k, n); return; }
        usos.delete(k);
        entradas.delete(k);
        if (usos.size === 0) { cancelar?.(); cancelar = null; }
      };
    },
    recarregar: (escopo: EscopoCusto, chave: string): Promise<void> => buscar(escopo, chave),
    /** trocar de workspace descarta tudo. */
    limpar(): void { geracao++; entradas.clear(); sujas.clear(); avisar(); },
    alertas: (): readonly EventoCusto[] => alertas,
    tamanho: (): number => entradas.size,
  };
}
export type StoreCusto = ReturnType<typeof criarStoreCusto>;
export const storeCusto: StoreCusto = criarStoreCusto({ api: () => ade()?.custo });

export function useResumoCusto(escopo: EscopoCusto, chave: string | null, store: StoreCusto = storeCusto): EntradaResumo {
  useEffect(() => (chave === null ? undefined : store.usar(escopo, chave)), [store, escopo, chave]);
  return useSyncExternalStore(store.assinar, () => (chave === null ? VAZIA : store.obter(escopo, chave)));
}
