// Ponte do Mapa para o grafo 3D (puro): categorias (linguagem, camada, pacote, hotspot, ciclo) e paleta derivada dos tokens.
import type { Elo3D, ItemLegenda, No3D } from "../../componentes/grafo3d/Grafo3DSobDemanda";
import type { GrafoAgrupado } from "./agrupamento";

export type ColorirPor = "linguagem" | "camada" | "pacote" | "hotspot";
export const OPCOES_COLORIR: ReadonlyArray<{ id: ColorirPor; rotulo: string }> = [
  { id: "linguagem", rotulo: "Linguagem" }, { id: "camada", rotulo: "Camada" }, { id: "pacote", rotulo: "Pacote" }, { id: "hotspot", rotulo: "Hotspot" },
];
/** Categorias com cor fixa (token); as demais recebem a paleta de gráfico em rodízio. */
export const PALETA_MAPA: Readonly<Record<string, string>> = { grupo: "--destaque", ciclo: "--alerta", quente: "--aviso", morno: "--destaque-2", frio: "--texto-discreto", outros: "--texto-discreto" };
export const ROTULO_FIXO: Readonly<Record<string, string>> = { grupo: "Grupo", ciclo: "Ciclo", quente: "Hotspot alto", morno: "Hotspot médio", frio: "Hotspot baixo", outros: "Outros" };
const MAX_PACOTES = 7;

type NoMapa = GrafoAgrupado["nos"][number];
const pacoteDe = (g: string): string => g.split("/")[0] || ".";

export function categoriaDoNo(n: NoMapa, por: ColorirPor, pacotes: ReadonlySet<string>): string {
  if (n.cluster) return "grupo";
  const o = n.original;
  switch (por) {
    case "linguagem": return o?.l ?? "outros";
    case "camada": return o?.k === undefined ? "outros" : `camada ${o.k}`;
    case "pacote": { const p = pacoteDe(n.grupo); return pacotes.has(p) ? p : "outros"; }
    case "hotspot": { const p = o?.p ?? 0; return p >= 0.66 ? "quente" : p >= 0.33 ? "morno" : "frio"; }
  }
}

export interface Dados3D { nos: No3D[]; elos: Elo3D[]; legenda: ItemLegenda[] }

export function paraGrafo3D(g: GrafoAgrupado, por: ColorirPor): Dados3D {
  const contagem = new Map<string, number>();
  for (const n of g.nos) { const p = pacoteDe(n.grupo); contagem.set(p, (contagem.get(p) ?? 0) + 1); }
  const pacotes = new Set([...contagem].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_PACOTES).map(([p]) => p));
  const nos: No3D[] = g.nos.map((n) => ({ id: n.id, rotulo: n.cluster ? `${n.rotulo} (${n.membros})` : n.rotulo, categoria: categoriaDoNo(n, por, pacotes), peso: Math.log1p(n.w) + (n.cluster ? 2 : 0), grupo: n.grupo, alerta: n.ciclo }));
  const elos: Elo3D[] = g.arestas.map((a) => {
    const de = g.nos[a[0]], para = g.nos[a[1]];
    return { a: (de as NoMapa).id, b: (para as NoMapa).id, peso: a[3] === 0 ? a[4] * 0.4 : a[4], alerta: (de as NoMapa).ciclo && (para as NoMapa).ciclo };
  });
  const cont = new Map<string, number>();
  for (const n of nos) cont.set(n.categoria, (cont.get(n.categoria) ?? 0) + 1);
  const legenda = [...cont].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([categoria, n]) => ({ categoria, rotulo: ROTULO_FIXO[categoria] ?? categoria, n }));
  const ciclos = nos.filter((n) => n.alerta === true).length;
  if (ciclos > 0) legenda.push({ categoria: "ciclo", rotulo: ROTULO_FIXO["ciclo"] as string, n: ciclos });
  return { nos, elos, legenda };
}
