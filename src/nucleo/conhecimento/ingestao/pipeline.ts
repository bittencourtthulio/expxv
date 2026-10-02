// Pipeline de ingestão (T-15.13): documento bruto → caminho relativo → REDIGIR → chunkar → ids determinísticos → dedupe/tombstone →
// gravar chunk + FTS (gatilho) + vetor do modelo ativo + nós/arestas → aprendizados. Tudo passa por `redigir` ANTES de chunk, FTS,
// vetor, grafo ou evento. Reprocessar o mesmo conteúdo é no-op (hash igual); conteúdo novo substitui a versão antiga atomicamente.
import { chunksDeCodigo } from "../chunking/codigo";
import { chunksDeCommit } from "../chunking/commit";
import { chunksDeMarkdown, redigir, type ChunkPronto } from "../chunking/comum";
import { chunksDeEvento } from "../chunking/evento";
import { chunksDeTroca } from "../chunking/transcricao";
import { ARQUIVO_CODIGO_MAX_BYTES } from "../constantes";
import type { RegistroEmbeddings } from "../embeddings/registro";
import { extrair } from "../grafo/extrator";
import { gravarGrafo } from "../grafo/consultas";
import type { GerenciadorIndices } from "../indice/gerenciador";
import { idChunk, idDocumento, sha256 } from "../ids";
import type { MetaDocumento, Repos } from "../repos";
import { caminhoProibido, relativizarTexto } from "../seguranca";
import { extrairAprendizados } from "../aprendizado/extrair";
import { registrarAprendizado } from "../aprendizado/dedupe";
import { mapearEntrada } from "../fontes/dominio";
import type { DocumentoEntrada, EntradaConhecimento } from "../tipos";

export type EstadoIngestao = "novo" | "substituido" | "inalterado" | "recusado" | "vazio" | "proibido" | "grande_demais";

export interface ResultadoIngestao {
  estado: EstadoIngestao;
  documento_id: string | null;
  chunks: number;
  aprendizados: number;
}

export interface DepsPipeline {
  repos: Repos;
  registro: RegistroEmbeddings;
  indices: GerenciadorIndices;
  /** raiz do workspace (só para relativizar texto; nunca sai do módulo). */
  raiz: string;
  scrubber?: { scrub(t: string): string };
  /** `git ls-files` conhecido: resolve caminhos citados e imports. */
  arquivosConhecidos?: () => ReadonlySet<string> | null;
  /** extração de aprendizado ligada? (padrão sim). */
  aprendizado?: boolean;
  /** chunks NOVOS gravados (replicação online: o anfitrião enfileira em `rag_saida` quando o modo não é `local`). Nunca lança para fora. */
  aoGravar?: (colecao_id: string, chunkIds: readonly string[]) => void;
}

export class PipelineIngestao {
  constructor(private readonly d: DepsPipeline) {}

  private chunksDe(doc: DocumentoEntrada, op: { scrubber?: { scrub(t: string): string } }): ChunkPronto[] {
    switch (doc.formato) {
      case "codigo":
        return chunksDeCodigo({ arquivo: doc.origem, texto: doc.texto, ...(doc.linguagem ? { linguagem: doc.linguagem } : {}) }, op);
      case "transcricao":
        return doc.troca ? chunksDeTroca(doc.troca, op) : chunksDeMarkdown(doc.origem, doc.texto, op).chunks;
      case "commit":
        return doc.commit ? chunksDeCommit(doc.commit, op) : chunksDeMarkdown(doc.origem, doc.texto, op).chunks;
      case "evento":
        return chunksDeEvento({ titulo: doc.titulo, texto: doc.texto, tags: [] }, op);
      default:
        return chunksDeMarkdown(doc.origem, doc.texto, op).chunks;
    }
  }

  /** Ingere UM documento na coleção. Nunca lança por conteúdo ruim: devolve o estado. */
  async ingerir(colecao_id: string, bruto: DocumentoEntrada): Promise<ResultadoIngestao> {
    const { repos } = this.d;
    const col = repos.colecao.obter(colecao_id);
    if (!col) return { estado: "recusado", documento_id: null, chunks: 0, aprendizados: 0 };
    const eArquivo = bruto.tipo !== "commit" && !/^[a-z_]+:/.test(bruto.origem);
    if (eArquivo && caminhoProibido(bruto.origem)) return { estado: "proibido", documento_id: null, chunks: 0, aprendizados: 0 };
    if (bruto.formato === "codigo" && Buffer.byteLength(bruto.texto, "utf8") > ARQUIVO_CODIGO_MAX_BYTES) return { estado: "grande_demais", documento_id: null, chunks: 0, aprendizados: 0 };
    const op = this.d.scrubber ? { scrubber: this.d.scrubber } : {};
    // relativiza e redige o que o chunker vai ver (o chunker redige de novo: idempotente)
    const doc: DocumentoEntrada = {
      ...bruto,
      titulo: redigir(relativizarTexto(bruto.titulo, this.d.raiz), op).replace(/\s+/g, " ").trim().slice(0, 200) || bruto.origem,
      texto: relativizarTexto(bruto.texto, this.d.raiz),
      ...(bruto.troca ? { troca: { ...bruto.troca, usuario: relativizarTexto(bruto.troca.usuario, this.d.raiz), resposta: relativizarTexto(bruto.troca.resposta, this.d.raiz) } } : {}),
      ...(bruto.commit ? { commit: { ...bruto.commit, mensagem: relativizarTexto(bruto.commit.mensagem, this.d.raiz) } } : {}),
    };
    const chunks = this.chunksDe(doc, op);
    if (chunks.length === 0) return { estado: "vazio", documento_id: null, chunks: 0, aprendizados: 0 };
    const escopo = col.projeto_id ?? col.workspace_id ?? col.id;
    const documento_id = idDocumento({ escopo, tipo: doc.tipo, origem: doc.origem });
    const hash_conteudo = sha256(chunks.map((c) => c.hash).join("\n"));
    const meta: MetaDocumento = {
      id: documento_id,
      colecao_id,
      tipo: doc.tipo,
      origem: doc.origem,
      titulo: doc.titulo,
      hash_conteudo,
      fonte: doc.fonte,
      mission_id: doc.mission_id ?? null,
      task_ref: doc.task_ref ?? null,
      pane_id: doc.pane_id ?? null,
      cli: doc.cli ?? null,
      modelo_autor: doc.modelo_autor ?? null,
      autor: doc.autor ?? null,
      importancia: doc.importancia ?? 3,
      expira_em: doc.expira_em ?? null,
      ocorrido_em: doc.ocorrido_em,
    };
    const gravaveis = chunks.map((c, i) => ({ id: idChunk({ escopo, tipo: doc.tipo, origem: doc.origem, indice: i, texto: c.texto }), ordem: c.ordem, texto: c.texto, titulos: c.titulos, termos: c.termos, hash: c.hash }));
    // vetor do modelo ativo; se o modelo real estiver fora, fica sem vetor (o lexical acha; reembutir completa depois)
    const esc = await this.d.registro.escolher(col.modelo_ativo);
    let vetores: Array<{ chunk_id: string; modelo: string; vetor: Float32Array }> = [];
    if (!esc.degradado) {
      try {
        const vs = await esc.provedor.embutir(gravaveis.map((c) => c.texto));
        if (vs.length === gravaveis.length) vetores = gravaveis.map((c, i) => ({ chunk_id: c.id, modelo: esc.provedor.id, vetor: vs[i] as Float32Array }));
      } catch {
        vetores = [];
      }
    }
    const r = repos.documento.gravar(meta, gravaveis, vetores);
    if (r.resultado === "recusado") return { estado: "recusado", documento_id, chunks: 0, aprendizados: 0 };
    if (r.resultado === "inalterado") return { estado: "inalterado", documento_id, chunks: gravaveis.length, aprendizados: 0 };
    this.d.indices.remover(colecao_id, r.removidos);
    for (const v of vetores) this.d.indices.upsert(colecao_id, v.modelo, v.chunk_id, v.vetor);
    try {
      if (r.adicionados.length > 0) this.d.aoGravar?.(colecao_id, r.adicionados);
    } catch {
      /* a replicação nunca derruba a ingestão */
    }

    const quando = repos.relogio();
    try {
      gravarGrafo(repos, colecao_id, documento_id, extrair({ ...doc, texto: chunks.map((c) => c.texto).join("\n") }, { arquivos: this.d.arquivosConhecidos?.() ?? null }), quando);
    } catch {
      /* grafo é aditivo: falha isolada não derruba a ingestão */
    }
    let n = 0;
    if (this.d.aprendizado !== false && doc.tipo !== "aprendizado") n = await this.aprender(colecao_id, doc, quando, undefined);
    return { estado: r.resultado, documento_id, chunks: gravaveis.length, aprendizados: n };
  }

  /** Extrai e registra aprendizados do documento (e indexa cada novo como chunk próprio). */
  async aprender(colecao_id: string, doc: DocumentoEntrada, quando: string, memoria?: "decision" | "learning"): Promise<number> {
    const { repos } = this.d;
    let novos = 0;
    for (const c of extrairAprendizados({ ...doc, texto: redigir(doc.texto, this.d.scrubber ? { scrubber: this.d.scrubber } : {}) }, memoria ? { memoria } : {})) {
      const r = registrarAprendizado(repos, colecao_id, c, { quando, origemTipo: doc.tipo, ...(this.d.scrubber ? { scrubber: this.d.scrubber } : {}) });
      if (r.novo && r.documento) {
        const ing = await this.ingerir(colecao_id, r.documento);
        if (ing.documento_id) repos.aprendizado.atualizar(r.id, { documento_id: ing.documento_id });
        novos++;
      }
    }
    return novos;
  }

  /** Entrada interna ou evento da Fase 8 → documentos → ingestão. */
  async ingerirEntrada(colecao_id: string, en: EntradaConhecimento): Promise<ResultadoIngestao[]> {
    const m = mapearEntrada(en);
    const saida: ResultadoIngestao[] = [];
    for (const d of m.docs) {
      const r = await this.ingerir(colecao_id, d);
      saida.push(r);
      if (m.memoria && r.estado !== "recusado") saida[saida.length - 1] = { ...r, aprendizados: r.aprendizados + (await this.aprender(colecao_id, d, this.d.repos.relogio(), m.memoria)) };
    }
    return saida;
  }
}

