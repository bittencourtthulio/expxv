// D-570/D-571: terminais por workspace para o painel de workspaces e o seletor do cabeçalho. O snapshot é uma STRING (primitivo): o componente só re-renderiza quando
// uma contagem muda, nunca por saída de terminal ou por atividade de sessão.
import { useMemo, useSyncExternalStore } from "react";
import { storeTerminais, type StoreTerminais } from "./terminais";
import { contarPorWorkspace } from "../telas/terminais/por-workspace";

export interface ContagemTerminais {
  /** terminais por id de workspace (só ids com pelo menos um). */
  porWorkspace: ReadonlyMap<string, number>;
  /** sessões sem workspace (ou de workspace que não existe mais): o grupo "Sem projeto". */
  semProjeto: number;
}

export function useContagemTerminais(conhecidos: ReadonlySet<string> | null, store: StoreTerminais = storeTerminais): ContagemTerminais {
  const assinatura = useSyncExternalStore(store.assinar, () => JSON.stringify([...contarPorWorkspace(store.obter().sessoes, conhecidos)].sort((a, b) => String(a[0]).localeCompare(String(b[0])))));
  return useMemo(() => {
    const pares = JSON.parse(assinatura) as Array<[string | null, number]>;
    const porWorkspace = new Map<string, number>();
    let semProjeto = 0;
    for (const [id, n] of pares) { if (id === null) semProjeto = n; else porWorkspace.set(id, n); }
    return { porWorkspace, semProjeto };
  }, [assinatura]);
}
