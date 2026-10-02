export const VERSAO_PACOTE: number;
export const SKILLS_CONHECIDAS: string[];
export const RIGOR: Array<{ nivel: number; nome: string; texto: string }>;
export interface DefMembro {
  slug: string;
  papel: "orchestrator" | "scout" | "executor" | "reviewer";
  arq: string;
  rotulo: string;
  desc: string;
  faixa: string;
  modelo?: string;
  esforco: string;
  n: number;
  skills?: string[];
  mcps?: string[];
  permissao?: string;
  foco?: string;
}
export interface DefSquad {
  slug: string;
  nome: string;
  escopo: string;
  descricao: string;
  foco: string;
  rigidez_padrao?: number;
  paralelas?: number;
  membros: DefMembro[];
}
export const SQUADS: DefSquad[];
export function squadDe(def: DefSquad): Record<string, unknown>;
export function promptDe(def: DefSquad, membro: DefMembro, arquetipos: Record<string, string>): string;
