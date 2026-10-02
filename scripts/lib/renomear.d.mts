export const LISTA_FECHADA: readonly string[];
export const ITENS_MANUAIS: ReadonlyArray<{ id: string; descricao: string }>;
export interface OpcoesRenomear { nome?: string; id?: string; dono?: string; repo?: string; hostFeed?: string; migrarDados?: boolean }
export interface EdicaoLinha { linha: number; antes: string; depois: string }
export interface ArquivoPlanejado { caminho: string; sha256_antes: string; sha256_depois: string; edicoes: EdicaoLinha[]; _novo: string }
export interface PlanoRenomeacao {
  de: { nome: string; id: string; idDados: string; appId: string; dono: string; repo: string };
  para: { nome: string; id: string; idDados: string; appId: string; dono: string; repo: string; idsAnteriores: string[] };
  opcoes: { nome: string | null; id: string | null; dono: string | null; repo: string | null; hostFeed: string | null; migrarDados: boolean };
  arquivos: ArquivoPlanejado[];
  manual: Array<{ id: string; descricao: string }>;
  avisos: string[];
}
export interface ProdutoLido { nome: string; id: string; idDadosExpr: string; idDados: string; idsAnteriores: string[]; dono: string; repoExpr: string; repo: string; appId: string; repositorioReleases?: { dono: string; repo: string } }
export function lerProduto(raiz: string): ProdutoLido & { repositorioReleases: { dono: string; repo: string } };
export function validarOpcoes(op: OpcoesRenomear, contexto?: { appIdAtual?: string }): void;
export function planejar(raiz: string, op: OpcoesRenomear): PlanoRenomeacao;
export function aplicar(raiz: string, plano: PlanoRenomeacao, opcoes?: { hoje?: Date }): { relatorio: Record<string, unknown>; caminhoRelatorio: string };
export function reverter(raiz: string, caminhoRelatorio: string): { restaurados: string[] };
export function resumo(plano: PlanoRenomeacao): string;
