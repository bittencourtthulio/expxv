// ArmazenamentoLocal: o adaptador de REFERÊNCIA sobre o `conhecimento.db` (mesma interface e mesma suíte de contrato dos online).
// Cada instância enxerga UMA coleção (escopo do projeto). É a ponte de leitura/escrita da replicação; não é o caminho quente da busca.
import { idDocumento } from "../ids";
import type { Repos } from "../repos";
import { avaliarFiltro, exigirFiltroNaoVazio, validarFiltro } from "./filtro";
import { ColecaoDivergenteErro, CursorInvalidoErro, type ArmazenamentoConhecimento, type Capacidades, type Filtro, type MetricaDistancia, type MetaRegistro, type PaginaExportada, type RegistroConhecimento, type ResultadoBuscaArmazenamento } from "./interface";
import { buscarRegistros, normalizar } from "./util";

interface Linha {
  id: string;
  texto: string;
  ordem: number;
  titulo: string;
  tipo: string;
  origem: string;
  hash: string;
  criado_em: string;
  modelo: string;
  dimensao: number;
  vetor: Uint8Array;
}

export class ArmazenamentoLocal implements ArmazenamentoConhecimento {
  constructor(private readonly repos: Repos, private readonly colecao_id: string, private readonly projeto_id: string, private readonly equipe_id?: string, private readonly loteMax = 100) {}

  private cfg(): { dimensao: number; metrica: MetricaDistancia; modeloEmbedding: string } {
    const c = this.repos.colecao.obter(this.colecao_id);
    if (!c) throw new Error("coleção local inexistente");
    return { dimensao: c.dimensao, metrica: c.metrica as MetricaDistancia, modeloEmbedding: c.modelo_ativo };
  }

  private registros(): RegistroConhecimento[] {
    const c = this.cfg();
    const linhas = this.repos.banco.consultar<Linha>(
      `SELECT ch.id, ch.texto, ch.ordem, d.titulo, d.tipo, d.origem, ch.hash, d.ocorrido_em AS criado_em, v.modelo, v.dimensao, v.vetor
       FROM rag_chunk ch JOIN rag_documento d ON d.id = ch.documento_id JOIN rag_vetor v ON v.chunk_id = ch.id AND v.modelo = ?
       WHERE d.colecao_id = ? AND d.estado = 'ativo' ORDER BY ch.id`,
      [c.modeloEmbedding, this.colecao_id],
    );
    return linhas.map((l) => {
      const copia = new Uint8Array(l.vetor.byteLength);
      copia.set(l.vetor);
      const meta: MetaRegistro = {
        projeto_id: this.projeto_id,
        ...(this.equipe_id !== undefined ? { equipe_id: this.equipe_id } : {}),
        tipo: l.tipo,
        origem: l.origem,
        hash_conteudo: l.hash,
        modelo_embedding: l.modelo,
        dimensao: Number(l.dimensao),
        criado_em: l.criado_em,
        criado_em_ms: Date.parse(l.criado_em) || 0,
        indice: Number(l.ordem),
        titulo: l.titulo,
      };
      return { id: l.id, vetor: Array.from(new Float32Array(copia.buffer, 0, Math.floor(copia.byteLength / 4))), texto: l.texto, meta };
    });
  }

  async testarConexao(): Promise<{ ok: boolean; versao?: string; motivo?: string }> {
    return this.repos.colecao.obter(this.colecao_id) ? { ok: true, versao: "local-1" } : { ok: false, motivo: "coleção local inexistente" };
  }

  async garantirColecao(p: { dimensao: number; metrica: MetricaDistancia; modeloEmbedding: string }): Promise<void> {
    const c = this.cfg();
    const vazia = this.repos.documento.contagens(this.colecao_id).chunks === 0;
    const dif: string[] = [];
    if (c.dimensao !== p.dimensao) dif.push(`dimensão ${c.dimensao} ≠ ${p.dimensao}`);
    if (c.modeloEmbedding !== p.modeloEmbedding) dif.push(`modelo ${c.modeloEmbedding} ≠ ${p.modeloEmbedding}`);
    if (c.metrica !== p.metrica) dif.push(`métrica ${c.metrica} ≠ ${p.metrica}`);
    if (dif.length === 0) return;
    if (!vazia) throw new ColecaoDivergenteErro(dif);
    this.repos.colecao.definirModelo(this.colecao_id, p.modeloEmbedding, p.dimensao);
    this.repos.banco.executar("UPDATE rag_colecao SET metrica = ? WHERE id = ?", [p.metrica, this.colecao_id]);
  }

  async upsert(lote: RegistroConhecimento[]): Promise<{ gravados: number }> {
    if (lote.length > this.loteMax) throw new Error(`lote acima do máximo (${this.loteMax})`);
    const c = this.cfg();
    for (const r of lote) {
      if (r.meta.projeto_id !== this.projeto_id) throw new Error(`o armazenamento local é de UM projeto: registro do projeto ${r.meta.projeto_id.slice(0, 20)} recusado`);
      if (r.vetor.length !== c.dimensao) throw new ColecaoDivergenteErro([`vetor com dimensão ${r.vetor.length}, esperada ${c.dimensao}`]);
      if (r.meta.modelo_embedding !== c.modeloEmbedding) throw new ColecaoDivergenteErro([`modelo ${r.meta.modelo_embedding} ≠ ${c.modeloEmbedding}`]);
    }
    const t = this.repos.relogio();
    this.repos.banco.transacao((tx) => {
      for (const r of lote) {
        const docId = idDocumento({ escopo: this.projeto_id, tipo: r.meta.tipo, origem: r.meta.origem });
        const ex = tx.consultarUm<{ id: string }>("SELECT id FROM rag_documento WHERE colecao_id = ? AND tipo = ? AND origem = ?", [this.colecao_id, r.meta.tipo, r.meta.origem]);
        const id = ex?.id ?? docId;
        if (!ex) {
          tx.executar(
            "INSERT INTO rag_documento (id,colecao_id,tipo,origem,titulo,hash_conteudo,fonte,importancia,estado,ocorrido_em,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,'sistema',3,'ativo',?,?,?)",
            [id, this.colecao_id, r.meta.tipo, r.meta.origem, (r.meta.titulo ?? r.meta.origem).slice(0, 200), r.meta.hash_conteudo, r.meta.criado_em, t, t],
          );
        }
        tx.executar("DELETE FROM rag_chunk WHERE id = ?", [r.id]); // dispara o gatilho do FTS (REPLACE não dispararia)
        tx.executar("INSERT INTO rag_chunk (id,documento_id,ordem,texto,titulos,termos,hash,criado_em) VALUES (?,?,?,?,'','',?,?)", [r.id, id, r.meta.indice ?? 0, r.texto.slice(0, 2000), r.meta.hash_conteudo, t]);
        const v = new Float32Array(c.metrica === "euclidiana" ? r.vetor : normalizar(r.vetor));
        this.repos.vetor.gravarEm(tx, { chunk_id: r.id, modelo: c.modeloEmbedding, vetor: v });
      }
    });
    return { gravados: lote.length };
  }

  async consultar(p: { vetor: number[]; texto?: string; filtro?: Filtro; k: number }): Promise<ResultadoBuscaArmazenamento[]> {
    return buscarRegistros(this.registros(), this.cfg(), p);
  }

  async contar(filtro?: Filtro): Promise<number> {
    if (filtro) validarFiltro(filtro);
    return this.registros().filter((r) => avaliarFiltro(filtro, r.meta)).length;
  }

  async exportarPagina(cursor: string | null, tamanho = 100, filtro?: Filtro): Promise<PaginaExportada> {
    if (cursor !== null && !/^c:[0-9a-f-]{1,40}$/.test(cursor)) throw new CursorInvalidoErro();
    if (filtro) validarFiltro(filtro);
    const todos = this.registros().filter((r) => avaliarFiltro(filtro, r.meta));
    const ini = cursor === null ? 0 : (() => { const i = todos.findIndex((r) => r.id > cursor.slice(2)); return i < 0 ? todos.length : i; })();
    const fatia = todos.slice(ini, ini + Math.max(1, Math.min(tamanho, 1000)));
    return { itens: fatia, proximoCursor: ini + fatia.length < todos.length ? `c:${fatia[fatia.length - 1]?.id as string}` : null };
  }

  async obterPorIds(ids: string[]): Promise<RegistroConhecimento[]> {
    const set = new Set(ids);
    return this.registros().filter((r) => set.has(r.id));
  }

  async apagar(filtro: Filtro): Promise<{ apagados: number | "desconhecido" }> {
    exigirFiltroNaoVazio(filtro);
    const alvo = this.registros().filter((r) => avaliarFiltro(filtro, r.meta));
    this.repos.banco.transacao((tx) => {
      for (const r of alvo) tx.executar("DELETE FROM rag_chunk WHERE id = ?", [r.id]);
      tx.executar("DELETE FROM rag_documento WHERE colecao_id = ? AND NOT EXISTS (SELECT 1 FROM rag_chunk WHERE documento_id = rag_documento.id)", [this.colecao_id]);
    });
    return { apagados: alvo.length };
  }

  capacidades(): Capacidades {
    return { hibrido: false, filtroNativo: false, exportarComCursor: true, apagarPorFiltro: true, loteMaximo: this.loteMax, consistenciaEventual: false, multiTenancy: "colecao" };
  }
}
