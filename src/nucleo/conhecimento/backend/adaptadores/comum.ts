// Base comum dos adaptadores HTTP do backend online (Qdrant, Supabase, Upstash, Pinecone). Cada adaptador só implementa as operações
// de baixo nível; aqui ficam as regras do contrato: validação de lote/dimensão/modelo, coerência (`__config__`), normalização de vetores,
// híbrido (RRF no cliente quando o provedor não tem busca textual), filtro validado e erros SEM credencial.
// Só usa o transporte injetado (`TransporteHttpRag`): este módulo não abre socket.
import { exigirFiltroNaoVazio, validarFiltro } from "../../armazenamento/filtro";
import {
  ColecaoDivergenteErro,
  CursorInvalidoErro,
  FiltroInvalidoErro,
  type ArmazenamentoConhecimento,
  type Capacidades,
  type Filtro,
  type MetaRegistro,
  type MetricaDistancia,
  type PaginaExportada,
  type RegistroConhecimento,
  type ResultadoBuscaArmazenamento,
} from "../../armazenamento/interface";
import { normalizar, rankearRrf } from "../../armazenamento/util";
import { sanitizarErro } from "../config";
import type { RespostaRag, TransporteHttpRag } from "../transporte";
import { validarUrlBackend } from "../url";

/** id reservado do registro de configuração da coleção (provedores sem metadado de coleção). */
export const ID_CONFIG = "__config__";

export interface ConfigRemota {
  modeloEmbedding: string;
  dimensao: number;
  metrica: MetricaDistancia;
}

export interface OpcoesAdaptador {
  transporte: TransporteHttpRag;
  url: string;
  /** coleção (Qdrant), tabela (Supabase) ou namespace (Upstash/Pinecone). */
  colecao: string;
  segredos: Readonly<Record<string, string>>;
  timeoutMs?: number;
  loteMaximo?: number;
  sinal?: AbortSignal;
}

/** Falha do provedor: texto FIXO por status (nunca corpo, URL com query nem cabeçalho). */
export class ErroProvedor extends Error {
  override name = "ErroProvedor";
  constructor(
    readonly provedor: string,
    readonly status: number,
    complemento?: string,
  ) {
    const base = status === 401 || status === 403 ? "credencial recusada" : status === 404 ? "recurso não encontrado" : status === 429 ? "limite de uso do provedor" : status >= 500 ? "provedor indisponível" : "pedido recusado";
    super(`${provedor}: ${base} (HTTP ${status})${complemento === undefined ? "" : `: ${complemento}`}`);
  }
}

export const esc01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
export const sigmoide = (d: number): number => 1 / (1 + Math.exp(-d));

/** `d` = produto interno bruto, cosseno bruto ou distância, conforme a métrica, para escore 0..1 (maior = melhor). */
export function escoreBruto(m: MetricaDistancia, bruto: { cosseno?: number; produto?: number; distancia?: number }): number {
  if (m === "cosseno") return esc01(((bruto.cosseno ?? 0) + 1) / 2);
  if (m === "produto_interno") return esc01(sigmoide(bruto.produto ?? 0));
  return esc01(1 / (1 + Math.max(0, bruto.distancia ?? 0)));
}

export const arredondarVetor = (v: readonly number[]): number[] => v.map((x) => Number(x.toPrecision(7)));

/** remove NUL (Postgres/JSON de alguns provedores não aceitam). */
export const limparTexto = (t: string): string => t.split("\u0000").join("");

export function parseVetor(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") {
    try {
      const j: unknown = JSON.parse(v);
      return Array.isArray(j) ? j.map(Number) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Campos de `MetaRegistro` num objeto achatado (payload/metadados/linha). Valores nulos são omitidos. */
export function metaParaPlano(m: MetaRegistro): Record<string, string | number> {
  const o: Record<string, string | number> = {
    projeto_id: limparTexto(m.projeto_id),
    tipo: limparTexto(m.tipo),
    origem: limparTexto(m.origem),
    hash_conteudo: limparTexto(m.hash_conteudo),
    modelo_embedding: limparTexto(m.modelo_embedding),
    dimensao: m.dimensao,
    criado_em: m.criado_em,
    criado_em_ms: m.criado_em_ms,
  };
  if (m.equipe_id !== undefined) o.equipe_id = limparTexto(m.equipe_id);
  if (m.indice !== undefined) o.indice = m.indice;
  if (m.titulo !== undefined) o.titulo = limparTexto(m.titulo);
  return o;
}

export function planoParaMeta(p: Record<string, unknown>): MetaRegistro {
  const s = (x: unknown): string => (typeof x === "string" ? x : "");
  const n = (x: unknown): number => (typeof x === "number" ? x : Number(x) || 0);
  const m: MetaRegistro = {
    projeto_id: s(p.projeto_id),
    tipo: s(p.tipo),
    origem: s(p.origem),
    hash_conteudo: s(p.hash_conteudo),
    modelo_embedding: s(p.modelo_embedding),
    dimensao: n(p.dimensao),
    criado_em: s(p.criado_em),
    criado_em_ms: n(p.criado_em_ms),
  };
  if (typeof p.equipe_id === "string" && p.equipe_id !== "") m.equipe_id = p.equipe_id;
  if (p.indice !== undefined && p.indice !== null) m.indice = n(p.indice);
  if (typeof p.titulo === "string") m.titulo = p.titulo;
  return m;
}

export const termosDe = (texto: string): string[] => [...new Set(texto.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [])].slice(0, 12);

/** RRF (vetor + texto) com a MESMA fórmula do adaptador local/memória. */
export function fundirHibrido(porVetor: ResultadoBuscaArmazenamento[], porTexto: ResultadoBuscaArmazenamento[], k: number): ResultadoBuscaArmazenamento[] {
  const fund = rankearRrf([porVetor.map((x) => x.id), porTexto.map((x) => x.id)]);
  const escVec = new Map(porVetor.map((x) => [x.id, x.escore]));
  const porId = new Map<string, ResultadoBuscaArmazenamento>([...porTexto, ...porVetor].map((x) => [x.id, x]));
  const max = fund[0]?.escore ?? 1;
  return fund.slice(0, k).map((f) => {
    const r = porId.get(f.id) as ResultadoBuscaArmazenamento;
    return { id: f.id, escore: esc01((f.escore / max) * 0.5 + (escVec.get(f.id) ?? 0) * 0.5), texto: r.texto, meta: r.meta };
  });
}

/** Sem busca textual nativa: ranqueia por termos presentes entre os candidatos vetoriais. */
export function lexicalSobreCandidatos(cand: ResultadoBuscaArmazenamento[], termos: string[]): ResultadoBuscaArmazenamento[] {
  return cand
    .map((r) => ({ r, n: termos.filter((t) => r.texto.toLowerCase().includes(t)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || (a.r.id < b.r.id ? -1 : 1))
    .map((x) => x.r);
}

export function comparar(local: ConfigRemota, remoto: ConfigRemota): string[] {
  const dif: string[] = [];
  if (remoto.dimensao !== local.dimensao) dif.push(`dimensão remota ${remoto.dimensao} ≠ ${local.dimensao}`);
  if (remoto.metrica !== local.metrica) dif.push(`métrica remota ${remoto.metrica} ≠ ${local.metrica}`);
  if (remoto.modeloEmbedding !== local.modeloEmbedding) dif.push(`modelo remoto ${remoto.modeloEmbedding} ≠ ${local.modeloEmbedding}`);
  return dif;
}

export const METRICAS: readonly MetricaDistancia[] = ["cosseno", "produto_interno", "euclidiana"];
export const ehMetrica = (x: unknown): x is MetricaDistancia => typeof x === "string" && (METRICAS as readonly string[]).includes(x);

export function lerConfigDeCampos(c: { cfg_modelo?: unknown; cfg_dimensao?: unknown; cfg_metrica?: unknown }): ConfigRemota | null {
  if (typeof c.cfg_modelo !== "string" || typeof c.cfg_dimensao !== "number" || !ehMetrica(c.cfg_metrica)) return null;
  return { modeloEmbedding: c.cfg_modelo, dimensao: c.cfg_dimensao, metrica: c.cfg_metrica };
}

export abstract class ArmazenamentoHttp implements ArmazenamentoConhecimento {
  protected cfg: ConfigRemota | null = null;
  protected readonly base: string;
  protected abstract readonly caps: Omit<Capacidades, "loteMaximo"> & { loteMaximo: number };
  /** tamanho máximo de página de exportação. */
  protected readonly maxPagina: number = 100;

  constructor(
    protected readonly o: OpcoesAdaptador,
    readonly provedor: string,
  ) {
    const v = validarUrlBackend(o.url);
    if (!v.ok) throw new Error(v.erro ?? "URL inválida");
    this.base = o.url.trim().replace(/\/+$/, "");
  }

  // ---- operações de baixo nível (cada provedor) ----
  protected abstract cabecalhosAuth(): Record<string, string>;
  /** lança em falha; devolve a versão quando conhecida. NUNCA grava. */
  protected abstract sondar(): Promise<{ versao?: string }>;
  /** cria o contêiner se necessário e valida o que o provedor sabe (dimensão); `vazia` = sem registros reais. */
  protected abstract preparar(p: ConfigRemota): Promise<{ vazia: boolean }>;
  abstract lerConfigRemota(): Promise<ConfigRemota | null>;
  protected abstract gravarConfig(c: ConfigRemota): Promise<void>;
  protected abstract gravar(regs: RegistroConhecimento[], c: ConfigRemota): Promise<void>;
  protected abstract buscarVetor(vetor: number[], filtro: Filtro | undefined, k: number, c: ConfigRemota): Promise<ResultadoBuscaArmazenamento[]>;
  protected buscarTexto?(termos: string[], filtro: Filtro | undefined, k: number, c: ConfigRemota): Promise<ResultadoBuscaArmazenamento[]>;
  protected abstract contarRemoto(filtro: Filtro | undefined): Promise<number>;
  protected abstract paginaRemota(cursor: string | null, tamanho: number, filtro: Filtro | undefined): Promise<PaginaExportada>;
  protected abstract porIds(ids: string[]): Promise<RegistroConhecimento[]>;
  protected abstract removerRemoto(filtro: Filtro): Promise<number | "desconhecido">;

  // ---- HTTP ----
  protected sinal(): AbortSignal {
    const t = AbortSignal.timeout(this.o.timeoutMs ?? 15_000);
    return this.o.sinal ? AbortSignal.any([this.o.sinal, t]) : t;
  }
  protected get segredosLista(): string[] {
    return Object.values(this.o.segredos).filter((s) => typeof s === "string" && s.length >= 4);
  }
  /** Chama o provedor. Status fora de `aceitar` vira `ErroProvedor` (sem corpo). `json` é `null` quando o corpo é vazio. */
  protected async chamar(metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", caminho: string, op: { corpo?: unknown; cabecalhos?: Record<string, string>; aceitar?: number[] } = {}): Promise<{ status: number; json: unknown; resposta: RespostaRag }> {
    let r: RespostaRag;
    try {
      r = await this.o.transporte({
        url: `${this.base}${caminho}`,
        metodo,
        cabecalhos: { accept: "application/json", ...(op.corpo === undefined ? {} : { "content-type": "application/json" }), ...this.cabecalhosAuth(), ...(op.cabecalhos ?? {}) },
        ...(op.corpo === undefined ? {} : { corpo: JSON.stringify(op.corpo) }),
        sinal: this.sinal(),
        ...(this.o.timeoutMs === undefined ? {} : { timeoutMs: this.o.timeoutMs }),
      });
    } catch (e) {
      throw this.erroSeguro(e);
    }
    if (!r.ok && !(op.aceitar ?? []).includes(r.status)) throw new ErroProvedor(this.provedor, r.status);
    let json: unknown = null;
    try {
      const t = await r.texto();
      json = t.trim() === "" ? null : (JSON.parse(t) as unknown);
    } catch {
      if (r.ok) throw new ErroProvedor(this.provedor, r.status, "resposta inválida");
    }
    return { status: r.status, json, resposta: r };
  }
  /** erro de transporte/rede sem segredo (RedeErro e abortos têm texto fixo; o resto passa pelo sanitizador). */
  protected erroSeguro(e: unknown): Error {
    if (e instanceof ErroProvedor || e instanceof ColecaoDivergenteErro || e instanceof FiltroInvalidoErro || e instanceof CursorInvalidoErro) return e;
    if (e instanceof Error) {
      if (e.name === "RedeErro" || e.name === "AbortError" || e.name === "TimeoutError") {
        const n = new Error(sanitizarErro(e.message, this.segredosLista));
        n.name = e.name;
        if ("codigo" in e) Object.assign(n, { codigo: (e as { codigo: unknown }).codigo });
        return n;
      }
      return new Error(sanitizarErro(e.message, this.segredosLista));
    }
    return new Error("falha desconhecida");
  }

  // ---- contrato ----
  async testarConexao(): Promise<{ ok: boolean; versao?: string; motivo?: string }> {
    try {
      const r = await this.sondar();
      return { ok: true, ...(r.versao === undefined ? {} : { versao: r.versao }) };
    } catch (e) {
      return { ok: false, motivo: this.erroSeguro(e).message.slice(0, 300) };
    }
  }

  async garantirColecao(p: { dimensao: number; metrica: MetricaDistancia; modeloEmbedding: string }): Promise<void> {
    const max = this.caps.dimensaoMaxima;
    if (max !== undefined && p.dimensao > max) throw new ColecaoDivergenteErro([`dimensão ${p.dimensao} acima do máximo do provedor (${max})`]);
    if (!Number.isInteger(p.dimensao) || p.dimensao < 1) throw new ColecaoDivergenteErro([`dimensão inválida ${p.dimensao}`]);
    try {
      const prep = await this.preparar(p);
      const atual = await this.lerConfigRemota();
      if (atual === null) {
        if (!prep.vazia) throw new ColecaoDivergenteErro(["coleção remota com dados mas sem registro de configuração (__config__)"]);
        await this.gravarConfig(p);
        this.cfg = { ...p };
        return;
      }
      const dif = comparar(p, atual);
      if (dif.length > 0) throw new ColecaoDivergenteErro(dif);
      this.cfg = atual;
    } catch (e) {
      throw this.erroSeguro(e);
    }
  }

  private async cfgAtual(): Promise<ConfigRemota | null> {
    this.cfg ??= await this.lerConfigRemota().catch((e: unknown) => {
      throw this.erroSeguro(e);
    });
    return this.cfg;
  }

  async upsert(lote: RegistroConhecimento[]): Promise<{ gravados: number }> {
    const max = this.o.loteMaximo ?? this.caps.loteMaximo;
    if (lote.length > max) throw new Error(`lote acima do máximo (${max})`);
    if (lote.length === 0) return { gravados: 0 };
    const c = await this.cfgAtual();
    if (c === null) throw new Error("coleção inexistente: chame garantirColecao antes");
    const prontos: RegistroConhecimento[] = [];
    for (const r of lote) {
      if (typeof r.id !== "string" || r.id === "" || r.id === ID_CONFIG || r.id.length > 100) throw new Error("id de registro inválido");
      if (r.vetor.length !== c.dimensao) throw new ColecaoDivergenteErro([`vetor com dimensão ${r.vetor.length}, esperada ${c.dimensao}`]);
      if (r.vetor.some((x) => !Number.isFinite(x))) throw new Error("vetor com valor não finito");
      if (r.meta.modelo_embedding !== c.modeloEmbedding) throw new ColecaoDivergenteErro([`modelo ${r.meta.modelo_embedding} ≠ ${c.modeloEmbedding}`]);
      prontos.push({ ...r, texto: limparTexto(r.texto), vetor: arredondarVetor(c.metrica === "euclidiana" ? r.vetor : normalizar(r.vetor)) });
    }
    try {
      await this.gravar(prontos, c);
    } catch (e) {
      throw this.erroSeguro(e);
    }
    return { gravados: lote.length };
  }

  async consultar(p: { vetor: number[]; texto?: string; filtro?: Filtro; k: number }): Promise<ResultadoBuscaArmazenamento[]> {
    if (p.filtro) validarFiltro(p.filtro);
    const c = await this.cfgAtual();
    if (c === null || p.k <= 0) return [];
    if (p.vetor.length !== c.dimensao) throw new ColecaoDivergenteErro([`consulta com dimensão ${p.vetor.length}, esperada ${c.dimensao}`]);
    const q = arredondarVetor(c.metrica === "euclidiana" ? p.vetor : normalizar(p.vetor));
    const k = Math.min(Math.floor(p.k), 200);
    try {
      const termos = p.texto === undefined || p.texto.trim() === "" ? [] : termosDe(p.texto);
      if (termos.length === 0) return await this.buscarVetor(q, p.filtro, k, c);
      const sobra = Math.min(200, Math.max(k * 4, 40));
      const porVetor = await this.buscarVetor(q, p.filtro, sobra, c);
      const porTexto = this.buscarTexto ? await this.buscarTexto(termos, p.filtro, sobra, c) : lexicalSobreCandidatos(porVetor, termos);
      return fundirHibrido(porVetor, porTexto, k);
    } catch (e) {
      throw this.erroSeguro(e);
    }
  }

  async contar(filtro?: Filtro): Promise<number> {
    if (filtro) validarFiltro(filtro);
    try {
      return await this.contarRemoto(filtro);
    } catch (e) {
      throw this.erroSeguro(e);
    }
  }

  async exportarPagina(cursor: string | null, tamanho = 100, filtro?: Filtro): Promise<PaginaExportada> {
    if (filtro) validarFiltro(filtro);
    const tam = Math.max(1, Math.min(Math.floor(tamanho), this.maxPagina));
    try {
      return await this.paginaRemota(cursor, tam, filtro);
    } catch (e) {
      throw this.erroSeguro(e);
    }
  }

  async obterPorIds(ids: string[]): Promise<RegistroConhecimento[]> {
    const unicos = [...new Set(ids.filter((i) => typeof i === "string" && i !== "" && i !== ID_CONFIG))];
    if (unicos.length === 0) return [];
    try {
      return await this.porIds(unicos);
    } catch (e) {
      throw this.erroSeguro(e);
    }
  }

  async apagar(filtro: Filtro): Promise<{ apagados: number | "desconhecido" }> {
    exigirFiltroNaoVazio(filtro);
    try {
      return { apagados: await this.removerRemoto(filtro) };
    } catch (e) {
      throw this.erroSeguro(e);
    }
  }

  capacidades(): Capacidades {
    return { ...this.caps, loteMaximo: this.o.loteMaximo ?? this.caps.loteMaximo };
  }
}

export const segredoObrigatorio = (segredos: Readonly<Record<string, string>>, campo: string, provedor: string): string => {
  const v = segredos[campo];
  if (typeof v !== "string" || v === "") throw new Error(`${provedor}: o campo "${campo}" é obrigatório`);
  if (/[\r\n\0]/.test(v)) throw new Error(`${provedor}: o campo "${campo}" tem caracteres inválidos`);
  return v;
};

export const enc = encodeURIComponent;

/** fatia em pedaços de até `n`. */
export function fatiar<T>(l: readonly T[], n: number): T[][] {
  const s: T[][] = [];
  for (let i = 0; i < l.length; i += n) s.push(l.slice(i, i + n));
  return s;
}
