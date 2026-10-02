// Adaptador Upstash Vector (REST; G §1.8): `upsert`, `query` com filtro SQL-like, `range` (cursor), `fetch` por ids, `delete` por filtro,
// `info`. Namespace = coleção remota. Texto no campo `data`, meta nos metadados. Consistência eventual (contagem pode atrasar).
// Credencial só em `Authorization: Bearer`. Filtro: valores string entre aspas simples com `\` e `'` escapados; caractere de controle
// no valor é RECUSADO (FiltroInvalidoErro) em vez de arriscar um dialeto ambíguo.
import { avaliarFiltro } from "../../armazenamento/filtro";
import { ColecaoDivergenteErro, CursorInvalidoErro, FiltroInvalidoErro, type Capacidades, type Filtro, type MetricaDistancia, type PaginaExportada, type RegistroConhecimento, type ResultadoBuscaArmazenamento } from "../../armazenamento/interface";
import { ArmazenamentoHttp, enc, esc01, fatiar, ID_CONFIG, lerConfigDeCampos, metaParaPlano, parseVetor, planoParaMeta, segredoObrigatorio, type ConfigRemota, type OpcoesAdaptador } from "./comum";

export const CAPACIDADES_UPSTASH: Omit<Capacidades, "loteMaximo"> & { loteMaximo: number } = {
  hibrido: false,
  filtroNativo: true,
  exportarComCursor: true,
  apagarPorFiltro: true,
  dimensaoMaxima: 1536,
  loteMaximo: 100,
  consistenciaEventual: true,
  multiTenancy: "namespace",
};

const FUNCAO: Record<MetricaDistancia, string> = { cosseno: "COSINE", produto_interno: "DOT_PRODUCT", euclidiana: "EUCLIDEAN" };
type Obj = Record<string, unknown>;
interface VetorUpstash {
  id: string;
  vector?: number[];
  metadata?: Obj;
  data?: string;
  score?: number;
}

function literal(v: string | number): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new FiltroInvalidoErro("número inválido no filtro");
    return String(v);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) throw new FiltroInvalidoErro("valor com caractere de controle não é aceito neste provedor");
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Filtro do núcleo → expressão SQL-like do Upstash (campos vêm da lista fechada; valores escapados). */
export function traduzirFiltroUpstash(f: Filtro): string {
  if ("e" in f) return `(${f.e.map(traduzirFiltroUpstash).join(" AND ")})`;
  if ("ou" in f) return `(${f.ou.map(traduzirFiltroUpstash).join(" OR ")})`;
  if (!/^[a-z_]+$/.test(f.campo)) throw new FiltroInvalidoErro("campo inválido");
  if ("igual" in f) return `${f.campo} = ${typeof f.igual === "boolean" ? String(f.igual) : literal(f.igual)}`;
  if ("em" in f) return `${f.campo} IN (${f.em.map(literal).join(", ")})`;
  if ("entre" in f) return `(${f.campo} >= ${literal(f.entre[0])} AND ${f.campo} <= ${literal(f.entre[1])})`;
  throw new FiltroInvalidoErro("filtro inválido");
}

export class ArmazenamentoUpstash extends ArmazenamentoHttp {
  protected readonly caps = CAPACIDADES_UPSTASH;
  protected override readonly maxPagina = 1000;
  constructor(o: OpcoesAdaptador) {
    super(o, "upstash");
    segredoObrigatorio(o.segredos, "token", "upstash");
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(o.colecao)) throw new Error("nome do namespace inválido");
  }
  private ns(): string {
    return enc(this.o.colecao);
  }
  protected cabecalhosAuth(): Record<string, string> {
    return { authorization: `Bearer ${segredoObrigatorio(this.o.segredos, "token", "upstash")}` };
  }
  private async info(): Promise<{ dimension?: number; similarityFunction?: string; vectorCount: number; pending: number }> {
    const r = await this.chamar("GET", "/info");
    const j = (r.json as { result?: { dimension?: number; similarityFunction?: string; namespaces?: Record<string, { vectorCount?: number; pendingVectorCount?: number }> } } | null)?.result ?? {};
    const n = j.namespaces?.[this.o.colecao];
    return { ...(j.dimension === undefined ? {} : { dimension: j.dimension }), ...(j.similarityFunction === undefined ? {} : { similarityFunction: j.similarityFunction }), vectorCount: Number(n?.vectorCount ?? 0), pending: Number(n?.pendingVectorCount ?? 0) };
  }

  protected async sondar(): Promise<{ versao?: string }> {
    await this.info();
    return { versao: "upstash-vector" };
  }

  protected async preparar(p: ConfigRemota): Promise<{ vazia: boolean }> {
    const i = await this.info();
    const dif: string[] = [];
    if (i.dimension !== undefined && i.dimension !== p.dimensao) dif.push(`dimensão do índice ${i.dimension} ≠ ${p.dimensao}`);
    if (i.similarityFunction !== undefined && i.similarityFunction !== FUNCAO[p.metrica]) dif.push(`função de similaridade do índice ${i.similarityFunction} ≠ ${FUNCAO[p.metrica]}`);
    if (dif.length > 0) throw new ColecaoDivergenteErro(dif);
    return { vazia: i.vectorCount + i.pending === 0 };
  }

  async lerConfigRemota(): Promise<ConfigRemota | null> {
    const r = await this.chamar("POST", `/fetch/${this.ns()}`, { corpo: { ids: [ID_CONFIG], includeMetadata: true, includeVectors: false } });
    const v = ((r.json as { result?: Array<VetorUpstash | null> } | null)?.result ?? [])[0];
    return v?.metadata ? lerConfigDeCampos(v.metadata) : null;
  }

  protected async gravarConfig(c: ConfigRemota): Promise<void> {
    const vector = [1, ...Array.from({ length: c.dimensao - 1 }, () => 0)];
    await this.chamar("POST", `/upsert/${this.ns()}`, { corpo: [{ id: ID_CONFIG, vector, metadata: { __config__: true, cfg_modelo: c.modeloEmbedding, cfg_dimensao: c.dimensao, cfg_metrica: c.metrica } }] });
  }

  protected async gravar(regs: RegistroConhecimento[]): Promise<void> {
    await this.chamar("POST", `/upsert/${this.ns()}`, { corpo: regs.map((r) => ({ id: r.id, vector: r.vetor, metadata: metaParaPlano(r.meta), data: r.texto })) });
  }

  private paraRegistro(v: VetorUpstash): RegistroConhecimento {
    return { id: v.id, vetor: parseVetor(v.vector), texto: v.data ?? "", meta: planoParaMeta(v.metadata ?? {}) };
  }

  protected async buscarVetor(vetor: number[], filtro: Filtro | undefined, k: number): Promise<ResultadoBuscaArmazenamento[]> {
    const r = await this.chamar("POST", `/query/${this.ns()}`, {
      corpo: { vector: vetor, topK: Math.min(k + 1, 1000), includeMetadata: true, includeVectors: false, includeData: true, ...(filtro === undefined ? {} : { filter: traduzirFiltroUpstash(filtro) }) },
    });
    const l = ((r.json as { result?: VetorUpstash[] } | null)?.result ?? []).filter((v) => v.id !== ID_CONFIG);
    return l.slice(0, k).map((v) => ({ id: v.id, escore: esc01(v.score ?? 0), texto: v.data ?? "", meta: planoParaMeta(v.metadata ?? {}) }));
  }

  private async range(cursor: string, limite: number, vetores: boolean): Promise<{ itens: VetorUpstash[]; proximo: string }> {
    const r = await this.chamar("POST", `/range/${this.ns()}`, { corpo: { cursor, limit: limite, includeMetadata: true, includeVectors: vetores, includeData: true } });
    const res = (r.json as { result?: { nextCursor?: string; vectors?: VetorUpstash[] } } | null)?.result;
    return { itens: (res?.vectors ?? []).filter((v) => v.id !== ID_CONFIG), proximo: res?.nextCursor ?? "" };
  }

  protected async contarRemoto(filtro: Filtro | undefined): Promise<number> {
    if (filtro === undefined) {
      const i = await this.info();
      const c = await this.lerConfigRemota();
      return Math.max(0, i.vectorCount - (c === null ? 0 : 1));
    }
    let n = 0;
    let cur = "0";
    do {
      const p = await this.range(cur, 1000, false);
      n += p.itens.filter((v) => avaliarFiltro(filtro, planoParaMeta(v.metadata ?? {}))).length;
      cur = p.proximo;
    } while (cur !== "");
    return n;
  }

  protected async paginaRemota(cursor: string | null, tamanho: number, filtro: Filtro | undefined): Promise<PaginaExportada> {
    let cur = "0";
    if (cursor !== null) {
      if (!/^u:[A-Za-z0-9_.:-]{1,64}$/.test(cursor)) throw new CursorInvalidoErro();
      cur = cursor.slice(2);
    }
    const p = await this.range(cur, tamanho, true);
    const itens = p.itens.map((v) => this.paraRegistro(v)).filter((r) => avaliarFiltro(filtro, r.meta));
    return { itens, proximoCursor: p.proximo === "" ? null : `u:${p.proximo}` };
  }

  protected async porIds(ids: string[]): Promise<RegistroConhecimento[]> {
    const saida: RegistroConhecimento[] = [];
    for (const lote of fatiar(ids, 100)) {
      const r = await this.chamar("POST", `/fetch/${this.ns()}`, { corpo: { ids: lote, includeMetadata: true, includeVectors: true, includeData: true } });
      for (const v of (r.json as { result?: Array<VetorUpstash | null> } | null)?.result ?? []) if (v) saida.push(this.paraRegistro(v));
    }
    return saida;
  }

  protected async removerRemoto(filtro: Filtro): Promise<number | "desconhecido"> {
    const r = await this.chamar("POST", `/delete/${this.ns()}`, { corpo: { filter: traduzirFiltroUpstash(filtro) } });
    const d = (r.json as { result?: { deleted?: number } } | null)?.result?.deleted;
    return typeof d === "number" ? d : "desconhecido";
  }
}

