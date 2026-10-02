export function fusesEsperados(perfil: string): Record<string, boolean>;
export function conferirFuses(fio: Record<string | number, number | string>, perfil: string): { ok: boolean; divergencias: Array<{ fuse: string; esperado: string; atual: string }> };
export function verificarFuses(binario: string, perfil: string, ler?: (p: string) => Promise<Record<string | number, number | string>>): Promise<{ ok: boolean; divergencias: Array<{ fuse: string; esperado: string; atual: string }> }>;
