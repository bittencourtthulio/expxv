// Ligação fina do cofre do app (sob demanda) à porta de segredos do RAG online. Nada de Electron importado aqui: o `safeStorage` entra por
// injeção (mesmo subconjunto usado por `src/main/cofre.ts`). Nada é aberto antes do primeiro uso.
import { criarCofreRag, lerSegredosRag } from "../nucleo/conhecimento/backend/cofre-rag";
import type { PortaCofreRag } from "../nucleo/conhecimento/backend/config";
import type { CofreSobDemanda, SafeStorageDoElectron } from "./cofre";

export interface DependenciasCofreRagMain {
  cofre: Pick<CofreSobDemanda, "obter">;
  safeStorage?: Pick<SafeStorageDoElectron, "getSelectedStorageBackend">;
  plataforma?: NodeJS.Platform;
}

export function criarPortaCofreRagDoApp(d: DependenciasCofreRagMain): PortaCofreRag {
  return criarCofreRag(() => d.cofre.obter(), {
    backendSafeStorage: () => {
      try {
        return d.safeStorage?.getSelectedStorageBackend?.() ?? null;
      } catch {
        return null;
      }
    },
    ...(d.plataforma === undefined ? {} : { plataforma: d.plataforma }),
  });
}

export { lerSegredosRag };
