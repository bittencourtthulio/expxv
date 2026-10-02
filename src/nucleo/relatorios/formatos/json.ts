// `pacote.json` (`relatorio_pacote_v1`): fatos, blocos, afirmações com fontes, verificação e métricas, em JSON canônico legível. Validado por esquema ao gravar e ao ler.
import type { Bloco, FatosSprint, Verificacao } from "../../../compartilhado/relatorios";
import { invalido } from "../erros";

export interface PacoteJson { esquema: "relatorio_pacote_v1"; hash_fatos: string; fatos: FatosSprint; blocos: Bloco[]; verificacao: Verificacao; modo_bloco: Record<string, "template" | "llm" | "humano"> }

export function pacoteJson(p: Omit<PacoteJson, "esquema">): string {
  return `${JSON.stringify({ esquema: "relatorio_pacote_v1", ...p }, null, 2)}\n`;
}
/** valida a forma mínima de um `pacote.json` lido do disco (nunca confia no arquivo). */
export function lerPacoteJson(texto: string): PacoteJson {
  let o: unknown;
  try { o = JSON.parse(texto); } catch { throw invalido("pacote.json inválido"); }
  const x = o as Partial<PacoteJson> | null;
  if (typeof x !== "object" || x === null || x.esquema !== "relatorio_pacote_v1" || typeof x.hash_fatos !== "string" || !Array.isArray(x.blocos) || typeof x.fatos !== "object" || x.fatos === null || typeof x.verificacao !== "object") throw invalido("pacote.json fora do esquema relatorio_pacote_v1");
  return x as PacoteJson;
}
