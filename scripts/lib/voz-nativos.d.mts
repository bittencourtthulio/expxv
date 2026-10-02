export const VERSAO_SHERPA: string;
export const PACOTES_POR_ALVO: Readonly<Record<"mac" | "win" | "local", readonly string[]>>;
export function pacotesFaltando(alvo: string, raiz: string, existe?: (c: string) => boolean): string[];
export function comandoInstalar(faltando: readonly string[]): { cmd: string; args: string[] } | null;
