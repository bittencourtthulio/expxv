// `buildBrief` PURO (T-08.11): sem I/O e sem relógio (`agora` vem na entrada). Mesma entrada = mesma saída byte a byte.
// Algoritmo do plano: checkpoint + top 8 decisões + 8 riscos + 10 eventos; uma linha por entrada; redação DE NOVO; se passar do
// orçamento, trunca eventos → decisões → riscos e NUNCA o checkpoint (corte duro só no texto do checkpoint, com `…[truncado]`).
import { BRIEF_MAX, BRIEF_MIN, DECISOES_NO_BRIEF, EVENTOS_NO_BRIEF, LINHA_MAX, RISCOS_NO_BRIEF } from "./constantes";
import { redigirTexto } from "./redacao";
import type { ItemBrief } from "./repo";
import { envelope, linhaSegura } from "./sanear-brief";
import type { TipoMemoria } from "./tipos";

export type { ItemBrief };

export interface EntradaBrief {
  display_id: number | null;
  /** ISO UTC (vem do chamador; a função não lê o relógio). */
  agora: string;
  checkpoint: ItemBrief | null;
  decisoes: ItemBrief[];
  riscos: ItemBrief[];
  eventos: ItemBrief[];
  orcamento_chars: number;
  memox_instalado: boolean;
}

export interface BriefMontado {
  markdown: string;
  caracteres: number;
  truncado: boolean;
}

export const ROTULO_TIPO: Readonly<Record<TipoMemoria, string>> = {
  checkpoint: "checkpoint", decisao: "decisão", risco: "risco", evento: "evento", fato: "fato", preferencia: "preferência",
  handoff: "handoff", aprendizado: "aprendizado", resumo: "resumo",
};

const MARCA_CORTE = "…[truncado]";
const data = (iso: string): string => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "????-??-??");
const cmpRecente = (a: ItemBrief, b: ItemBrief): number => (a.atualizado_em < b.atualizado_em ? 1 : a.atualizado_em > b.atualizado_em ? -1 : 0);
const cmpImportancia = (a: ItemBrief, b: ItemBrief): number => b.importancia - a.importancia || cmpRecente(a, b);

/** Ordena de forma estável e determinística (desempate pela posição original). */
function topo(itens: ItemBrief[], n: number, cmp: (a: ItemBrief, b: ItemBrief) => number): ItemBrief[] {
  return itens
    .map((it, i) => ({ it, i }))
    .sort((x, y) => cmp(x.it, y.it) || x.i - y.i)
    .slice(0, n)
    .map((x) => x.it);
}

export const cabecalhoLinha = (it: ItemBrief): string => `- [${ROTULO_TIPO[it.tipo] ?? "entrada"} · ${it.fonte} · ${data(it.atualizado_em)}] `;
export const linhaDeItem = (it: ItemBrief, max: number = LINHA_MAX): string => {
  const cab = cabecalhoLinha(it);
  return cab + linhaSegura(redigirTexto(it.conteudo).texto, Math.max(20, max - Array.from(cab).length));
};

export function buildBrief(e: EntradaBrief): BriefMontado {
  const orc = Math.min(BRIEF_MAX, Math.max(BRIEF_MIN, Math.floor(e.orcamento_chars)));
  const decisoes = topo(e.decisoes, DECISOES_NO_BRIEF, cmpImportancia).map((i) => linhaDeItem(i));
  const riscos = topo(e.riscos, RISCOS_NO_BRIEF, cmpImportancia).map((i) => linhaDeItem(i));
  const eventos = topo(e.eventos, EVENTOS_NO_BRIEF, cmpRecente).map((i) => linhaDeItem(i));
  const cp = e.checkpoint;
  let cpCab = cp ? cabecalhoLinha(cp) : "";
  let cpTexto = cp ? linhaSegura(redigirTexto(cp.conteudo).texto, 1000) : "";
  let truncado = false;

  const montar = (): string => {
    const linhaCp = cp ? `${cpCab}${cpTexto}` : "(sem checkpoint)";
    const secao = (titulo: string, ls: string[], vazio: string): string[] => [`## ${titulo}`, ...(ls.length > 0 ? ls : [vazio])];
    const corpo = [
      ...secao("Onde parou (último checkpoint)", [linhaCp], ""),
      ...secao("Decisões", decisoes, "(nenhuma registrada)"),
      ...secao("Riscos e o que não pode esquecer", riscos, "(nenhum registrado)"),
      ...secao("Linha do tempo recente", eventos, "(nada recente)"),
    ].join("\n");
    // defesa em profundidade: redação do corpo inteiro antes de entregar
    return envelope({ display_id: e.display_id, geradaEm: e.agora, corpo: redigirTexto(corpo).texto, ponteiroMemox: e.memox_instalado });
  };

  let md = montar();
  while (md.length > orc) {
    if (eventos.length > 0) eventos.pop();
    else if (decisoes.length > 0) decisoes.pop();
    else if (riscos.length > 0) riscos.pop();
    else break;
    truncado = true;
    md = montar();
  }
  if (md.length > orc && cp) {
    truncado = true;
    // corte duro, só no texto do checkpoint
    for (let i = 0; i < 40 && md.length > orc; i++) {
      const pts = Array.from(cpTexto.endsWith(MARCA_CORTE) ? cpTexto.slice(0, -MARCA_CORTE.length) : cpTexto);
      const sobra = md.length - orc;
      const novo = Math.max(0, pts.length - sobra - MARCA_CORTE.length - 1);
      cpTexto = `${pts.slice(0, novo).join("").trimEnd()}${MARCA_CORTE}`;
      md = montar();
      if (novo === 0) break;
    }
    if (md.length > orc) {
      cpCab = "- ";
      cpTexto = MARCA_CORTE;
      md = montar();
    }
  }
  return { markdown: md, caracteres: md.length, truncado };
}
