// Adaptador Pinecone (data-plane REST por host do índice; G §1.2): upsert por namespace, `query` com filtro de metadados, `list`
// paginado + `fetch`, `delete` por ids, `describe_index_stats`. O campo URL do formulário É o host do índice. Namespace = coleção remota.
// Contagem filtrada, exportação filtrada e `apagar` por filtro varrem `list`+`fetch` no cliente (serverless não tem contagem/exclusão
// por filtro em todos os planos): correto, porém mais lento. Credencial só no cabeçalho `Api-Key`.
import { avaliarFiltro } from "../../armazenamento/filtro";
import { ColecaoDivergenteErro, CursorInvalidoErro, FiltroInvalidoErro, type Capacidades, type Filtro, type MetricaDistancia, type PaginaExportada, type RegistroConhecimento, type ResultadoBuscaArmazenamento } from "../../armazenamento/interface";
import { ArmazenamentoHttp, enc, escoreBruto, fatiar, ID_CONFIG, lerConfigDeCampos, limparTexto, metaParaPlano, parseVetor, planoParaMeta, segredoObrigatorio, type ConfigRemota, type OpcoesAdaptador } from "./comum";

export const CAPACIDADES_PINECONE: Omit<Capacidades, "loteMaximo"> & { loteMaximo: number } = {
  hibrido: false,
  filtroNativo: true,
  exportarComCursor: true,
  apagarPorFiltro: true,
  loteMaximo: 50,
  consistenciaEventual: true,
  multiTenancy: "namespace",
};

export const VERSAO_API_PINECONE = "2025-04";
const METRICA_PINECONE: Record<MetricaDistancia, string> = { cosseno: "cosine", produto_interno: "dotproduct", euclidiana: "euclidean" };
type Obj = Record<string, unknown>;
interface VetorPinecone {
  id: string;
  values?: number[];
  metadata?: Obj;
  score?: number;
}

/** Filtro do núcleo → filtro de metadados do Pinecone (JSON; sem concatenação). */
export function traduzirFiltroPinecone(f: Filtro): Obj {
  if ("e" in f) return { $and: f.e.map(traduzirFiltroPinecone) };
  if ("ou" in f) return { $or: f.ou.map(traduzirFiltroPinecone) };
  const v = (x: string | number | boolean): string | number | boolean => (typeof x === "string" ? limparTexto(x) : x);
  if ("igual" in f) return { [f.campo]: { $eq: v(f.igual) } };
  if ("em" in f) return { [f.campo]: { $in: f.em.map(v) } };
  if ("entre" in f) return { [f.campo]: { $gte: f.entre[0], $lte: f.entre[1] } };
  throw new FiltroInvalidoErro("filtro inválido");
}

export class ArmazenamentoPinecone extends ArmazenamentoHttp {
  protected readonly caps = CAPACIDADES_PINECONE;
  constructor(o: OpcoesAdaptador) {
    super(o, "pinecone");
    segredoObrigatorio(o.segredos, "api_key", "pinecone");
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(o.colecao)) throw new Error("nome do namespace inválido");
  }
  protected cabecalhosAuth(): Record<string, string> {
    return { "api-key": segredoObrigatorio(this.o.segredos, "api_key", "pinecone"), "x-pinecone-api-version": VERSAO_API_PINECONE };
  }
  private async stats(): Promise<{ dimension?: number; metric?: string; vectorCount: number }> {
    const r = await this.chamar("POST", "/describe_index_stats", { corpo: {} });
    const j = (r.json as { dimension?: number; metric?: string; namespaces?: Record<string, { vectorCount?: number }> } | null) ?? {};
    return { ...(j.dimension === undefined ? {} : { dimension: j.dimension }), ...(j.metric === undefined ? {} : { metric: j.metric }), vectorCount: Number(j.namespaces?.[this.o.colecao]?.vectorCount ?? 0) };
  }

  protected async sondar(): Promise<{ versao?: string }> {
    await this.stats();
    return { versao: `pinecone-${VERSAO_API_PINECONE}` };
  }

  protected async preparar(p: ConfigRemota): Promise<{ vazia: boolean }> {
    const s = await this.stats();
    const dif: string[] = [];
    if (s.dimension !== undefined && s.dimension !== p.dimensao) dif.push(`dimensão do índice ${s.dimension} ≠ ${p.dimensao}`);
    if (s.metric !== undefined && s.metric !== METRICA_PINECONE[p.metrica]) dif.push(`métrica do índice ${s.metric} ≠ ${METRICA_PINECONE[p.metrica]}`);
    if (dif.length > 0) throw new ColecaoDivergenteErro(dif);
    return { vazia: s.vectorCount === 0 };
  }

  async lerConfigRemota(): Promise<ConfigRemota | null> {
    const r = await this.chamar("GET", `/vectors/fetch?ids=${enc(ID_CONFIG)}&namespace=${enc(this.o.colecao)}`);
    const v = (r.json as { vectors?: Record<string, VetorPinecone> } | null)?.vectors?.[ID_CONFIG];
    return v?.metadata ? lerConfigDeCampos(v.metadata) : null;
  }

  protected async gravarConfig(c: ConfigRemota): Promise<void> {
    const values = [1, ...Array.from({ length: c.dimensao - 1 }, () => 0)]; // Pinecone recusa vetor denso todo zero
    await this.chamar("POST", "/vectors/upsert", { corpo: { namespace: this.o.colecao, vectors: [{ id: ID_CONFIG, values, metadata: { __config__: true, cfg_modelo: c.modeloEmbedding, cfg_dimensao: c.dimensao, cfg_metrica: c.metrica } }] } });
  }

  protected async gravar(regs: RegistroConhecimento[]): Promise<void> {
    await this.chamar("POST", "/vectors/upsert", { corpo: { namespace: this.o.colecao, vectors: regs.map((r) => ({ id: r.id, values: r.vetor, metadata: { ...metaParaPlano(r.meta), texto: r.texto } })) } });
  }

  private paraRegistro(v: VetorPinecone): RegistroConhecimento {
    const m = v.metadata ?? {};
    return { id: v.id, vetor: parseVetor(v.values), texto: typeof m.texto === "string" ? m.texto : "", meta: planoParaMeta(m) };
  }

  protected async buscarVetor(vetor: number[], filtro: Filtro | undefined, k: number, c: ConfigRemota): Promise<ResultadoBuscaArmazenamento[]> {
    const r = await this.chamar("POST", "/query", { corpo: { namespace: this.o.colecao, vector: vetor, topK: Math.min(k + 1, 1000), includeMetadata: true, includeValues: false, ...(filtro === undefined ? {} : { filter: traduzirFiltroPinecone(filtro) }) } });
    const l = ((r.json as { matches?: VetorPinecone[] } | null)?.matches ?? []).filter((v) => v.id !== ID_CONFIG).slice(0, k);
    return l.map((v) => {
      const s = v.score ?? 0;
      const m = v.metadata ?? {};
      return { id: v.id, escore: escoreBruto(c.metrica, c.metrica === "cosseno" ? { cosseno: s } : c.metrica === "produto_interno" ? { produto: s } : { distancia: s }), texto: typeof m.texto === "string" ? m.texto : "", meta: planoParaMeta(m) };
    });
  }

  private async buscarPorIds(ids: string[]): Promise<RegistroConhecimento[]> {
    const saida: RegistroConhecimento[] = [];
    for (const lote of fatiar(ids, 50)) {
      const q = lote.map((i) => `ids=${enc(i)}`).join("&");
      const r = await this.chamar("GET", `/vectors/fetch?${q}&namespace=${enc(this.o.colecao)}`);
      const vs = (r.json as { vectors?: Record<string, VetorPinecone> } | null)?.vectors ?? {};
      for (const i of lote) {
        const v = vs[i];
        if (v) saida.push(this.paraRegistro(v));
      }
    }
    return saida;
  }

  /** uma página de `list` (≤ 100 ids) + `fetch`. */
  private async lista(token: string | null, limite: number): Promise<{ regs: RegistroConhecimento[]; proximo: string | null }> {
    const r = await this.chamar("GET", `/vectors/list?namespace=${enc(this.o.colecao)}&limit=${Math.min(limite, 100)}${token === null ? "" : `&paginationToken=${enc(token)}`}`, { aceitar: [404] });
    const j = r.status === 404 ? null : (r.json as { vectors?: Array<{ id: string }>; pagination?: { next?: string } } | null);
    const ids = (j?.vectors ?? []).map((v) => v.id).filter((i) => i !== ID_CONFIG);
    return { regs: ids.length === 0 ? [] : await this.buscarPorIds(ids), proximo: j?.pagination?.next ?? null };
  }

  private async *varrer(filtro: Filtro | undefined): AsyncGenerator<RegistroConhecimento> {
    let tok: string | null = null;
    do {
      const p: { regs: RegistroConhecimento[]; proximo: string | null } = await this.lista(tok, 100);
      for (const r of p.regs) if (avaliarFiltro(filtro, r.meta)) yield r;
      tok = p.proximo;
    } while (tok !== null);
  }

  protected async contarRemoto(filtro: Filtro | undefined): Promise<number> {
    if (filtro === undefined) {
      const s = await this.stats();
      const c = await this.lerConfigRemota();
      return Math.max(0, s.vectorCount - (c === null ? 0 : 1));
    }
    let n = 0;
    for await (const _ of this.varrer(filtro)) n++;
    return n;
  }

  protected async paginaRemota(cursor: string | null, tamanho: number, filtro: Filtro | undefined): Promise<PaginaExportada> {
    let tok: string | null = null;
    if (cursor !== null) {
      if (!/^p:[A-Za-z0-9_=+/.-]{1,512}$/.test(cursor)) throw new CursorInvalidoErro();
      tok = cursor.slice(2);
    }
    const p = await this.lista(tok, tamanho);
    return { itens: p.regs.filter((r) => avaliarFiltro(filtro, r.meta)), proximoCursor: p.proximo === null ? null : `p:${p.proximo}` };
  }

  protected async porIds(ids: string[]): Promise<RegistroConhecimento[]> {
    return this.buscarPorIds(ids);
  }

  protected async removerRemoto(filtro: Filtro): Promise<number> {
    const alvo: string[] = [];
    for await (const r of this.varrer(filtro)) alvo.push(r.id);
    for (const lote of fatiar(alvo, 1000)) await this.chamar("POST", "/vectors/delete", { corpo: { namespace: this.o.colecao, ids: lote } });
    return alvo.length;
  }
}
