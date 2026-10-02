// Carregamento sob demanda do grafo 3D: nada disto entra no boot; o chunk só é baixado quando uma tela escolhe o modo 3D.
import { lazy, Suspense } from "react";
import type { PropsGrafo3D } from "./Grafo3D";

const Grafo3D = lazy(() => import("./Grafo3D"));

export function Grafo3DSobDemanda(props: PropsGrafo3D) {
  return (
    <Suspense fallback={<p className="g3d-aviso" role="status">Carregando o grafo 3D…</p>}>
      <Grafo3D {...props} />
    </Suspense>
  );
}
export type { PropsGrafo3D, ItemLegenda } from "./Grafo3D";
export type { No3D, Elo3D } from "./index";
