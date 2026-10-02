// Modelo intermediário de documento: HTML e Markdown são renderizados do MESMO modelo, e é aqui que todo texto deixa de ser "dado" e vira marcação (sempre escapado).
export type Celula = string | number | null | { texto: string; href: string | null };
export interface Tabela { legenda: string; colunas: string[]; linhas: Celula[][] }
export interface Cartao { rotulo: string; valor: string; nota?: string | undefined }
export interface Grafico { titulo: string; descricao: string; barras: { rotulo: string; valor: number; destaque?: boolean | undefined }[]; unidade: string }
export interface SecaoDoc {
  id: string;
  titulo: string;
  paragrafos?: string[] | undefined;
  lista?: string[] | undefined;
  cartoes?: Cartao[] | undefined;
  tabela?: Tabela | undefined;
  grafico?: Grafico | undefined;
  /** aviso destacado (ex.: "rascunho", "revisão necessária"). */
  aviso?: string | undefined;
}
export interface MarcaDoc { nome: string; cor: string; rodape: string | null }
export interface DocumentoRel {
  titulo: string;
  subtitulo: string | null;
  /** `rascunho` aparece como faixa no topo até a aprovação humana. */
  estado: "rascunho" | "aprovado" | "interno";
  descricao: string;
  secoes: SecaoDoc[];
  marca: MarcaDoc;
  /** rótulo curto "gerado em ..."; sem caminho. */
  carimbo: string;
  /** notas de rodapé de citação (só no técnico). */
  fontes?: { n: number; rotulo: string }[] | undefined;
}
