// Sinais da consulta prévia: "já existe?", "houve correção?", "quantas decisões valem?". Heurística determinística sobre os hits.
import type { SinaisContexto } from "../../../compartilhado/conhecimento";
import type { HitBusca } from "../busca/buscador";
import { fonteDoHit } from "./montar-comum";
import { termosDaConsulta } from "../fts";

const RE_CORRECAO = /\b(?:corrig\w*|fix(?:ed|es)?|bug|causa[\s-]*raiz|regress\w*|hotfix)\b/i;
const TIPOS_ENTREGA = new Set(["task", "handoff", "commit", "pr", "relatorio", "missao", "qa", "codigo"]);

/** Fração dos termos da consulta presentes no texto (0..1). */
export function sobreposicao(termos: readonly string[], texto: string): number {
  if (termos.length === 0) return 0;
  const t = texto.toLowerCase();
  return termos.filter((x) => t.includes(x)).length / termos.length;
}

export function classificar(hits: readonly HitBusca[], consulta: string): { sinais: SinaisContexto; porHit: Array<"ja_existe" | "correcao" | "decisao" | "aprendizado" | "outros"> } {
  const termos = termosDaConsulta(consulta).map((t) => t.toLowerCase());
  const porHit: Array<"ja_existe" | "correcao" | "decisao" | "aprendizado" | "outros"> = [];
  let ja = false;
  let corr = false;
  let decis = 0;
  const fontes = [];
  for (const h of hits) {
    const c = h.chunk;
    const ov = sobreposicao(termos, `${c.titulo} ${c.texto}`);
    const relevante = h.braco === "ambos" || ov >= 0.5;
    let cat: (typeof porHit)[number] = "outros";
    if (c.tipo === "causa_raiz" || (relevante && RE_CORRECAO.test(`${c.titulo} ${c.texto}`) && c.tipo !== "codigo")) cat = "correcao";
    else if (c.tipo === "decisao") cat = "decisao";
    else if (c.tipo === "aprendizado") cat = RE_CORRECAO.test(c.texto) ? "correcao" : "aprendizado";
    else if (TIPOS_ENTREGA.has(c.tipo) && relevante) cat = "ja_existe";
    if (cat === "ja_existe") ja = true;
    if (cat === "correcao") corr = true;
    if (cat === "decisao" || cat === "aprendizado") decis++;
    porHit.push(cat);
    if (cat !== "outros" || relevante) fontes.push(fonteDoHit(h));
  }
  return { sinais: { ja_existe: ja, houve_correcao: corr, decisoes_relacionadas: decis, fontes: fontes.slice(0, 12) }, porHit };
}
