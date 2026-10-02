import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { NomeIcone } from "../componentes/Icone";

export type TelaId = "inicio" | "missoes" | "squads" | "terminais" | "metodo" | "trabalhos" | "versionamento" | "harness" | "consumo" | "memoria" | "conhecimento" | "chat" | "alertas" | "jarvis" | "agil" | "relatorios" | "bench" | "mapa" | "pipelines" | "workspaces" | "provedores" | "loja-mcp" | "catalogo" | "config";

/** Categorias da navegação lateral (docs/ade/04-UI-UX.md, "Navegação agrupada"): uma tela pertence a exatamente um grupo. */
export type GrupoId = "trabalho" | "codigo" | "conhecimento" | "gestao" | "ia" | "extensoes" | "sistema";

export interface DefGrupo {
  id: GrupoId;
  rotulo: string;
  icone: NomeIcone;
}

/** Ordem de exibição na barra lateral (≤ 7 grupos de topo). */
export const GRUPOS: readonly DefGrupo[] = [
  { id: "trabalho", rotulo: "Trabalho", icone: "missoes" },
  { id: "codigo", rotulo: "Código", icone: "codigo" },
  { id: "conhecimento", rotulo: "Contexto", icone: "grafo" },
  { id: "gestao", rotulo: "Gestão", icone: "agil" },
  { id: "ia", rotulo: "IA e consumo", icone: "provedores" },
  { id: "extensoes", rotulo: "Extensões", icone: "loja" },
  { id: "sistema", rotulo: "Sistema", icone: "config" },
];

export interface DefTela {
  id: TelaId;
  grupo: GrupoId;
  rotulo: string;
  icone: NomeIcone;
  Componente: LazyExoticComponent<ComponentType>;
}

export const TELAS: readonly DefTela[] = [
  { id: "inicio", grupo: "trabalho", rotulo: "Início", icone: "inicio", Componente: lazy(() => import("../telas/inicio")) },
  { id: "missoes", grupo: "trabalho", rotulo: "Missões", icone: "missoes", Componente: lazy(() => import("../telas/missoes")) },
  { id: "terminais", grupo: "trabalho", rotulo: "Terminais", icone: "terminais", Componente: lazy(() => import("../telas/terminais")) },
  { id: "pipelines", grupo: "trabalho", rotulo: "Pipelines", icone: "pipelines", Componente: lazy(() => import("../telas/pipelines")) },
  { id: "squads", grupo: "trabalho", rotulo: "Squads", icone: "squads", Componente: lazy(() => import("../telas/squads")) },
  { id: "metodo", grupo: "codigo", rotulo: "Método", icone: "metodo", Componente: lazy(() => import("../telas/metodo")) },
  { id: "trabalhos", grupo: "codigo", rotulo: "Trabalhos", icone: "trabalhos", Componente: lazy(() => import("../telas/trabalhos")) },
  { id: "versionamento", grupo: "codigo", rotulo: "Versionamento", icone: "versionamento", Componente: lazy(() => import("../telas/versionamento")) },
  { id: "mapa", grupo: "codigo", rotulo: "Mapa", icone: "mapa", Componente: lazy(() => import("../telas/mapa")) },
  { id: "memoria", grupo: "conhecimento", rotulo: "Memória", icone: "memoria", Componente: lazy(() => import("../telas/memoria")) },
  { id: "conhecimento", grupo: "conhecimento", rotulo: "Conhecimento", icone: "grafo", Componente: lazy(() => import("../telas/conhecimento")) },
  { id: "chat", grupo: "conhecimento", rotulo: "Chat", icone: "chat", Componente: lazy(() => import("../telas/chat")) },
  { id: "agil", grupo: "gestao", rotulo: "Gestão ágil", icone: "agil", Componente: lazy(() => import("../telas/agil")) },
  { id: "relatorios", grupo: "gestao", rotulo: "Relatórios", icone: "relatorios", Componente: lazy(() => import("../telas/relatorios")) },
  { id: "alertas", grupo: "gestao", rotulo: "Alertas", icone: "alerta", Componente: lazy(() => import("../telas/alertas")) },
  { id: "provedores", grupo: "ia", rotulo: "Provedores", icone: "provedores", Componente: lazy(() => import("../telas/provedores")) },
  { id: "harness", grupo: "ia", rotulo: "Harness", icone: "harness", Componente: lazy(() => import("../telas/harness")) },
  { id: "consumo", grupo: "ia", rotulo: "Consumo", icone: "consumo", Componente: lazy(() => import("../telas/consumo")) },
  { id: "bench", grupo: "ia", rotulo: "Bench", icone: "bench", Componente: lazy(() => import("../telas/bench")) },
  { id: "loja-mcp", grupo: "extensoes", rotulo: "Loja de MCPs", icone: "loja", Componente: lazy(() => import("../telas/loja-mcp")) },
  { id: "catalogo", grupo: "extensoes", rotulo: "Catálogo", icone: "catalogo", Componente: lazy(() => import("../telas/catalogo")) },
  { id: "jarvis", grupo: "extensoes", rotulo: "Jarvis", icone: "chat", Componente: lazy(() => import("../telas/jarvis")) },
  { id: "workspaces", grupo: "sistema", rotulo: "Workspaces", icone: "workspaces", Componente: lazy(() => import("../telas/workspaces")) },
  { id: "config", grupo: "sistema", rotulo: "Configurações", icone: "config", Componente: lazy(() => import("../telas/config")) },
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

/** Telas de um grupo, na ordem de `TELAS` (que é a ordem de exibição dentro do grupo). */
export const telasDoGrupo = (grupo: GrupoId): DefTela[] => TELAS.filter((t) => t.grupo === grupo);
export const grupoDaTela = (id: TelaId): GrupoId => TELAS.find((t) => t.id === id)!.grupo;
