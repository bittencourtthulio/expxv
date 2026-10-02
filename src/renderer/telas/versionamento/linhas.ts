// Mudanças -> linhas de lista (puro, uma passada): grupos (conflitos / staged / não staged / não rastreados) + arquivos.
import type { Mudanca } from "../../../nucleo/vcs/tipos";

export type GrupoId = "conflitos" | "staged" | "naoStaged" | "naoRastreados";

export type LinhaMud =
  | { k: "grupo"; id: GrupoId; rotulo: string; n: number; recolhido: boolean }
  | { k: "arq"; grupo: GrupoId; m: Mudanca; chave: string };

export const chaveMud = (g: GrupoId, caminho: string): string => `${g}:${caminho}`;

export function rotuloGrupo(id: GrupoId, comStage: boolean): string {
  if (id === "conflitos") return "Conflitos";
  if (id === "staged") return "No stage (será comitado)";
  if (id === "naoStaged") return comStage ? "Alterados (fora do stage)" : "Alterados";
  return "Não rastreados";
}

export function agrupar(arquivos: readonly Mudanca[], comStage: boolean, recolhidos: ReadonlySet<GrupoId> = new Set()): LinhaMud[] {
  const g: Record<GrupoId, Mudanca[]> = { conflitos: [], staged: [], naoStaged: [], naoRastreados: [] };
  for (const m of arquivos) {
    if (m.tipo === "ignorado") continue;
    if (m.tipo === "conflito") g.conflitos.push(m);
    else if (m.tipo === "naorastreado") g.naoRastreados.push(m);
    else {
      if (comStage && m.indice !== " ") g.staged.push(m);
      if (m.arvore !== " " || !comStage) g.naoStaged.push(m);
    }
  }
  const saida: LinhaMud[] = [];
  for (const id of ["conflitos", "staged", "naoStaged", "naoRastreados"] as const) {
    const lista = g[id];
    if (lista.length === 0) continue;
    const recolhido = recolhidos.has(id);
    saida.push({ k: "grupo", id, rotulo: rotuloGrupo(id, comStage), n: lista.length, recolhido });
    if (!recolhido) for (const m of lista) saida.push({ k: "arq", grupo: id, m, chave: chaveMud(id, m.caminho) });
  }
  return saida;
}

/** Letra a mostrar na linha (estado do lado relevante do grupo). */
export function letraDe(m: Mudanca, grupo: GrupoId): string {
  if (grupo === "conflitos") return "!";
  if (grupo === "naoRastreados") return "?";
  if (grupo === "staged") return m.indice;
  return m.arvore === " " ? m.indice : m.arvore;
}

export const NOME_LETRA: Record<string, string> = { M: "modificado", T: "tipo alterado", A: "novo", D: "apagado", R: "renomeado", C: "copiado", U: "conflito", "?": "não rastreado", "!": "conflito" };
