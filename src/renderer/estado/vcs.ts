// Store do versionamento (T-06.33): resumo (branch, sujo, ahead/behind) por ÁRVORE, para rodapé, abas, seletor e cards da Missão.
// `vcs:observar` é contado por referência: o observador do main só roda enquanto alguém mostra a árvore. Sem polling: o resumo
// só muda por `vcs:mudou` (o main já coalesce o observador de arquivos).
import { useEffect, useSyncExternalStore } from "react";
import type { ApiVcs, AlvoVcs, EventoVcs, ResumoVcs } from "../../compartilhado/vcs";
import { ade } from "../ade";

export const chaveAlvo = (a: AlvoVcs): string => `${a.workspace_id}|${a.mission_id ?? ""}`;

export interface EstadoVcsStore {
  resumos: Readonly<Record<string, ResumoVcs | null>>;
}

export function criarStoreVcs({ api: obter }: { api: () => ApiVcs | undefined }) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoVcsStore = { resumos: {} };
  const refs = new Map<string, { alvo: AlvoVcs; n: number }>();
  let cancelarEventos: (() => void) | null = null;

  const publicar = (chave: string, resumo: ResumoVcs | null): void => {
    estado = { resumos: { ...estado.resumos, [chave]: resumo } };
    ouvintes.forEach((o) => o());
  };
  const aoEvento = (e: EventoVcs): void => {
    const chave = chaveAlvo({ workspace_id: e.workspace_id, mission_id: e.mission_id });
    if (refs.has(chave)) publicar(chave, e.resumo);
  };

  return {
    obter: (): EstadoVcsStore => estado,
    assinar(o: () => void): () => void {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    /** Liga o observador da árvore (contado). Devolve a função que solta a referência. */
    observar(alvo: AlvoVcs): () => void {
      const api = obter();
      if (api === undefined) return () => undefined;
      const chave = chaveAlvo(alvo);
      const atual = refs.get(chave);
      if (atual !== undefined) atual.n++;
      else {
        refs.set(chave, { alvo, n: 1 });
        if (cancelarEventos === null) cancelarEventos = api.assinar(aoEvento);
        api.observar(alvo, true).then(
          (r) => { if (refs.has(chave)) publicar(chave, r.tipo === "nenhum" ? null : r); },
          () => { if (refs.has(chave)) publicar(chave, null); },
        );
      }
      let solto = false;
      return () => {
        if (solto) return;
        solto = true;
        const r = refs.get(chave);
        if (r === undefined) return;
        if (--r.n > 0) return;
        refs.delete(chave);
        void api.observar(alvo, false).catch(() => undefined);
        if (refs.size === 0) { cancelarEventos?.(); cancelarEventos = null; }
      };
    },
    /** Refaz o resumo de uma árvore observada AGORA (sem esperar o `vcs:mudou`): o acompanhamento do Commit e push chama ao ver o commit/push (D-691). */
    async atualizar(alvo: AlvoVcs): Promise<void> {
      const api = obter();
      const chave = chaveAlvo(alvo);
      if (api === undefined || !refs.has(chave)) return;
      try {
        const e = await api.estado(alvo, false);
        if (refs.has(chave)) publicar(chave, e.tipo === "nenhum" ? null : e.resumo);
      } catch { /* o próximo vcs:mudou corrige */ }
    },
    /** Quantas árvores estão sendo observadas (teste). */
    observadas: (): number => refs.size,
  };
}

export type StoreVcs = ReturnType<typeof criarStoreVcs>;
export const storeVcs: StoreVcs = criarStoreVcs({ api: () => ade()?.vcs });

/** Resumo da árvore (observa enquanto montado). `null` = sem repositório ou ainda sem dado. */
export function useResumoVcs(alvo: AlvoVcs | null, store: StoreVcs = storeVcs): ResumoVcs | null {
  const ws = alvo?.workspace_id ?? null;
  const mis = alvo?.mission_id ?? null;
  useEffect(() => (ws === null ? undefined : store.observar({ workspace_id: ws, mission_id: mis })), [store, ws, mis]);
  const e = useSyncExternalStore(store.assinar, store.obter);
  return ws === null ? null : (e.resumos[chaveAlvo({ workspace_id: ws, mission_id: mis })] ?? null);
}

/** Texto curto do estado: `main ● ↑2 ↓1`. */
export function textoResumo(r: ResumoVcs): string {
  const partes = [r.branch ?? (r.oid !== null ? `(${r.oid})` : "sem commits")];
  if (r.sujo) partes.push("●");
  if (r.ahead > 0) partes.push(`↑${r.ahead}`);
  if (r.behind > 0) partes.push(`↓${r.behind}`);
  if (r.operacao !== null) partes.push(`[${r.operacao}]`);
  return partes.join(" ");
}
