// Eventos da memória que valem FORA da tela Memória (Fase 8): avisos (toast), "brief carregado" por Pane. Módulo minúsculo e sem React
// pesado: a casca o liga em ocioso, depois da primeira pintura (a tela Memória em si é lazy). Nenhum payload carrega `conteudo`.
import { useSyncExternalStore } from "react";
import type { EventoMemoria, PayloadsEventoMemoria } from "../../compartilhado/memoria";
import { ade } from "../ade";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";

export interface BriefDoPane { caracteres: number; truncado: boolean }

const MAX_MENSAGEM = 240;
const limpar = (t: string): string => t.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, MAX_MENSAGEM);

/** Texto do toast por código de aviso (a mensagem do main vai junto, limitada). */
export function textoDoAviso(a: PayloadsEventoMemoria["memoria:aviso"]): { texto: string; tom: TomAviso } {
  const m = limpar(a.mensagem);
  switch (a.codigo) {
    case "brief_falhou": return { texto: `O painel abriu sem o brief de memória.${m !== "" ? ` ${m}` : ""}`, tom: "aviso" };
    case "limite_atingido": return { texto: `Memória no limite: novas entradas podem ser recusadas.${m !== "" ? ` ${m}` : ""} Reduza a retenção ou apague o que não precisa em Memória.`, tom: "aviso" };
    case "fts5_indisponivel": return { texto: "A busca da memória usa o modo simples (sem FTS5). Funciona, só é mais lenta em bases grandes.", tom: "info" };
    default: return { texto: m !== "" ? m : "Aviso da memória.", tom: "info" };
  }
}

export interface OpcoesEventosMemoria {
  api?: () => NonNullable<ReturnType<typeof ade>>["memoria"] | undefined;
  avisar?: (texto: string, tom?: TomAviso) => unknown;
}

export function criarEventosMemoria(op: OpcoesEventosMemoria = {}) {
  const obterApi = op.api ?? (() => ade()?.memoria);
  const avisar = op.avisar ?? avisarPadrao;
  const ouvintes = new Set<() => void>();
  let briefs: Readonly<Record<string, BriefDoPane>> = {};
  let desligar: (() => void) | null = null;
  let jaAvisouFts = false;

  const aoEvento = (e: EventoMemoria): void => {
    if (e.canal === "memoria:brief_montado") {
      briefs = { ...briefs, [e.payload.pane_id]: { caracteres: e.payload.caracteres, truncado: e.payload.truncado } };
      ouvintes.forEach((o) => o());
    } else if (e.canal === "memoria:aviso") {
      if (e.payload.codigo === "fts5_indisponivel") { if (jaAvisouFts) return; jaAvisouFts = true; }
      const { texto, tom } = textoDoAviso(e.payload);
      avisar(texto, tom);
    }
  };

  return {
    obter: (): Readonly<Record<string, BriefDoPane>> => briefs,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    /** Uma assinatura só; sem canal (fora do Electron) não faz nada. */
    ligar(): () => void {
      if (desligar !== null) return desligar;
      const api = obterApi();
      const cancelar = api !== undefined && typeof api.assinar === "function" ? api.assinar(aoEvento) : () => undefined;
      desligar = () => { cancelar(); desligar = null; };
      return desligar;
    },
  };
}

export type EventosMemoria = ReturnType<typeof criarEventosMemoria>;
export const eventosMemoria: EventosMemoria = criarEventosMemoria();

/** Liga em ocioso (depois da primeira pintura); devolve a função que cancela. */
export function ligarEventosMemoriaEmOcioso(e: EventosMemoria = eventosMemoria): () => void {
  let desligar: (() => void) | null = null;
  const ligar = (): void => { desligar = e.ligar(); };
  const ric = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void }).requestIdleCallback;
  if (typeof ric === "function") {
    const id = ric(ligar, { timeout: 2_000 });
    return () => { (globalThis as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(id); desligar?.(); };
  }
  const t = setTimeout(ligar, 300);
  return () => { clearTimeout(t); desligar?.(); };
}

export function useBriefDoPane(paneId: string | undefined, e: EventosMemoria = eventosMemoria): BriefDoPane | undefined {
  const todos = useSyncExternalStore(e.assinar, e.obter);
  return paneId === undefined ? undefined : todos[paneId];
}
