// T-18.39: exportação CSV (RFC 4180, BOM opcional, PROTEÇÃO contra injeção de fórmula), Markdown e JSON. O núcleo só FORMATA e escolhe o nome seguro; quem grava é a
// função `escrever` injetada (main: fs assíncrono em <userData>/agil/exportacoes/). Nunca grava em docs/** nem fora do diretório de exportação.
import { invalido } from "./erros";

export type FormatoExportacao = "csv" | "md" | "json";
const GATILHO_FORMULA = /^[=+\-@\t\r]/;

/** célula iniciada em = + - @ (ou tab/CR) recebe `'`; depois aplica aspas RFC 4180. Números negativos legítimos (número puro) passam. */
export function celulaCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "string" ? v : JSON.stringify(v);
  if (typeof v === "string" && GATILHO_FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvDe(colunas: readonly string[], linhas: readonly Record<string, unknown>[], opcoes: { bom?: boolean } = {}): string {
  const corpo = [colunas.map(celulaCsv).join(","), ...linhas.map((l) => colunas.map((c) => celulaCsv(l[c])).join(","))].join("\r\n");
  return `${opcoes.bom ? "﻿" : ""}${corpo}\r\n`;
}

const escMd = (v: unknown): string => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
export function markdownDe(titulo: string, colunas: readonly string[], linhas: readonly Record<string, unknown>[]): string {
  return [`# ${titulo}`, "", `| ${colunas.join(" | ")} |`, `| ${colunas.map(() => "---").join(" | ")} |`, ...linhas.map((l) => `| ${colunas.map((c) => escMd(l[c])).join(" | ")} |`), ""].join("\n");
}
export const jsonDe = (dados: unknown): string => `${JSON.stringify(dados, null, 2)}\n`;

export type TipoExportacao = "backlog" | "metricas" | "retro" | "daily";
/** nome de arquivo seguro: só [A-Za-z0-9._-], sem barras nem `..`, extensão do formato. */
export function nomeSeguro(tipo: TipoExportacao, formato: FormatoExportacao, quando: Date, sufixo = ""): string {
  const limpo = sufixo.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return `${tipo}${limpo ? `-${limpo}` : ""}-${quando.toISOString().replace(/[-:.]/g, "").slice(0, 15)}.${formato}`;
}

export interface DepsExportar { escrever(nomeRelativo: string, conteudo: string): Promise<string> }
export async function exportar(d: DepsExportar, p: { tipo: TipoExportacao; formato: FormatoExportacao; colunas: readonly string[]; linhas: readonly Record<string, unknown>[]; quando: Date; sufixo?: string; bom?: boolean }): Promise<{ caminho_ref: string }> {
  if (!["csv", "md", "json"].includes(p.formato)) throw invalido("formato inválido");
  const conteudo = p.formato === "csv" ? csvDe(p.colunas, p.linhas, { bom: p.bom ?? false }) : p.formato === "md" ? markdownDe(p.tipo, p.colunas, p.linhas) : jsonDe(p.linhas);
  const nome = nomeSeguro(p.tipo, p.formato, p.quando, p.sufixo ?? "");
  return { caminho_ref: await d.escrever(nome, conteudo) };
}

/** colunas documentadas (contrato) do backlog exportado. */
export const COLUNAS_BACKLOG = ["id", "titulo", "origem", "estado_fluxo", "pontos", "categoria", "risco", "criticidade", "wsjf", "situacao_retrabalho", "estimativa_origem", "estimativa_confianca", "sprint_id", "dono"] as const;
