import type { FluxoMapaIpc, GrafoMapaIpc } from "../../../compartilhado/mapa";

// Modelo neutro das exportações (T-17.38): grafo ou fluxo viram uma lista de nós e arestas por índice, com agrupamento por
// módulo quando passa do teto. Puro: sem I/O.

export interface NoVista {
  id: string;
  rotulo: string;
  grupo: string;
  tipo: string;
  peso: number;
}

export interface ArestaVista {
  de: number;
  para: number;
  tipo: string;
  exata: boolean;
  peso: number;
}

export interface VistaNeutra {
  nos: NoVista[];
  arestas: ArestaVista[];
  /** Texto de aviso quando houve agrupamento ou corte. */
  nota: string | null;
  agrupada: boolean;
}

export type VistaExportavel = GrafoMapaIpc | FluxoMapaIpc;

export const MAX_NOS_PADRAO = 300;

export const ehFluxo = (v: VistaExportavel): v is FluxoMapaIpc => "raiz" in v;

function dirDe(caminho: string | null, tipo: string): string {
  if (caminho === null) return tipo;
  const i = caminho.lastIndexOf("/");
  return i < 0 ? "." : caminho.slice(0, i);
}

/** Tira controles e limita o tamanho do rótulo (sem cortar no meio de um par substituto). */
export function rotuloSeguro(texto: string, max = 80): string {
  // eslint-disable-next-line no-control-regex
  const limpo = texto.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
  const pontos = [...limpo];
  return pontos.length > max ? `${pontos.slice(0, max - 1).join("")}…` : limpo;
}

export function neutralizar(v: VistaExportavel, maxNos = MAX_NOS_PADRAO): VistaNeutra {
  let nos: NoVista[];
  let arestas: ArestaVista[];
  if (ehFluxo(v)) {
    nos = v.nos.map((n) => ({ id: n.id, rotulo: n.rotulo, grupo: dirDe(n.caminho, n.tipo), tipo: n.tipo, peso: 1 }));
    const idx = new Map(nos.map((n, i) => [n.id, i]));
    arestas = [];
    for (const [de, para, tipo, exata] of v.arestas) {
      const a = idx.get(de);
      const b = idx.get(para);
      if (a === undefined || b === undefined) continue;
      arestas.push({ de: a, para: b, tipo, exata: exata === 1, peso: 1 });
    }
  } else {
    nos = v.nos.map((n) => ({ id: n.id, rotulo: n.r, grupo: n.g, tipo: n.t, peso: Math.max(1, n.w) }));
    arestas = v.arestas
      .filter(([a, b]) => a >= 0 && b >= 0 && a < nos.length && b < nos.length)
      .map(([de, para, tipo, exata, peso]) => ({ de, para, tipo, exata: exata === 1, peso }));
  }
  if (nos.length <= maxNos) return { nos, arestas, nota: v.truncado ? "o mapa foi truncado pelo limite de nós da consulta" : null, agrupada: false };
  // agrupa por módulo
  const grupos = new Map<string, number>();
  const nosG: NoVista[] = [];
  const mapa: number[] = nos.map((n) => {
    let i = grupos.get(n.grupo);
    if (i === undefined) {
      i = nosG.length;
      grupos.set(n.grupo, i);
      nosG.push({ id: `mod:${n.grupo}`, rotulo: n.grupo, grupo: n.grupo, tipo: "modulo", peso: 0 });
    }
    (nosG[i] as NoVista).peso += n.peso;
    return i;
  });
  const agreg = new Map<string, ArestaVista>();
  for (const a of arestas) {
    const de = mapa[a.de] as number;
    const para = mapa[a.para] as number;
    if (de === para) continue;
    const k = `${de}>${para}`;
    const e = agreg.get(k);
    if (e === undefined) agreg.set(k, { de, para, tipo: "depende", exata: a.exata, peso: a.peso });
    else {
      e.peso += a.peso;
      e.exata = e.exata || a.exata;
    }
  }
  let finais = nosG;
  let arestasG = [...agreg.values()];
  let nota = `agrupado por módulo: ${nos.length} nós acima do teto de ${maxNos}`;
  if (nosG.length > maxNos) {
    const manter = [...nosG.keys()].sort((a, b) => (nosG[b] as NoVista).peso - (nosG[a] as NoVista).peso || a - b).slice(0, maxNos);
    const novo = new Map(manter.sort((a, b) => a - b).map((antigo, i) => [antigo, i]));
    finais = manter.map((i) => nosG[i] as NoVista);
    arestasG = arestasG.filter((a) => novo.has(a.de) && novo.has(a.para)).map((a) => ({ ...a, de: novo.get(a.de) as number, para: novo.get(a.para) as number }));
    nota += `; mantidos os ${maxNos} módulos de maior peso`;
  }
  return { nos: finais, arestas: arestasG, nota, agrupada: true };
}
