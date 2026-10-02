// Gravação e consultas do grafo (T-15.20/21): subgrafo com teto e AGREGAÇÃO por tipo, foco com N saltos, detalhe do nó com fontes,
// vizinhança de documentos (braço "grafo" da recuperação) e pesos por grau.
import type { ArestaGrafo, FonteResultado, NoGrafo, TipoDocumento } from "../../../compartilhado/conhecimento";
import type { ArestaLinha, NoLinha, Repos } from "../repos";
import { chaveDe, type GrafoExtraido } from "./modelo";

export function gravarGrafo(repos: Repos, colecao_id: string, documento_id: string, g: GrafoExtraido, quando: string): { nos: number; arestas: number } {
  const ids = new Map<string, string>();
  return repos.banco.transacao(() => {
    for (const n of g.nos) ids.set(chaveDe(n), repos.grafo.upsertNo({ colecao_id, tipo: n.tipo, chave: n.chave, rotulo: n.rotulo, ...(n.props ? { props: n.props } : {}), quando }));
    let a = 0;
    for (const e of g.arestas) {
      const o = ids.get(chaveDe(e.de));
      const d = ids.get(chaveDe(e.para));
      if (!o || !d) continue;
      repos.grafo.upsertAresta({ origem_id: o, destino_id: d, tipo: e.tipo, documento_id, peso: e.peso ?? 1, quando });
      a++;
    }
    return { nos: g.nos.length, arestas: a };
  });
}

const paraNo = (n: NoLinha): NoGrafo => ({ id: n.id, tipo: n.tipo, rotulo: n.rotulo, peso: n.peso, x: n.x, y: n.y, ultimo_em: n.ultimo_em, mission_id: n.tipo === "missao" ? n.chave : null });
const paraAresta = (a: ArestaLinha): ArestaGrafo => ({ origem: a.origem_id, destino: a.destino_id, tipo: a.tipo, peso: a.peso });

export interface FiltroSubgrafo {
  tipos?: readonly string[] | null;
  desde?: string | null;
  mission_id?: string | null;
  foco_no_id?: string | null;
  saltos?: number;
  max_nos?: number;
}

export interface Subgrafo {
  nos: NoGrafo[];
  arestas: ArestaGrafo[];
  truncado: boolean;
}

export function subgrafo(repos: Repos, colecao_id: string, f: FiltroSubgrafo = {}): Subgrafo {
  const max = Math.min(Math.max(f.max_nos ?? 2000, 10), 5000);
  let candidatos: NoLinha[];
  if (f.foco_no_id) {
    const visitados = new Set<string>([f.foco_no_id]);
    let fronteira = [f.foco_no_id];
    for (let s = 0; s < Math.min(f.saltos ?? 1, 4); s++) {
      const prox: string[] = [];
      for (const a of repos.grafo.arestasDe(fronteira)) {
        for (const id of [a.origem_id, a.destino_id]) if (!visitados.has(id)) (visitados.add(id), prox.push(id));
      }
      fronteira = prox;
      if (visitados.size > max * 2) break;
    }
    candidatos = [...visitados].map((id) => repos.grafo.no(id)).filter((n): n is NoLinha => n !== undefined && n.colecao_id === colecao_id);
  } else if (f.mission_id) {
    const ids = new Set(
      repos.banco
        .consultar<{ o: string; d: string }>("SELECT a.origem_id AS o, a.destino_id AS d FROM rag_aresta a JOIN rag_documento doc ON doc.id = a.documento_id WHERE doc.colecao_id = ? AND doc.mission_id = ?", [colecao_id, f.mission_id])
        .flatMap((r) => [r.o, r.d]),
    );
    candidatos = [...ids].map((id) => repos.grafo.no(id)).filter((n): n is NoLinha => n !== undefined);
  } else candidatos = repos.grafo.nos(colecao_id, f.tipos ?? null, max * 4);
  if (f.tipos && f.tipos.length > 0) candidatos = candidatos.filter((n) => f.tipos?.includes(n.tipo));
  if (f.desde) candidatos = candidatos.filter((n) => n.ultimo_em >= (f.desde as string));

  let truncado = false;
  let nos = candidatos;
  const agregados = new Map<string, number>();
  if (nos.length > max) {
    truncado = true;
    nos = [...nos].sort((a, b) => b.peso - a.peso || (a.id < b.id ? -1 : 1));
    const manter = nos.slice(0, Math.max(1, max - 8));
    for (const n of nos.slice(manter.length)) agregados.set(n.tipo, (agregados.get(n.tipo) ?? 0) + 1);
    nos = manter;
  }
  const idsMantidos = new Set(nos.map((n) => n.id));
  const arestas = repos.grafo.arestasEntre(idsMantidos);
  const outNos = nos.map(paraNo);
  for (const [tipo, n] of agregados) outNos.push({ id: `agg:${tipo}`, tipo, rotulo: `${n} × ${tipo}`, peso: Math.log2(2 + n), x: null, y: null, ultimo_em: "", mission_id: null });
  // arestas deduplicadas por (origem,destino,tipo): várias proveniências viram peso
  const mapa = new Map<string, ArestaGrafo>();
  for (const a of arestas) {
    const k = `${a.origem_id}|${a.destino_id}|${a.tipo}`;
    const e = mapa.get(k);
    if (e) e.peso += a.peso;
    else mapa.set(k, paraAresta(a));
  }
  return { nos: outNos, arestas: [...mapa.values()], truncado };
}

export interface DetalheNo {
  no: NoGrafo;
  vizinhos: NoGrafo[];
  fontes: FonteResultado[];
  aprendizados: Array<{ id: string; titulo: string; tipo: string; estado: string }>;
}

export function detalheNo(repos: Repos, no_id: string): DetalheNo | null {
  const n = repos.grafo.no(no_id);
  if (!n) return null;
  const ars = repos.grafo.arestasDe([no_id]);
  const vizIds = [...new Set(ars.flatMap((a) => [a.origem_id, a.destino_id]).filter((i) => i !== no_id))].slice(0, 100);
  const vizinhos = vizIds.map((i) => repos.grafo.no(i)).filter((v): v is NoLinha => v !== undefined).map(paraNo);
  const docIds = [...new Set(ars.map((a) => a.documento_id).filter((d) => d !== ""))].slice(0, 50);
  const fontes: FonteResultado[] = [];
  const aprendizados: DetalheNo["aprendizados"] = [];
  for (const id of docIds) {
    const d = repos.documento.porId(id);
    if (!d) continue;
    fontes.push({ documento_id: d.id, tipo: d.tipo as TipoDocumento, titulo: d.titulo, origem: d.origem, mission_id: d.mission_id, task_ref: d.task_ref, pane_id: d.pane_id, ocorrido_em: d.ocorrido_em });
    const ap = repos.banco.consultarUm<{ id: string; titulo: string; tipo: string; estado: string }>("SELECT id, titulo, tipo, estado FROM rag_aprendizado WHERE documento_id = ?", [id]);
    if (ap) aprendizados.push(ap);
  }
  return { no: paraNo(n), vizinhos, fontes, aprendizados };
}

/** Documentos ligados (1 salto) aos arquivos/documentos-semente, ordenados por peso de aresta; base do braço "grafo". */
export function documentosVizinhos(repos: Repos, colecao_id: string, semente: { arquivos?: readonly string[]; documentos?: readonly string[] }, limite = 20): string[] {
  const nosSemente = new Set<string>();
  for (const a of semente.arquivos ?? []) {
    const n = repos.grafo.nosPorChave(colecao_id, "arquivo", a);
    if (n) nosSemente.add(n.id);
  }
  const docsSemente = new Set(semente.documentos ?? []);
  for (const d of docsSemente) for (const a of repos.banco.consultar<{ o: string; d: string }>("SELECT origem_id AS o, destino_id AS d FROM rag_aresta WHERE documento_id = ?", [d])) (nosSemente.add(a.o), nosSemente.add(a.d));
  if (nosSemente.size === 0) return [];
  const pontos = new Map<string, number>();
  for (const a of repos.grafo.arestasDe([...nosSemente].slice(0, 200))) {
    if (a.documento_id === "" || docsSemente.has(a.documento_id)) continue;
    pontos.set(a.documento_id, (pontos.get(a.documento_id) ?? 0) + a.peso);
  }
  return [...pontos.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limite).map(([id]) => id);
}

/** Peso do nó = 1 + log2(1 + grau). Chamado na consolidação. */
export function recalcularPesos(repos: Repos, colecao_id: string): number {
  const graus = repos.banco.consultar<{ id: string; g: number }>(
    `SELECT n.id AS id, (SELECT count(*) FROM rag_aresta a WHERE a.origem_id = n.id OR a.destino_id = n.id) AS g FROM rag_no n WHERE n.colecao_id = ?`,
    [colecao_id],
  );
  repos.banco.transacao((tx) => {
    const st = tx.preparar("UPDATE rag_no SET peso = ? WHERE id = ?");
    for (const l of graus) st.executar([Math.round((1 + Math.log2(1 + Number(l.g))) * 1000) / 1000, l.id]);
  });
  return graus.length;
}
