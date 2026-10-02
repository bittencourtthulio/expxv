// Buscador híbrido (T-15.10): lexical (FTS5/LIKE) ∥ vetorial (índice exato) → RRF → fatores. Orçamento de 150 ms: estourou, devolve
// o que já tem (`lento`); sem modelo real, usa o piso `hash-256-v1` (`degradado`). Nunca lança e nunca vai à rede.
import { MODELO_HASH_ID, PESO_VETORIAL_HASH, PESO_VETORIAL_REAL, TIMEOUT_CONSULTA_MS } from "../constantes";
import type { EstadoConsulta, ModoBusca } from "../../../compartilhado/conhecimento";
import type { RegistroEmbeddings } from "../embeddings/registro";
import type { GerenciadorIndices } from "../indice/gerenciador";
import type { ChunkCompleto, Repos } from "../repos";
import type { FiltroBusca } from "../tipos";
import { meiaVidaDe } from "./fatores";
import { fundir, type ListaBraco, type MetaFusao } from "./fusao";
import { documentosVizinhos } from "../grafo/consultas";
import { buscarLexical, chunksPermitidos } from "./lexical";

export interface HitBusca {
  chunk: ChunkCompleto;
  escore: number;
  braco: "lexical" | "vetorial" | "grafo" | "ambos";
}

export interface PedidoBusca {
  colecao_id: string;
  consulta: string;
  modo?: ModoBusca;
  filtro?: FiltroBusca;
  k?: number;
  mission_id?: string | null;
  /** arquivos (relativos) da tarefa: sementes do braço de grafo. */
  arquivos?: readonly string[];
  /** desliga o braço de grafo (padrão ligado no modo híbrido). */
  semGrafo?: boolean;
  /** orçamento total em ms (padrão 150). */
  prazoMs?: number;
  sinal?: AbortSignal;
}

export interface ResultadoBuscador {
  hits: HitBusca[];
  estado: EstadoConsulta;
  modelo: string;
  aviso: string | null;
  vetor_ms: number;
  latencia_ms: number;
}

export interface DepsBuscador {
  repos: Repos;
  registro: RegistroEmbeddings;
  indices: GerenciadorIndices;
  agora?: () => number;
  relogio?: () => number;
}

export class Buscador {
  constructor(private readonly d: DepsBuscador) {}

  async buscar(p: PedidoBusca): Promise<ResultadoBuscador> {
    const agora = this.d.agora ?? (() => performance.now());
    const inicio = agora();
    const prazo = p.prazoMs ?? TIMEOUT_CONSULTA_MS;
    const restante = (): number => prazo - (agora() - inicio);
    const k = Math.min(Math.max(p.k ?? 8, 1), 50);
    const modo = p.modo ?? "hibrido";
    const filtro = p.filtro ?? {};
    const col = this.d.repos.colecao.obter(p.colecao_id);
    if (!col) return { hits: [], estado: "indisponivel", modelo: "", aviso: "coleção inexistente", vetor_ms: 0, latencia_ms: 0 };

    const listas: ListaBraco[] = [];
    let degradado = false;
    let lento = false;
    let aviso: string | null = null;
    let vetorMs = 0;
    let modeloUsado = col.modelo_ativo;

    if (modo !== "semantico") {
      const ids = buscarLexical(this.d.repos.banco, p.colecao_id, p.consulta, filtro, 100);
      listas.push({ braco: "lexical", ids, peso: 1 });
    }
    if (modo !== "lexical") {
      if (restante() <= 0) lento = true;
      else {
        try {
          const esc = await this.d.registro.escolher(col.modelo_ativo);
          if (esc.degradado) {
            degradado = true;
            aviso = `modelo ${col.modelo_ativo} indisponível; usando ${MODELO_HASH_ID}`;
          }
          modeloUsado = esc.provedor.id;
          const dim = esc.provedor.dimensao;
          const t0 = agora();
          const vetores = await corrida(esc.provedor.embutir([p.consulta], p.sinal), Math.max(1, restante()));
          if (vetores === "estourou") lento = true;
          else {
            const q = vetores[0] as Float32Array;
            let { indice, completo } = this.d.indices.indice(p.colecao_id, modeloUsado, dim);
            if (!completo) {
              completo = this.d.indices.aquecer(p.colecao_id, modeloUsado, dim, Math.max(1, restante() / 2), agora);
              if (!completo) degradado = true;
            }
            const permitidos = chunksPermitidos(this.d.repos.banco, p.colecao_id, filtro);
            const achados = indice.buscar(q, 100, permitidos).filter((r) => r.escore > 0.05);
            listas.push({ braco: "vetorial", ids: achados.map((r) => r.id), peso: esc.provedor.qualidade > 0 ? esc.provedor.qualidade : modeloUsado === MODELO_HASH_ID ? PESO_VETORIAL_HASH : PESO_VETORIAL_REAL });
            vetorMs = agora() - t0;
          }
        } catch {
          degradado = true;
          aviso = aviso ?? "busca vetorial indisponível; usando só o lexical";
        }
      }
    }

    const candidatos = new Set<string>();
    for (const l of listas) for (const id of l.ids) candidatos.add(id);
    const completos = new Map<string, ChunkCompleto>();
    for (const c of this.d.repos.documento.chunksPorIds([...candidatos])) completos.set(c.chunk_id, c);
    const meta = (id: string): MetaFusao | undefined => {
      const c = completos.get(id);
      if (!c || c.doc_estado !== "ativo") return undefined;
      return { documento_id: c.documento_id, tipo: c.tipo, ocorrido_em: c.ocorrido_em, mission_id: c.mission_id, feedback: c.feedback, aprendizado_estado: c.aprendizado_estado };
    };
    const relogio = (this.d.relogio ?? Date.now)();
    const opcoes = { k, agora: relogio, mission_id: p.mission_id ?? null, meta, meiaVida: (m: MetaFusao) => meiaVidaDe(m.tipo, m.aprendizado_tipo) };
    // braço de GRAFO: 1 salto a partir dos arquivos da tarefa e dos documentos dos 3 melhores achados
    if (modo === "hibrido" && p.semGrafo !== true && !lento && restante() > 5) {
      try {
        const pre = fundir(listas, opcoes).slice(0, 3);
        const docsTop = [...new Set(pre.map((f) => completos.get(f.chunk_id)?.documento_id).filter((d): d is string => d !== undefined))];
        const vizinhos = documentosVizinhos(this.d.repos, p.colecao_id, { arquivos: p.arquivos ?? [], documentos: docsTop }, 12);
        if (vizinhos.length > 0) {
          const ids = this.d.repos.documento.primeirosChunks(vizinhos);
          for (const c of this.d.repos.documento.chunksPorIds(ids.filter((i) => !completos.has(i)))) completos.set(c.chunk_id, c);
          listas.push({ braco: "grafo", ids: ids.filter((i) => completos.has(i)), peso: 0.6 });
        }
      } catch {
        /* grafo é aditivo */
      }
    }
    const fundidos = fundir(listas, opcoes);
    const hits: HitBusca[] = fundidos.map((f) => ({ chunk: completos.get(f.chunk_id) as ChunkCompleto, escore: f.escore, braco: f.braco }));
    const latencia = agora() - inicio;
    if (latencia > prazo) lento = true;
    const estado: EstadoConsulta = lento ? "lento" : degradado ? "degradado" : hits.length === 0 ? "vazio" : "ok";
    if (lento && aviso === null) aviso = "consulta acima do orçamento; resultado parcial";
    return { hits, estado, modelo: modeloUsado, aviso, vetor_ms: vetorMs, latencia_ms: latencia };
  }
}

async function corrida<T>(promessa: Promise<T>, ms: number): Promise<T | "estourou"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<"estourou">((resolve) => {
    t = setTimeout(() => resolve("estourou"), ms);
  });
  try {
    return await Promise.race([promessa, limite]);
  } finally {
    if (t) clearTimeout(t);
  }
}
