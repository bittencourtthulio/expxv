export function localizarPacote(raiz: string, plataforma?: string): { executavel: string; recursos: string } | null;
export function smokeOk(codigo: number | null, sinal?: string | null): boolean;
export interface ArquivoAsar { caminho: string; tamanho: number; unpacked: boolean }
export function listarAsar(arquivoAsar: string): ArquivoAsar[];
export function maioresDoAsar(arquivos: ArquivoAsar[], n?: number): ArquivoAsar[];
export function pesoMorto(arquivos: ArquivoAsar[]): string[];
export function tamanhoDaPasta(pasta: string): number;
export function conferirFontesLocais(arquivoAsar: string, arquivos: ArquivoAsar[]): { fontes: string[]; erros: string[] };
