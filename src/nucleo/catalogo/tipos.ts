// Tipos internos da varredura (sem Electron). `InstalacaoCatalogo` e `ItemCatalogo` públicos vêm de compartilhado/catalogo.ts.
import type { CliCatalogo, EscopoCatalogo, EstadoInstalacao, MetodoInstalacao, OrigemCatalogo, PapelSugerido, TipoCatalogo } from "../../compartilhado/catalogo";

export type DetalheInstalacao = Record<string, string | number | boolean | null>;

export interface InstalacaoEscaneada {
  cli: CliCatalogo;
  escopo: EscopoCatalogo;
  /** '' = global */
  workspace_id: string;
  base: "home" | "workspace";
  caminho_rel: string;
  metodo: MetodoInstalacao;
  estado: EstadoInstalacao;
  habilitada: boolean;
  criado_pelo_app: boolean;
  hash_conteudo: string | null;
  tamanho: number | null;
  mtime_ms: number | null;
  detalhe: DetalheInstalacao;
}

export interface ItemEscaneado {
  tipo: TipoCatalogo;
  nome: string;
  nome_normalizado: string;
  plugin: string | null;
  autor: string | null;
  origem: OrigemCatalogo;
  descricao: string | null;
  papel_sugerido: PapelSugerido | null;
  instalacao: InstalacaoEscaneada;
}

export interface ErroScanner {
  cli: CliCatalogo | null;
  tipo: TipoCatalogo | null;
  codigo: string;
  mensagem: string;
}

export interface ResultadoScanner {
  itens: ItemEscaneado[];
  erros: ErroScanner[];
}

export interface WorkspaceVarredura {
  id: string;
  raiz: string;
}

/** Cache por arquivo (`mtime+size`): evita reler `SKILL.md` na re-varredura (P-24). */
export interface EntradaCache {
  mtime_ms: number;
  tamanho: number;
  itens: ItemEscaneado[];
}
export type CacheVarredura = Map<string, EntradaCache>;
