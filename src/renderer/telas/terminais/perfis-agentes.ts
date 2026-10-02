// Perfil NOMINAL dos agentes de squad (`agentes:listar`) para o rótulo do Pane. Um cache de módulo, carregado em ocioso e só quando
// existe Pane com agente: nunca uma chamada por render. É INDICATIVO: o efetivo (Fase 9) pode diferir por troca de conta/faixa.
import { useEffect, useSyncExternalStore } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { PerfilMembro } from "../../../compartilhado/squads";
import { ade } from "../../ade";

export interface PerfilNominal {
  rotulo: string;
  perfil: PerfilMembro;
}
const VAZIO: ReadonlyMap<string, PerfilNominal> = new Map();
const REPETIR_APOS_MS = 15_000;
let mapa: ReadonlyMap<string, PerfilNominal> = VAZIO;
let ultimaCarga = 0;
let carregando = false;
const ouvintes = new Set<() => void>();

export async function carregarPerfisDeAgentes(api: ApiAde["agentes"] | undefined = ade()?.agentes, agora: () => number = Date.now): Promise<void> {
  if (api === undefined || carregando) return;
  carregando = true;
  try {
    const itens = await api.listar();
    mapa = new Map(itens.map((a) => [a.agent_id, { rotulo: a.rotulo, perfil: a.perfil }]));
  } catch {
    // sem perfil o rótulo segue sem o detalhe
  } finally {
    ultimaCarga = agora();
    carregando = false;
    for (const o of ouvintes) o();
  }
}

/** Só para teste. */
export function zerarPerfisDeAgentes(): void {
  mapa = VAZIO;
  ultimaCarga = 0;
  carregando = false;
  for (const o of ouvintes) o();
}

const assinar = (cb: () => void): (() => void) => { ouvintes.add(cb); return () => void ouvintes.delete(cb); };
const ocioso = (f: () => void): void => { const r = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback; if (typeof r === "function") r(f); else setTimeout(f, 0); };

/** `agentIds`: os agentes dos Panes visíveis. Carrega uma vez (e de novo, no máximo a cada 15 s, se aparecer um id que o cache não tem). */
export function usePerfisDeAgentes(agentIds: ReadonlyArray<string | null | undefined>, api?: ApiAde["agentes"]): ReadonlyMap<string, PerfilNominal> {
  const atual = useSyncExternalStore(assinar, () => mapa, () => VAZIO);
  const faltando = agentIds.some((id) => typeof id === "string" && !atual.has(id));
  useEffect(() => {
    if (!faltando || carregando || (ultimaCarga !== 0 && Date.now() - ultimaCarga < REPETIR_APOS_MS)) return;
    ocioso(() => void carregarPerfisDeAgentes(api));
  }, [faltando, api]);
  return atual;
}

/** "modelo · esforço (indicativo)" ou `null` sem dado. */
export function textoDoPerfil(p: PerfilNominal | undefined): string | null {
  if (p === undefined) return null;
  const { cli, modelo, esforco } = p.perfil;
  const partes = [modelo ?? (cli === "auto" ? "modelo automático" : "modelo padrão"), esforco ?? "esforço padrão"];
  return `${partes.join(" · ")} (indicativo)`;
}
