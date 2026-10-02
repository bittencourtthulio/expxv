export const LICENCAS_PERMITIDAS: readonly string[];
export const EXCECOES_LICENCA_DEV: Readonly<Record<string, string>>;
export const ARQUIVO_BASE: string;
export const ARQUIVO_DECISOES: string;
export interface PacoteLock { caminho: string; nome: string; versao: string; licenca: string | null; integridade: string | null; dev: boolean; link: boolean }
export interface Lock { packages?: Record<string, Record<string, unknown>> }
export interface PacoteJson { name?: string; version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
export interface BaseRegistrada { versao: number; dependencias: string[] }
export interface Sbom { bomFormat: string; specVersion: string; version: number; metadata: unknown; components: Array<Record<string, unknown>> }
export interface ResultadoAudit { estado: "ok" | "vulnerabilidades" | "não executado"; motivo?: string; vulnerabilidades?: Record<string, number>; total?: number }
export interface ResultadoAuditoria {
  pacotes: number;
  licencasForaDaLista: Array<{ pacote: string; versao: string; caminho: string; licenca: string }>;
  semRegistro: Array<{ pacote: string }>;
  sbom: Sbom;
  errosSbom: string[];
  audit: ResultadoAudit;
}
export function nomeDoCaminho(caminho: string): string;
export function pacotesDoLock(lock: Lock): PacoteLock[];
export function licencaPermitida(expr: string | null | undefined, permitidas?: readonly string[]): boolean;
export function auditarLicencas(lock: Lock, permitidas?: readonly string[]): ResultadoAuditoria["licencasForaDaLista"];
export function auditarRegistro(pkg: PacoteJson, base: BaseRegistrada | null, textoDecisoes: string): Array<{ pacote: string }>;
export function nomesDiretos(pkg: PacoteJson): string[];
export function gerarBase(pkg: PacoteJson): BaseRegistrada;
export function gerarSbom(lock: Lock, opcoes?: { nome?: string; versao?: string }): Sbom;
export function validarSbom(sbom: unknown, lock: Lock): string[];
export function resumirAudit(resultado: { saida?: string; erro?: string } | null | undefined): ResultadoAudit;
export function executarAudit(executor: () => { saida?: string; erro?: string }): ResultadoAudit;
export function auditar(raiz: string, opcoes?: { executorAudit?: (() => { saida?: string; erro?: string }) | null; permitidas?: readonly string[] }): ResultadoAuditoria;
export function falhas(r: ResultadoAuditoria): string[];
