/**
 * Briefing do card (T-03.03): `.md` em `<pasta do produto>/missoes/<mission>/briefing-<task>.md` com as
 * seções `Contrato` (o que o piloto pede), `Resultado` (o worker preenche no MESMO arquivo) e
 * `Executado_por` (quem de fato executou). O worker nasce com contexto limpo: o briefing é o contexto.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { Papel } from "../dominio";
import { ID_DE_ARQUIVO, caminhoBriefing, gravarNaPastaDoProduto, resolverDentro } from "./pasta";

export const SECOES_BRIEFING = ["Contrato", "Resultado", "Executado_por"] as const;
export type SecaoBriefing = (typeof SECOES_BRIEFING)[number];

export interface DadosBriefing {
  mission_id: string;
  task_ref: string;
  titulo: string;
  papel: Papel;
  contrato: string;
  /** agente planejado pelo piloto (quando há squad) */
  agente_planejado?: string | null;
}

const PLACEHOLDER_RESULTADO = "_(o worker preenche ao concluir)_";
const PLACEHOLDER_EXECUTADO = "_(preenchido pelo worker: CLI, modelo e Pane que executaram)_";

export function gerarBriefing(d: DadosBriefing): string {
  const planejado = d.agente_planejado ? `\nAgente planejado: ${d.agente_planejado}\n` : "";
  return [
    `# Card ${d.task_ref}: ${d.titulo.replace(/\s+/g, " ").trim()}`,
    "",
    `Missão: ${d.mission_id} · Papel: ${d.papel}${planejado}`,
    "## Contrato",
    "",
    d.contrato.trim(),
    "",
    "## Resultado",
    "",
    PLACEHOLDER_RESULTADO,
    "",
    "## Executado_por",
    "",
    PLACEHOLDER_EXECUTADO,
    "",
  ].join("\n");
}

/** Divide o briefing pelas três seções; seção ausente vira `null`. */
export function secoesDoBriefing(md: string): Record<SecaoBriefing, string | null> {
  const saida: Record<SecaoBriefing, string | null> = { Contrato: null, Resultado: null, Executado_por: null };
  const partes = md.split(/^## /m).slice(1);
  for (const parte of partes) {
    const quebra = parte.indexOf("\n");
    const titulo = (quebra < 0 ? parte : parte.slice(0, quebra)).trim();
    if ((SECOES_BRIEFING as readonly string[]).includes(titulo)) {
      saida[titulo as SecaoBriefing] = (quebra < 0 ? "" : parte.slice(quebra + 1)).trim();
    }
  }
  return saida;
}

/** Troca o corpo de uma seção, preservando as demais. */
export function preencherSecao(md: string, secao: SecaoBriefing, conteudo: string): string {
  const linhas = md.split("\n");
  const inicio = linhas.findIndex((l) => l.trim() === `## ${secao}`);
  if (inicio < 0) return `${md.trimEnd()}\n\n## ${secao}\n\n${conteudo.trim()}\n`;
  let fim = linhas.findIndex((l, i) => i > inicio && l.startsWith("## "));
  if (fim < 0) fim = linhas.length;
  const novo = [...linhas.slice(0, inicio + 1), "", conteudo.trim(), "", ...linhas.slice(fim)];
  return `${novo.join("\n").trimEnd()}\n`;
}

/** Grava o briefing do card e devolve o caminho relativo à raiz. */
export async function gravarBriefing(raiz: string, d: DadosBriefing): Promise<string> {
  if (!ID_DE_ARQUIVO.test(d.mission_id) || !ID_DE_ARQUIVO.test(d.task_ref)) throw new Error("Identificador inválido para o briefing.");
  const rel = caminhoBriefing(d.mission_id, d.task_ref);
  await gravarNaPastaDoProduto(raiz, rel, gerarBriefing(d));
  return rel;
}

export async function lerBriefing(raiz: string, rel: string): Promise<string | null> {
  const abs = resolverDentro(raiz, rel);
  if (abs === null) return null;
  try {
    return await readFile(abs, "utf8");
  } catch {
    return null;
  }
}

/** O worker (ou o serviço, em nome dele) preenche Resultado e Executado_por no mesmo arquivo. */
export async function registrarResultadoNoBriefing(raiz: string, rel: string, r: { resultado: string; executado_por: string }): Promise<boolean> {
  const abs = resolverDentro(raiz, rel);
  const atual = abs === null ? null : await lerBriefing(raiz, rel);
  if (abs === null || atual === null) return false;
  const novo = preencherSecao(preencherSecao(atual, "Resultado", r.resultado), "Executado_por", r.executado_por);
  await writeFile(abs, novo, "utf8");
  return true;
}
