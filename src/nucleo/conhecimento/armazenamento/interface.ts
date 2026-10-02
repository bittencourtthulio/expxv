// Interface única `ArmazenamentoConhecimento` (G §4) + extensões da Fase 15: `obterPorIds` (verificação por amostra) e `criado_em_ms`
// em `meta` (pull incremental por `entre`). O armazenamento LOCAL é o adaptador de referência; adaptadores online só entram por
// transporte injetado e só com consentimento (nada sai da máquina por padrão).
export type MetricaDistancia = "cosseno" | "produto_interno" | "euclidiana";

export interface Capacidades {
  hibrido: boolean;
  filtroNativo: boolean;
  exportarComCursor: boolean;
  apagarPorFiltro: boolean;
  dimensaoMaxima?: number;
  loteMaximo: number;
  consistenciaEventual: boolean;
  multiTenancy: "namespace" | "colecao" | "campo" | "banco";
}

export interface MetaRegistro {
  projeto_id: string;
  equipe_id?: string;
  tipo: string;
  /** caminho relativo ou referência lógica; NUNCA absoluto. */
  origem: string;
  hash_conteudo: string;
  modelo_embedding: string;
  dimensao: number;
  criado_em: string;
  criado_em_ms: number;
  /** posição do trecho no documento (opcional). */
  indice?: number;
  titulo?: string;
}

export interface RegistroConhecimento {
  id: string;
  vetor: number[];
  /** já redigido. */
  texto: string;
  meta: MetaRegistro;
}

export type Filtro =
  | { e: Filtro[] }
  | { ou: Filtro[] }
  | { campo: string; igual: string | number | boolean }
  | { campo: string; em: Array<string | number> }
  | { campo: string; entre: [number, number] };

export interface ResultadoBuscaArmazenamento {
  id: string;
  /** 0..1, maior = melhor. */
  escore: number;
  texto: string;
  meta: MetaRegistro;
}
export interface PaginaExportada {
  itens: RegistroConhecimento[];
  proximoCursor: string | null;
}

export interface ArmazenamentoConhecimento {
  /** nunca grava dados nem cria coleção. */
  testarConexao(): Promise<{ ok: boolean; versao?: string; motivo?: string }>;
  garantirColecao(p: { dimensao: number; metrica: MetricaDistancia; modeloEmbedding: string }): Promise<void>;
  upsert(lote: RegistroConhecimento[]): Promise<{ gravados: number }>;
  consultar(p: { vetor: number[]; texto?: string; filtro?: Filtro; k: number }): Promise<ResultadoBuscaArmazenamento[]>;
  contar(filtro?: Filtro): Promise<number>;
  /** `filtro` opcional (ex.: `criado_em_ms` entre) para o pull incremental. */
  exportarPagina(cursor: string | null, tamanho?: number, filtro?: Filtro): Promise<PaginaExportada>;
  obterPorIds(ids: string[]): Promise<RegistroConhecimento[]>;
  apagar(filtro: Filtro): Promise<{ apagados: number | "desconhecido" }>;
  capacidades(): Capacidades;
}

export class ColecaoDivergenteErro extends Error {
  override name = "ColecaoDivergenteErro";
  constructor(readonly diferencas: string[]) {
    super(`A coleção existente diverge: ${diferencas.join("; ")}. Nunca misture modelos nem dimensões; crie uma coleção versionada.`);
  }
}
export class CursorInvalidoErro extends Error {
  override name = "CursorInvalidoErro";
  constructor() {
    super("cursor de exportação inválido");
  }
}
export class FiltroInvalidoErro extends Error {
  override name = "FiltroInvalidoErro";
}
