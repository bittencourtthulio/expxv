import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { NomeIcone } from "../componentes/Icone";

export type TelaId = "inicio" | "missoes" | "terminais" | "metodo" | "workspaces" | "provedores" | "config";

export interface DefTela {
  id: TelaId;
  rotulo: string;
  icone: NomeIcone;
  Componente: LazyExoticComponent<ComponentType>;
}

export const TELAS: readonly DefTela[] = [
  { id: "inicio", rotulo: "Início", icone: "inicio", Componente: lazy(() => import("../telas/inicio")) },
  { id: "missoes", rotulo: "Missões", icone: "missoes", Componente: lazy(() => import("../telas/missoes")) },
  { id: "terminais", rotulo: "Terminais", icone: "terminais", Componente: lazy(() => import("../telas/terminais")) },
  { id: "metodo", rotulo: "Método", icone: "metodo", Componente: lazy(() => import("../telas/metodo")) },
  { id: "workspaces", rotulo: "Workspaces", icone: "workspaces", Componente: lazy(() => import("../telas/workspaces")) },
  { id: "provedores", rotulo: "Provedores", icone: "provedores", Componente: lazy(() => import("../telas/provedores")) },
  { id: "config", rotulo: "Configurações", icone: "config", Componente: lazy(() => import("../telas/config")) },
];

export const MAX_MONTADAS = 4;

/**
 * Política de telas montadas: lista MRU (mais recente primeiro) com no máximo 4 telas;
 * "terminais", depois de visitada, nunca é descartada e não conta no limite (perderia o estado visual).
 */
export function atualizarMontadas(atual: readonly TelaId[], nova: TelaId): TelaId[] {
  const lista = [nova, ...atual.filter((t) => t !== nova)];
  let comuns = 0;
  return lista.filter((t) => t === "terminais" || ++comuns <= MAX_MONTADAS);
}
