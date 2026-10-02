// Armazenamento EM MEMÓRIA: o stub local da suíte de contrato (G §8) e a base dos testes de migração/replicação. Sem rede.
// Simula opcionalmente consistência eventual e falhas injetadas (429/5xx) para exercitar retomada e backoff.
import { avaliarFiltro, exigirFiltroNaoVazio, validarFiltro } from "./filtro";
import { ColecaoDivergenteErro, CursorInvalidoErro, type ArmazenamentoConhecimento, type Capacidades, type Filtro, type MetricaDistancia, type PaginaExportada, type RegistroConhecimento, type ResultadoBuscaArmazenamento } from "./interface";
import { buscarRegistros, normalizar } from "./util";

export interface OpcoesMemoria {
  loteMaximo?: number;
  hibrido?: boolean;
  dimensaoMaxima?: number;
  /** falha injetada: chamada a `upsert` de índice N lança este erro (uma vez). */
  falharNoUpsert?: { chamada: number; erro: Error };
  /** `contar` logo após gravar diverge até `assentar()` (consistência eventual). */
  eventual?: boolean;
}

export class ArmazenamentoMemoria implements ArmazenamentoConhecimento {
  private colecao: { dimensao: number; metrica: MetricaDistancia; modeloEmbedding: string } | null = null;
  private readonly dados = new Map<string, RegistroConhecimento>();
  private visiveis = new Set<string>();
  chamadasUpsert = 0;
  constructor(private readonly o: OpcoesMemoria = {}) {}

  /** (teste) encerra a janela de consistência eventual. */
  assentar(): void {
    this.visiveis = new Set(this.dados.keys());
  }
  get tamanho(): number {
    return this.dados.size;
  }
  temColecao(): boolean {
    return this.colecao !== null;
  }
  async testarConexao(): Promise<{ ok: boolean; versao?: string; motivo?: string }> {
    return { ok: true, versao: "memoria-1" };
  }
  async garantirColecao(p: { dimensao: number; metrica: MetricaDistancia; modeloEmbedding: string }): Promise<void> {
    if (this.o.dimensaoMaxima !== undefined && p.dimensao > this.o.dimensaoMaxima) throw new ColecaoDivergenteErro([`dimensão ${p.dimensao} acima do máximo ${this.o.dimensaoMaxima}`]);
    if (this.colecao === null) {
      this.colecao = { ...p };
      return;
    }
    const dif: string[] = [];
    if (this.colecao.dimensao !== p.dimensao) dif.push(`dimensão ${this.colecao.dimensao} ≠ ${p.dimensao}`);
    if (this.colecao.metrica !== p.metrica) dif.push(`métrica ${this.colecao.metrica} ≠ ${p.metrica}`);
    if (this.colecao.modeloEmbedding !== p.modeloEmbedding) dif.push(`modelo ${this.colecao.modeloEmbedding} ≠ ${p.modeloEmbedding}`);
    if (dif.length > 0) throw new ColecaoDivergenteErro(dif);
  }
  async upsert(lote: RegistroConhecimento[]): Promise<{ gravados: number }> {
    this.chamadasUpsert++;
    if (this.o.falharNoUpsert && this.chamadasUpsert === this.o.falharNoUpsert.chamada) throw this.o.falharNoUpsert.erro;
    const c = this.colecao;
    if (c === null) throw new Error("coleção inexistente");
    if (lote.length > (this.o.loteMaximo ?? 100)) throw new Error(`lote acima do máximo (${this.o.loteMaximo ?? 100})`);
    for (const r of lote) {
      if (r.vetor.length !== c.dimensao) throw new ColecaoDivergenteErro([`vetor com dimensão ${r.vetor.length}, esperada ${c.dimensao}`]);
      if (r.meta.modelo_embedding !== c.modeloEmbedding) throw new ColecaoDivergenteErro([`modelo ${r.meta.modelo_embedding} ≠ ${c.modeloEmbedding}`]);
      this.dados.set(r.id, { ...r, vetor: c.metrica === "euclidiana" ? [...r.vetor] : normalizar(r.vetor) });
      if (!this.o.eventual) this.visiveis.add(r.id);
    }
    return { gravados: lote.length };
  }
  async consultar(p: { vetor: number[]; texto?: string; filtro?: Filtro; k: number }): Promise<ResultadoBuscaArmazenamento[]> {
    const c = this.colecao;
    if (c === null) return [];
    return buscarRegistros(this.dados.values(), c, p);
  }
  async contar(filtro?: Filtro): Promise<number> {
    if (filtro) validarFiltro(filtro);
    return [...this.dados.values()].filter((r) => (!this.o.eventual || this.visiveis.has(r.id)) && avaliarFiltro(filtro, r.meta)).length;
  }
  async exportarPagina(cursor: string | null, tamanho = 100, filtro?: Filtro): Promise<PaginaExportada> {
    if (filtro) validarFiltro(filtro);
    const ids = [...this.dados.entries()].filter(([, r]) => avaliarFiltro(filtro, r.meta)).map(([i]) => i).sort();
    let ini = 0;
    if (cursor !== null) {
      if (!/^c:[0-9a-f-]{1,40}$/.test(cursor) && !/^c:~$/.test(cursor)) throw new CursorInvalidoErro();
      const ult = cursor.slice(2);
      ini = ids.findIndex((i) => i > ult);
      if (ini < 0) ini = ids.length;
    }
    const fatia = ids.slice(ini, ini + Math.max(1, Math.min(tamanho, 1000)));
    const prox = ini + fatia.length < ids.length ? `c:${fatia[fatia.length - 1] as string}` : null;
    return { itens: fatia.map((i) => this.dados.get(i) as RegistroConhecimento), proximoCursor: prox };
  }
  async obterPorIds(ids: string[]): Promise<RegistroConhecimento[]> {
    return ids.map((i) => this.dados.get(i)).filter((r): r is RegistroConhecimento => r !== undefined);
  }
  async apagar(filtro: Filtro): Promise<{ apagados: number | "desconhecido" }> {
    exigirFiltroNaoVazio(filtro);
    let n = 0;
    for (const [id, r] of [...this.dados]) if (avaliarFiltro(filtro, r.meta)) (this.dados.delete(id), this.visiveis.delete(id), n++);
    return { apagados: n };
  }
  capacidades(): Capacidades {
    return { hibrido: this.o.hibrido ?? false, filtroNativo: true, exportarComCursor: true, apagarPorFiltro: true, ...(this.o.dimensaoMaxima !== undefined ? { dimensaoMaxima: this.o.dimensaoMaxima } : {}), loteMaximo: this.o.loteMaximo ?? 100, consistenciaEventual: this.o.eventual === true, multiTenancy: "colecao" };
  }
}
