// Configuração `openrouter` (fora do banco de domínio, em `config`): `{habilitado, consentimento_em, clis_preferidas, atualizar_saldo}`.
// Leitura TOLERANTE: valor ausente/corrompido vira o padrão (desligado, sem consentimento).
import { CLIS_PREFERIDAS_PADRAO } from "./adaptadores";

export const CHAVE_CONFIG_OPENROUTER = "openrouter";

export interface ConfigOpenRouter {
  habilitado: boolean;
  consentimento_em: string | null;
  versao_texto: string | null;
  clis_preferidas: string[];
  atualizar_saldo: boolean;
}

export function lerConfigOpenRouter(bruto: unknown): ConfigOpenRouter {
  const o = typeof bruto === "object" && bruto !== null && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const clis = Array.isArray(o.clis_preferidas) ? o.clis_preferidas.filter((c): c is string => typeof c === "string") : null;
  return {
    habilitado: o.habilitado === true,
    consentimento_em: typeof o.consentimento_em === "string" ? o.consentimento_em : null,
    versao_texto: typeof o.versao_texto === "string" ? o.versao_texto : null,
    clis_preferidas: clis ?? [...CLIS_PREFERIDAS_PADRAO],
    atualizar_saldo: o.atualizar_saldo !== false,
  };
}
