// Adaptador Qdrant (REST puro; G §1.1): coleção por `PUT /collections/{c}`, upsert `PUT points?wait=true`, busca `points/search`,
// `points/count` exato, `points/scroll` com cursor, `points/delete` por filtro, `retrieve` por ids (UUID). Filtro compilado para o JSON
// `must/should/must_not` do Qdrant (valores sempre dentro de JSON: sem concatenação de texto). Credencial só no cabeçalho `api-key`.
import { ColecaoDivergenteErro, CursorInvalidoErro, FiltroInvalidoErro, type Capacidades, type Filtro, type MetricaDistancia, type PaginaExportada, type RegistroConhecimento, type ResultadoBuscaArmazenamento } from "../../armazenamento/interface";
import { ArmazenamentoHttp, enc, escoreBruto, fatiar, limparTexto, lerConfigDeCampos, metaParaPlano, parseVetor, planoParaMeta, type ConfigRemota, type OpcoesAdaptador } from "./comum";

export const CAPACIDADES_QDRANT: Omit<Capacidades, "loteMaximo"> & { loteMaximo: number } = {
  hibrido: true,
  filtroNativo: true,
  exportarComCursor: true,
  apagarPorFiltro: true,
  loteMaximo: 100,
  consistenciaEventual: false,
  multiTenancy: "campo",
};

/** UUID fixo do ponto de configuração (Qdrant só aceita UUID ou inteiro como id). */
export const ID_CONFIG_QDRANT = "00000000-0000-4000-8000-00000000c0f1";
const DISTANCIA: Record<MetricaDistancia, string> = { cosseno: "Cosine", produto_interno: "Dot", euclidiana: "Euclid" };
const CAMPOS_KEYWORD = ["projeto_id", "equipe_id", "tipo", "origem", "hash_conteudo", "modelo_embedding"] as const;
const CAMPOS_INTEIRO = ["dimensao", "criado_em_ms"] as const;
const COND_CONFIG = { key: "__config__", match: { value: true } };

type Obj = Record<string, unknown>;

/** Filtro do núcleo → Qdrant. Valores só como JSON (nunca texto concatenado). */
export function traduzirFiltroQdrant(f: Filtro): Obj {
  if ("e" in f) return { must: f.e.map(traduzirFiltroQdrant) };
  if ("ou" in f) return { should: f.ou.map(traduzirFiltroQdrant) };
  if ("igual" in f) return { key: f.campo, match: { value: typeof f.igual === "string" ? limparTexto(f.igual) : f.igual } };
  if ("em" in f) return { key: f.campo, match: { any: f.em.map((x) => (typeof x === "string" ? limparTexto(x) : x)) } };
  if ("entre" in f) return { key: f.campo, range: { gte: f.entre[0], lte: f.entre[1] } };
  throw new FiltroInvalidoErro("filtro inválido");
}

/** raiz: sempre exclui o ponto de configuração. */
export function filtroRaizQdrant(f: Filtro | undefined, extra: Obj[] = []): Obj {
  const must = [...extra, ...(f === undefined ? [] : [traduzirFiltroQdrant(f)])];
  return { ...(must.length > 0 ? { must } : {}), must_not: [COND_CONFIG] };
}

export class ArmazenamentoQdrant extends ArmazenamentoHttp {
  protected readonly caps = CAPACIDADES_QDRANT;
  constructor(o: OpcoesAdaptador) {
    super(o, "qdrant");
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(o.colecao)) throw new Error("nome da coleção inválido");
  }
  private c(sufixo = ""): string {
    return `/collections/${enc(this.o.colecao)}${sufixo}`;
  }
  protected cabecalhosAuth(): Record<string, string> {
    const k = this.o.segredos.api_key;
    return typeof k === "string" && k !== "" ? { "api-key": k } : {};
  }

  protected async sondar(): Promise<{ versao?: string }> {
    await this.chamar("GET", "/collections"); // leitura: valida URL e chave
    const v = await this.chamar("GET", "/", { aceitar: [401, 403, 404] }).catch(() => null);
    const versao = (v?.json as Obj | null)?.version;
    return typeof versao === "string" ? { versao } : {};
  }

  protected async preparar(p: ConfigRemota): Promise<{ vazia: boolean }> {
    const info = await this.chamar("GET", this.c(), { aceitar: [404] });
    if (info.status === 404) {
      await this.chamar("PUT", this.c("?wait=true"), { corpo: { vectors: { size: p.dimensao, distance: DISTANCIA[p.metrica] }, on_disk_payload: true } });
      for (const f of CAMPOS_KEYWORD) await this.chamar("PUT", this.c("/index?wait=true"), { corpo: { field_name: f, field_schema: "keyword" } });
      for (const f of CAMPOS_INTEIRO) await this.chamar("PUT", this.c("/index?wait=true"), { corpo: { field_name: f, field_schema: "integer" } });
      await this.chamar("PUT", this.c("/index?wait=true"), { corpo: { field_name: "texto", field_schema: { type: "text", tokenizer: "word", min_token_len: 2, lowercase: true } } });
      return { vazia: true };
    }
    const r = (info.json as { result?: { points_count?: number; config?: { params?: { vectors?: { size?: number; distance?: string } } } } } | null)?.result;
    const v = r?.config?.params?.vectors;
    const dif: string[] = [];
    if (typeof v?.size === "number" && v.size !== p.dimensao) dif.push(`dimensão da coleção ${v.size} ≠ ${p.dimensao}`);
    if (typeof v?.distance === "string" && v.distance.toLowerCase() !== DISTANCIA[p.metrica].toLowerCase()) dif.push(`distância da coleção ${v.distance} ≠ ${DISTANCIA[p.metrica]}`);
    if (dif.length > 0) throw new ColecaoDivergenteErro(dif);
    return { vazia: (r?.points_count ?? 0) === 0 };
  }

  async lerConfigRemota(): Promise<ConfigRemota | null> {
    const r = await this.chamar("POST", this.c("/points"), { corpo: { ids: [ID_CONFIG_QDRANT], with_payload: true, with_vector: false }, aceitar: [404] });
    if (r.status === 404) return null;
    const pt = ((r.json as { result?: Array<{ payload?: Obj }> } | null)?.result ?? [])[0];
    return pt?.payload ? lerConfigDeCampos(pt.payload) : null;
  }

  protected async gravarConfig(c: ConfigRemota): Promise<void> {
    const vetor = [1, ...Array.from({ length: c.dimensao - 1 }, () => 0)];
    await this.chamar("PUT", this.c("/points?wait=true"), { corpo: { points: [{ id: ID_CONFIG_QDRANT, vector: vetor, payload: { __config__: true, cfg_modelo: c.modeloEmbedding, cfg_dimensao: c.dimensao, cfg_metrica: c.metrica } }] } });
  }

  protected async gravar(regs: RegistroConhecimento[]): Promise<void> {
    await this.chamar("PUT", this.c("/points?wait=true"), { corpo: { points: regs.map((r) => ({ id: r.id, vector: r.vetor, payload: { ...metaParaPlano(r.meta), texto: r.texto } })) } });
  }

  private paraResultado(pt: { id: unknown; score?: number; payload?: Obj }, escore: number): ResultadoBuscaArmazenamento {
    const p = pt.payload ?? {};
    return { id: String(pt.id), escore, texto: typeof p.texto === "string" ? p.texto : "", meta: planoParaMeta(p) };
  }

  protected async buscarVetor(vetor: number[], filtro: Filtro | undefined, k: number, c: ConfigRemota): Promise<ResultadoBuscaArmazenamento[]> {
    const r = await this.chamar("POST", this.c("/points/search"), { corpo: { vector: vetor, limit: k, with_payload: true, filter: filtroRaizQdrant(filtro) } });
    const pts = ((r.json as { result?: Array<{ id: unknown; score: number; payload?: Obj }> } | null)?.result ?? []).filter((p) => String(p.id) !== ID_CONFIG_QDRANT);
    return pts.map((p) => this.paraResultado(p, escoreBruto(c.metrica, c.metrica === "cosseno" ? { cosseno: p.score } : c.metrica === "produto_interno" ? { produto: p.score } : { distancia: p.score })));
  }

  protected override async buscarTexto(termos: string[], filtro: Filtro | undefined, k: number): Promise<ResultadoBuscaArmazenamento[]> {
    const should = termos.map((t) => ({ key: "texto", match: { text: t } }));
    const r = await this.chamar("POST", this.c("/points/scroll"), { corpo: { filter: filtroRaizQdrant(filtro, [{ should }]), limit: k, with_payload: true, with_vector: false } });
    const pts = (r.json as { result?: { points?: Array<{ id: unknown; payload?: Obj }> } } | null)?.result?.points ?? [];
    return pts.map((p) => this.paraResultado(p, 0));
  }

  protected async contarRemoto(filtro: Filtro | undefined): Promise<number> {
    const r = await this.chamar("POST", this.c("/points/count"), { corpo: { filter: filtroRaizQdrant(filtro), exact: true }, aceitar: [404] });
    if (r.status === 404) return 0;
    return Number((r.json as { result?: { count?: number } } | null)?.result?.count ?? 0);
  }

  private paraRegistro(pt: { id: unknown; payload?: Obj; vector?: unknown }): RegistroConhecimento {
    const p = pt.payload ?? {};
    return { id: String(pt.id), vetor: parseVetor(pt.vector), texto: typeof p.texto === "string" ? p.texto : "", meta: planoParaMeta(p) };
  }

  protected async paginaRemota(cursor: string | null, tamanho: number, filtro: Filtro | undefined): Promise<PaginaExportada> {
    let offset: string | undefined;
    if (cursor !== null) {
      if (!/^q:[0-9a-fA-F-]{36}$/.test(cursor)) throw new CursorInvalidoErro();
      offset = cursor.slice(2);
    }
    const r = await this.chamar("POST", this.c("/points/scroll"), { corpo: { filter: filtroRaizQdrant(filtro), limit: tamanho, ...(offset === undefined ? {} : { offset }), with_payload: true, with_vector: true } });
    const res = (r.json as { result?: { points?: Array<{ id: unknown; payload?: Obj; vector?: unknown }>; next_page_offset?: unknown } } | null)?.result;
    const prox = res?.next_page_offset;
    return { itens: (res?.points ?? []).filter((p) => String(p.id) !== ID_CONFIG_QDRANT).map((p) => this.paraRegistro(p)), proximoCursor: typeof prox === "string" && prox !== "" ? `q:${prox}` : null };
  }

  protected async porIds(ids: string[]): Promise<RegistroConhecimento[]> {
    const saida: RegistroConhecimento[] = [];
    for (const lote of fatiar(ids, 100)) {
      const r = await this.chamar("POST", this.c("/points"), { corpo: { ids: lote, with_payload: true, with_vector: true }, aceitar: [404] });
      for (const p of (r.json as { result?: Array<{ id: unknown; payload?: Obj; vector?: unknown }> } | null)?.result ?? []) if (String(p.id) !== ID_CONFIG_QDRANT) saida.push(this.paraRegistro(p));
    }
    return saida;
  }

  protected async removerRemoto(filtro: Filtro): Promise<number> {
    const n = await this.contarRemoto(filtro);
    if (n > 0) await this.chamar("POST", this.c("/points/delete?wait=true"), { corpo: { filter: filtroRaizQdrant(filtro) } });
    return n;
  }
}

