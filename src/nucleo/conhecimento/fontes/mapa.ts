// Fonte mapa (Fase 17 → grafo do conhecimento): lê SÓ pela interface `MapaLeitura` (somente leitura) e grava arestas `depende`
// (arquivo → arquivo por `importa`/`reexporta`, símbolo → símbolo por `chama`/`instancia`/`herda`). Sem acessar o armazém do mapa.
import type { MapaLeitura } from "../../mapa/contrato";
import { gravarGrafo } from "../grafo/consultas";
import type { ArestaExtraida, GrafoExtraido, NoExtraido } from "../grafo/modelo";
import type { Repos } from "../repos";

const ARESTAS_ARQUIVO = ["importa", "reexporta"] as const;
const ARESTAS_SIMBOLO = ["chama", "instancia", "herda", "implementa"] as const;

function chaveDeNo(id: string): { tipo: "arquivo" | "simbolo"; chave: string; rotulo: string } | null {
  if (id.startsWith("arq:")) return { tipo: "arquivo", chave: id.slice(4), rotulo: id.slice(4) };
  if (id.startsWith("sim:")) {
    const r = id.slice(4);
    return { tipo: "simbolo", chave: r, rotulo: r.split("#")[1] ?? r };
  }
  return null;
}

/** Sincroniza o grafo de dependências das `arquivos` (relativos) e devolve contagens. A proveniência é um documento lógico `mapa:<caminho>`. */
export function sincronizarMapa(p: { mapa: MapaLeitura; repos: Repos; colecao_id: string; arquivos: readonly string[]; quando: string; limitePorNo?: number }): { nos: number; arestas: number } {
  let nos = 0;
  let arestas = 0;
  if (p.mapa.resumo().estado === "vazio") return { nos, arestas };
  for (const rel of p.arquivos.slice(0, 5000)) {
    const id = `arq:${rel}`;
    if (!p.mapa.no(id)) continue;
    const mapaNos = new Map<string, NoExtraido>();
    const ar: ArestaExtraida[] = [];
    const base = chaveDeNo(id) as NonNullable<ReturnType<typeof chaveDeNo>>;
    mapaNos.set(`arquivo:${base.chave}`, { tipo: "arquivo", chave: base.chave, rotulo: base.rotulo });
    const limite = p.limitePorNo ?? 60;
    for (const v of p.mapa.vizinhos(id, { direcao: "saida", tipos: ARESTAS_ARQUIVO, limite })) {
      const alvo = chaveDeNo(v.no.id);
      if (!alvo || alvo.tipo !== "arquivo") continue;
      mapaNos.set(`arquivo:${alvo.chave}`, { tipo: "arquivo", chave: alvo.chave, rotulo: alvo.rotulo });
      ar.push({ de: { tipo: "arquivo", chave: base.chave }, para: { tipo: "arquivo", chave: alvo.chave }, tipo: "depende", peso: v.aresta.confianca === "exata" ? 1 : 0.5 });
    }
    // símbolos do arquivo e suas chamadas
    for (const s of p.mapa.buscar(rel, { tipos: ["simbolo"], limite: 40 })) {
      const sb = chaveDeNo(s.id);
      if (!sb || !sb.chave.startsWith(`${rel}#`)) continue;
      mapaNos.set(`simbolo:${sb.chave}`, { tipo: "simbolo", chave: sb.chave, rotulo: sb.rotulo });
      ar.push({ de: { tipo: "simbolo", chave: sb.chave }, para: { tipo: "arquivo", chave: base.chave }, tipo: "pertence" });
      for (const v of p.mapa.vizinhos(s.id, { direcao: "saida", tipos: ARESTAS_SIMBOLO, limite: 20 })) {
        const alvo = chaveDeNo(v.no.id);
        if (!alvo || alvo.tipo !== "simbolo") continue;
        mapaNos.set(`simbolo:${alvo.chave}`, { tipo: "simbolo", chave: alvo.chave, rotulo: alvo.rotulo });
        ar.push({ de: { tipo: "simbolo", chave: sb.chave }, para: { tipo: "simbolo", chave: alvo.chave }, tipo: "depende", peso: v.aresta.confianca === "exata" ? 1 : 0.5 });
      }
    }
    const g: GrafoExtraido = { nos: [...mapaNos.values()], arestas: ar };
    const docId = `mapa:${rel}`; // proveniência lógica (sem documento de texto)
    const r = gravarGrafoLogico(p.repos, p.colecao_id, docId, g, p.quando);
    nos += r.nos;
    arestas += r.arestas;
  }
  return { nos, arestas };
}

/** O grafo do mapa não tem documento de texto: a proveniência é um registro sentinela por arquivo (re-sincronizar substitui). */
function gravarGrafoLogico(repos: Repos, colecao_id: string, docId: string, g: GrafoExtraido, quando: string): { nos: number; arestas: number } {
  repos.banco.executar("DELETE FROM rag_aresta WHERE documento_id = ?", [docId]);
  return gravarGrafo(repos, colecao_id, docId, g, quando);
}
