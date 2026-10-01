/**
 * Prompts-base versionados e editáveis (T-03.06): moram em `prompts/*.md` (piloto, worker, revisor,
 * intake), com `versao: N` no front-matter, e são carregados de arquivo a cada uso. Editar o arquivo
 * muda o comportamento sem recompilar. Marcadores `{{CHAVE}}` são substituídos por `renderizarPrompt`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUTO } from "../produto";

export const NOMES_PROMPT = ["piloto", "worker", "revisor", "intake"] as const;
export type NomePrompt = (typeof NOMES_PROMPT)[number];

export interface Prompt {
  nome: NomePrompt;
  versao: number;
  texto: string;
}

export const PASTA_PROMPTS_PADRAO = join(__dirname, "prompts");

export function analisarPrompt(nome: NomePrompt, bruto: string): Prompt {
  let texto = bruto.replace(/\r\n/g, "\n");
  let versao = 1;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(texto);
  if (m !== null) {
    const v = /^versao:\s*(\d+)\s*$/m.exec(m[1] ?? "");
    if (v !== null) versao = Number(v[1]);
    texto = texto.slice(m[0].length);
  }
  return { nome, versao, texto: texto.trim() };
}

export async function carregarPrompt(nome: NomePrompt, pasta: string = PASTA_PROMPTS_PADRAO): Promise<Prompt> {
  return analisarPrompt(nome, await readFile(join(pasta, `${nome}.md`), "utf8"));
}

/** Variáveis sempre disponíveis: `PASTA` (pasta do produto no repositório). */
export function renderizarPrompt(prompt: Prompt | string, variaveis: Record<string, string> = {}): string {
  const texto = typeof prompt === "string" ? prompt : prompt.texto;
  const todas: Record<string, string> = { PASTA: PRODUTO.pastaNoProjeto, ...variaveis };
  return texto.replace(/\{\{([A-Z_]+)\}\}/g, (inteiro, chave: string) => todas[chave] ?? inteiro);
}
