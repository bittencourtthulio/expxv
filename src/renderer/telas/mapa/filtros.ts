// Filtros do grafo (puro): estado da UI -> filtro do IPC, e filtragem local rápida sobre o grafo já carregado.
import type { ConfiancaIpc, FiltroGrafoMapa, GrafoMapaIpc, TipoNoIpc } from "../../../compartilhado/mapa";

export interface EstadoFiltros {
  linguagens: string[];
  pasta: string;
  tipos: TipoNoIpc[];
  minConfianca: ConfiancaIpc | null;
  soCiclos: boolean;
}

export const FILTROS_VAZIOS: EstadoFiltros = { linguagens: [], pasta: "", tipos: [], minConfianca: null, soCiclos: false };

export function contarFiltros(f: EstadoFiltros): number {
  return (f.linguagens.length > 0 ? 1 : 0) + (f.pasta.trim() !== "" ? 1 : 0) + (f.tipos.length > 0 ? 1 : 0) + (f.minConfianca !== null ? 1 : 0) + (f.soCiclos ? 1 : 0);
}

/** Pasta digitada: relativa, sem `..` nem barra inicial (o main revalida; aqui só evita mandar lixo). */
export function pastaSegura(texto: string): string {
  const t = texto.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
  if (t === "" || t.split("/").includes("..") || /^[A-Za-z]:/.test(t)) return "";
  return t;
}

export function paraFiltroIpc(f: EstadoFiltros): FiltroGrafoMapa {
  const out: FiltroGrafoMapa = {};
  if (f.linguagens.length > 0) out.linguagens = [...f.linguagens];
  const p = pastaSegura(f.pasta);
  if (p !== "") out.pasta = p;
  if (f.minConfianca !== null) out.min_confianca = f.minConfianca;
  if (f.soCiclos) out.so_ciclos = true;
  return out;
}

/** Filtragem local: tipo de nó e (de novo) ciclos/confiança, sem ir ao main. Remove arestas órfãs e reindexa. */
export function filtrarLocal(g: GrafoMapaIpc, f: EstadoFiltros): GrafoMapaIpc {
  const tipos = f.tipos.length > 0 ? new Set<string>(f.tipos) : null;
  const manter: boolean[] = g.nos.map((n) => (tipos === null || tipos.has(n.t)) && (!f.soCiclos || n.c !== undefined) && (f.linguagens.length === 0 || n.l === undefined || f.linguagens.includes(n.l)));
  const novoIndice: number[] = [];
  const nos = g.nos.filter((_, i) => { if (manter[i] === true) { novoIndice[i] = novoIndice.length; return true; } return false; });
  const arestas = g.arestas
    .filter((a) => manter[a[0]] === true && manter[a[1]] === true && (f.minConfianca !== "exata" || a[3] === 1))
    .map((a) => [novoIndice[a[0]] as number, novoIndice[a[1]] as number, a[2], a[3], a[4]] as GrafoMapaIpc["arestas"][number]);
  return { ...g, nos, arestas };
}
