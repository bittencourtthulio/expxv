import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { missaoTerminal, storeMissoes, type StoreMissoes } from "../../estado/missoes";
import { mapaDeDetalhes, SEM_MISSAO, type MapaMissao } from "./missao";

/** Mapa sessão → pane de Missão. Observa o detalhe só das missões squad/agêntico não terminais. */
export function useMapaMissao(store: StoreMissoes = storeMissoes, ativo = true): MapaMissao {
  const itens = useSyncExternalStore(store.assinar, () => store.obter().itens);
  const detalhes = useSyncExternalStore(store.assinar, () => store.obter().detalhes);
  const observadas = useRef(new Set<string>());
  useEffect(() => {
    if (!ativo) return;
    const alvo = new Set(itens.filter((m) => m.modo !== "livre" && !missaoTerminal(m.estado)).map((m) => m.id));
    for (const id of alvo) if (!observadas.current.has(id)) { observadas.current.add(id); void store.observarDetalhe(id); }
    for (const id of [...observadas.current]) if (!alvo.has(id)) { observadas.current.delete(id); store.pararDetalhe(id); }
  }, [itens, store, ativo]);
  useEffect(() => () => { for (const id of observadas.current) store.pararDetalhe(id); observadas.current.clear(); }, [store]);
  return useMemo(() => (ativo ? mapaDeDetalhes(detalhes) : SEM_MISSAO), [detalhes, ativo]);
}
