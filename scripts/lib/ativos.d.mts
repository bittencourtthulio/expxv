export interface Ativo { de: string; para: string; extensoes: string[] }
export const ATIVOS: Ativo[];
export function copiarAtivos(raiz: string, ativos?: Ativo[]): string[];
