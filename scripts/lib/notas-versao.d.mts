export const MARCA_HISTORICO: string;
export class ErroNotas extends Error {}
export interface SecaoNotas { titulo: string; itens: string[] }
export interface Notas { versao: string; data: string; secoes: SecaoNotas[]; origem: "changelog" | "historico" }
export type ExecutorGit = (args: string[]) => string;
export function escaparHtml(t: string): string;
export function extrairSecao(changelog: string, versao: string): Notas;
export function notasDoHistorico(versao: string, executorGit: ExecutorGit): Notas;
export function renderizarMarkdown(n: Notas): string;
export function renderizarTextoPuro(n: Notas): string;
export function gerarNotas(o: { versao: string; changelog?: string | null; executorGit?: ExecutorGit }): { origem: "changelog" | "historico"; markdown: string; texto: string };
