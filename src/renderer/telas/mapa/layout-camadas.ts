// Layout do Fluxo (fluxograma esquerda -> direita, camadas = nível de chamada) e preparação da matriz DSM. Puro.
import type { DadosAnaliseMapa, FluxoMapaIpc, NoFluxoMapa } from "../../../compartilhado/mapa";

export const LARGURA_NO = 150;
export const ALTURA_NO = 26;
export const ESPACO_X = 56;
export const ESPACO_Y = 12;
export const MAX_NOS_FLUXO = 300;

export type FormaNo = "pilula" | "retangulo" | "cilindro" | "hexagono" | "arquivo";

export function formaDoNo(n: Pick<NoFluxoMapa, "tipo" | "externo">): FormaNo {
  if (n.tipo === "entrada") return "pilula";
  if (n.tipo === "tabela") return "cilindro";
  if (n.tipo === "externo" || n.externo) return "hexagono";
  if (n.tipo === "arquivo") return "arquivo";
  return "retangulo";
}

export interface NoPosicionado { id: string; rotulo: string; x: number; y: number; w: number; h: number; forma: FormaNo; tracejado: boolean; em_ciclo: boolean; tabelas: string[]; filhos: number; colapsado: boolean }
export interface ArestaPosicionada { de: string; para: string; tipo: string; x0: number; y0: number; x1: number; y1: number; tracejado: boolean; retorno: boolean }
export interface LayoutFluxo { nos: NoPosicionado[]; arestas: ArestaPosicionada[]; largura: number; altura: number; ocultos: number }

/** Ids que ficam ocultos quando `colapsados` esconde os descendentes (só alcançáveis por eles). */
export function ocultosPorColapso(f: Pick<FluxoMapaIpc, "raiz" | "arestas">, colapsados: ReadonlySet<string>): Set<string> {
  const adj = new Map<string, string[]>();
  for (const [d, p, , , retorno] of f.arestas) {
    if (retorno === 1) continue;
    const l = adj.get(d);
    if (l === undefined) adj.set(d, [p]);
    else l.push(p);
  }
  const visiveis = new Set<string>([f.raiz]);
  const fila = [f.raiz];
  while (fila.length > 0) {
    const v = fila.shift() as string;
    if (colapsados.has(v)) continue;
    for (const w of adj.get(v) ?? []) if (!visiveis.has(w)) { visiveis.add(w); fila.push(w); }
  }
  const todos = new Set<string>([f.raiz]);
  for (const [d, p] of f.arestas) { todos.add(d); todos.add(p); }
  const ocultos = new Set<string>();
  for (const id of todos) if (!visiveis.has(id)) ocultos.add(id);
  return ocultos;
}

export function layoutFluxo(f: FluxoMapaIpc, colapsados: ReadonlySet<string> = new Set()): LayoutFluxo {
  const ocultos = ocultosPorColapso(f, colapsados);
  const nos = f.nos.slice(0, MAX_NOS_FLUXO).filter((n) => !ocultos.has(n.id));
  const colunas = new Map<number, NoFluxoMapa[]>();
  for (const n of nos) {
    const l = colunas.get(n.nivel);
    if (l === undefined) colunas.set(n.nivel, [n]);
    else l.push(n);
  }
  const filhos = new Map<string, number>();
  for (const [d, , , , retorno] of f.arestas) if (retorno !== 1) filhos.set(d, (filhos.get(d) ?? 0) + 1);
  const pos = new Map<string, NoPosicionado>();
  let altura = 0;
  for (const [nivel, lista] of [...colunas.entries()].sort((a, b) => a[0] - b[0])) {
    lista.forEach((n, i) => {
      const p: NoPosicionado = {
        id: n.id, rotulo: n.rotulo, x: nivel * (LARGURA_NO + ESPACO_X), y: i * (ALTURA_NO + ESPACO_Y), w: LARGURA_NO, h: ALTURA_NO, forma: formaDoNo(n),
        tracejado: n.tracejado, em_ciclo: n.em_ciclo, tabelas: n.tabelas, filhos: filhos.get(n.id) ?? 0, colapsado: colapsados.has(n.id),
      };
      pos.set(n.id, p);
      altura = Math.max(altura, p.y + ALTURA_NO);
    });
  }
  const arestas: ArestaPosicionada[] = [];
  for (const [d, p, tipo, exata, retorno] of f.arestas) {
    const a = pos.get(d);
    const b = pos.get(p);
    if (a === undefined || b === undefined) continue;
    arestas.push({ de: d, para: p, tipo, x0: a.x + a.w, y0: a.y + a.h / 2, x1: b.x, y1: b.y + b.h / 2, tracejado: exata === 0, retorno: retorno === 1 });
  }
  const maxNivel = colunas.size === 0 ? 0 : Math.max(...colunas.keys());
  return { nos: [...pos.values()], arestas, largura: (maxNivel + 1) * (LARGURA_NO + ESPACO_X) - ESPACO_X, altura, ocultos: ocultos.size };
}

// ---- DSM ----

export const MAX_MODULOS_DSM = 200;
export type DsmMapa = DadosAnaliseMapa["camadas"]["dsm"];

/** Acima de 200 módulos, agrega pela pasta de 1º nível. */
export function dsmParaTela(dsm: DsmMapa, max = MAX_MODULOS_DSM): { modulos: string[]; celulas: number[][]; agregado: boolean } {
  if (dsm.modulos.length <= max) return { modulos: dsm.modulos, celulas: dsm.celulas, agregado: false };
  const chave = (m: string): string => m.split("/")[0] || ".";
  const nomes: string[] = [];
  const idx = new Map<string, number>();
  for (const m of dsm.modulos) { const k = chave(m); if (!idx.has(k)) { idx.set(k, nomes.length); nomes.push(k); } }
  const celulas = nomes.map(() => nomes.map(() => 0));
  dsm.modulos.forEach((mi, i) => dsm.modulos.forEach((mj, j) => {
    const v = dsm.celulas[i]?.[j] ?? 0;
    const a = idx.get(chave(mi)) as number;
    const b = idx.get(chave(mj)) as number;
    if (v > 0 && a !== b) (celulas[a] as number[])[b] = ((celulas[a] as number[])[b] as number) + v;
  }));
  return { modulos: nomes, celulas, agregado: true };
}

export type ChaveCelula = `${string}>${string}`;
/** Pares (de>para) marcados como violação, pelo nome do módulo (já agregado quando for o caso). */
export function celulasDeViolacao(violacoes: DadosAnaliseMapa["camadas"]["violacoes"], agregado: boolean): Set<ChaveCelula> {
  const k = (m: string): string => (agregado ? m.split("/")[0] || "." : m);
  return new Set(violacoes.map((v) => `${k(v.de_modulo)}>${k(v.para_modulo)}` as ChaveCelula));
}
