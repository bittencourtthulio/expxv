export const CANAIS: readonly ["stable", "beta"];
export const ADAPTADORES_BANCO: readonly string[];
export const PERFIS: readonly string[];
export const CHAVES_PUBLICAS_DE_TESTE: readonly string[];
export interface Distribuicao {
  versao_esquema: 1;
  atualizacao: {
    habilitada: boolean;
    canal_padrao: "stable" | "beta";
    canais: Array<"stable" | "beta">;
    feed: { host: string; caminho_base: string };
    chaves_aceitas: string[];
    rollout: { staging_padrao: number };
    valido_ate_dias: number;
  };
  assinatura: { exigir: boolean };
  banco: { adaptador: string };
}
export function chavePublicaBem(b64: string): boolean;
export function validarDistribuicao(o: unknown, opcoes?: { perfil?: string }): { ok: boolean; erros: string[] };
export function lerDistribuicao(raiz?: string, opcoes?: { perfil?: string }): Distribuicao;
