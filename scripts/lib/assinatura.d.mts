export interface Capacidade { id: string; nome: string; alternativas: string[][] }
export interface FerramentasAssinatura { codesign?: string; spctl?: string; xcrun?: string; lipo?: string; signtool?: string }
export function capacidades(prefixoEnv: string): Capacidade[];
export function avaliarAmbiente(env: Record<string, string | undefined>, prefixoEnv: string): { linhas: { capacidade: string; variavel: string; presente: boolean }[]; faltando: { capacidade: string; variaveis: string[] }[]; satisfeito: boolean };
export function tabela(linhas: { capacidade: string; variavel: string; presente: boolean }[]): string;
export const VARIAVEIS_SECRETAS: string[];
export function redigir(texto: unknown, env?: Record<string, string | undefined>): string;
export function tipoBinario(arquivo: string): "macho" | "pe" | null;
export function listarBinarios(raiz: string): { caminho: string; relativo: string; tipo: "macho" | "pe" }[];
export function assinaturaMac(alvo: string, codesign?: string): { assinado: boolean; motivo: string; ferramentaAusente?: boolean };
export function esperadoValido(e: unknown): e is "assinado" | "nao_assinado";
export function verificarNativos(o: { raiz: string; esperado: "assinado" | "nao_assinado"; ferramentas?: FerramentasAssinatura }): { esperado: string; ok: boolean; total: number; assinados: number; nao_assinados: number; nota?: string; problemas: string[]; binarios: { caminho: string; tipo: string; arquiteturas: string[]; assinado: boolean; detalhe: string }[] };
export function localizarApp(raiz: string, nome: string): string | null;
export function chavesDeEntitlements(texto: string): string[];
export function verificarAssinaturaApp(o: { app: string; esperado: "assinado" | "nao_assinado"; ferramentas?: FerramentasAssinatura; entitlementsEsperados?: string[] }): { esperado: string; ok: boolean; nota?: string; problemas: string[]; checks: { id: string; ok: boolean; mensagem: string; chaves?: string[] }[] };
