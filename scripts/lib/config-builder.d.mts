export const PADRAO_EXCLUSAO_UPDATER: RegExp;
export const ARQUIVO_DISTRIBUICAO_NO_PACOTE: string;
export const FUSES: Readonly<{ release: Readonly<Record<string, boolean>>; perf: Readonly<Record<string, boolean>> }>;
export function carregarBase(raiz?: string): Record<string, any>;
export function configParaPerfil(
  base: Record<string, any>,
  perfil?: string,
  opcoes?: { raiz?: string; distribuicao?: any; temUpdater?: boolean },
): { config: Record<string, any>; avisos: string[] };
export function gravarConfigDerivada(config: Record<string, any>, perfil: string, pasta?: string): string;
