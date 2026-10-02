export interface Ativo { de: string; para: string; extensoes: string[]; /** lista fechada de nomes de arquivo a copiar (opcional) */ nomes?: string[]; /** copia subpastas (aninhado), com arquivos 0644 e pastas 0755 */ recursivo?: boolean; /** nomes de subpasta a pular (só com `recursivo`) */ ignorar?: string[] }
export const ATIVOS: Ativo[];
export function copiarAtivos(raiz: string, ativos?: Ativo[]): string[];
