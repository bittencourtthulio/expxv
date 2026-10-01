import type { GrafoPlano } from "./tipos";

export interface NoGrafo {
  id: string;
  depende_de: string[];
  fase: string | null;
  status: string | null;
}

/**
 * Grafo do plano derivado de `depende_de` (F-… §2.1: não é arquivo de dados). Calcula ciclos
 * (componentes fortemente conexos), dependências inexistentes e o caminho crítico (cadeia mais
 * longa em número de nós, desempate por id). Nós em ciclo ficam fora do caminho crítico.
 */
export function montarGrafo(entrada: NoGrafo[]): GrafoPlano {
  const porId = new Map<string, NoGrafo>();
  for (const n of entrada) if (!porId.has(n.id)) porId.set(n.id, { ...n, depende_de: Array.isArray(n.depende_de) ? n.depende_de.filter((d) => typeof d === "string") : [] });
  const ids = [...porId.keys()].sort();

  const arestas: { de: string; para: string }[] = [];
  const inexistentes: { de: string; ate: string }[] = [];
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of ids) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const id of ids) {
    const n = porId.get(id);
    if (!n) continue;
    for (const dep of [...new Set(n.depende_de)].sort()) {
      if (!porId.has(dep)) {
        inexistentes.push({ de: id, ate: dep });
        continue;
      }
      arestas.push({ de: dep, para: id });
      preds.get(id)?.push(dep);
      succs.get(dep)?.push(id);
    }
  }
  arestas.sort((a, b) => (a.de === b.de ? a.para.localeCompare(b.para) : a.de.localeCompare(b.de)));

  const ciclos = componentesEmCiclo(ids, succs);
  const noCiclo = new Set(ciclos.flat());

  // Programação dinâmica em ordem topológica (Kahn) sobre o que está fora de ciclo e não depende dele.
  const grau = new Map<string, number>();
  for (const id of ids) grau.set(id, (preds.get(id) ?? []).length);
  const fila = ids.filter((id) => grau.get(id) === 0 && !noCiclo.has(id));
  const comprimento = new Map<string, number>();
  const anterior = new Map<string, string | null>();
  for (const id of fila) {
    comprimento.set(id, 1);
    anterior.set(id, null);
  }
  const visitados = new Set<string>();
  for (let i = 0; i < fila.length; i++) {
    const id = fila[i] as string;
    visitados.add(id);
    for (const s of (succs.get(id) ?? []).slice().sort()) {
      if (noCiclo.has(s)) continue;
      const candidato = (comprimento.get(id) ?? 1) + 1;
      const atual = comprimento.get(s);
      // em empate fica o predecessor de menor id (a lista é percorrida em ordem de id de origem)
      if (atual === undefined || candidato > atual) {
        comprimento.set(s, candidato);
        anterior.set(s, id);
      }
      const g = (grau.get(s) ?? 0) - 1;
      grau.set(s, g);
      if (g === 0) fila.push(s);
    }
  }

  let fim: string | null = null;
  for (const id of ids) {
    if (!visitados.has(id)) continue;
    const c = comprimento.get(id) ?? 0;
    if (fim === null || c > (comprimento.get(fim) ?? 0)) fim = id;
  }
  const caminho: string[] = [];
  for (let cursor = fim; cursor !== null && cursor !== undefined; cursor = anterior.get(cursor) ?? null) caminho.push(cursor);
  caminho.reverse();

  const prontas = ids.filter((id) => {
    const n = porId.get(id);
    if (!n || n.status !== "pendente") return false;
    return (preds.get(id) ?? []).every((p) => porId.get(p)?.status === "concluida") && inexistentes.every((x) => x.de !== id);
  });

  return {
    nos: ids.map((id) => {
      const n = porId.get(id) as NoGrafo;
      return { id, depende_de: n.depende_de, fase: n.fase, status: n.status };
    }),
    arestas,
    ciclos,
    dependencias_inexistentes: inexistentes,
    caminho_critico: caminho,
    prontas,
  };
}

/** Tarjan iterativo: devolve só componentes com ciclo (tamanho > 1 ou auto-aresta). */
function componentesEmCiclo(ids: string[], succs: Map<string, string[]>): string[][] {
  let contador = 0;
  const indice = new Map<string, number>();
  const baixo = new Map<string, number>();
  const naPilha = new Set<string>();
  const pilha: string[] = [];
  const saida: string[][] = [];

  for (const raiz of ids) {
    if (indice.has(raiz)) continue;
    const trabalho: { id: string; i: number }[] = [{ id: raiz, i: 0 }];
    indice.set(raiz, contador);
    baixo.set(raiz, contador);
    contador++;
    pilha.push(raiz);
    naPilha.add(raiz);
    while (trabalho.length > 0) {
      const topo = trabalho[trabalho.length - 1] as { id: string; i: number };
      const vizinhos = succs.get(topo.id) ?? [];
      if (topo.i < vizinhos.length) {
        const w = vizinhos[topo.i++] as string;
        if (!indice.has(w)) {
          indice.set(w, contador);
          baixo.set(w, contador);
          contador++;
          pilha.push(w);
          naPilha.add(w);
          trabalho.push({ id: w, i: 0 });
        } else if (naPilha.has(w)) {
          baixo.set(topo.id, Math.min(baixo.get(topo.id) ?? 0, indice.get(w) ?? 0));
        }
      } else {
        if (baixo.get(topo.id) === indice.get(topo.id)) {
          const comp: string[] = [];
          let w: string | undefined;
          do {
            w = pilha.pop();
            if (w === undefined) break;
            naPilha.delete(w);
            comp.push(w);
          } while (w !== topo.id);
          const autoAresta = comp.length === 1 && (succs.get(comp[0] as string) ?? []).includes(comp[0] as string);
          if (comp.length > 1 || autoAresta) saida.push(comp.sort());
        }
        trabalho.pop();
        const pai = trabalho[trabalho.length - 1];
        if (pai) baixo.set(pai.id, Math.min(baixo.get(pai.id) ?? 0, baixo.get(topo.id) ?? 0));
      }
    }
  }
  return saida.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}
