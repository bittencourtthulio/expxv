// Diff -> linhas planas (puro): a visualização é virtualizada por linha, então o diff vira UM vetor.
import type { Diff, DiffArquivo, Hunk, LinhaDiff } from "../../../../nucleo/vcs/tipos";

export type LinhaPlana =
  | { k: "arq"; arq: number; f: DiffArquivo }
  | { k: "hunk"; arq: number; hunk: number; h: Hunk }
  | { k: "linha"; arq: number; hunk: number; idx: number; l: LinhaDiff }
  | { k: "aviso"; arq: number; texto: string };

export interface OpcoesAchatar {
  ignorarEspaco?: boolean;
  /** Mostra o conteúdo mesmo de arquivos acima do limite (`grande`). */
  expandirGrandes?: boolean;
  /** Arquivo com mais linhas que isto fica recolhido até o usuário pedir. */
  limiteLinhasPorArquivo?: number;
}

export const LIMITE_LINHAS_ARQUIVO = 20_000;

const norm = (t: string): string => t.replace(/\s+/g, "");

/** Com "ignorar espaços", par `-`/`+` que só difere em espaço vira contexto (usa a versão nova). */
function sobSemEspaco(linhas: readonly LinhaDiff[]): LinhaDiff[] {
  const saida: LinhaDiff[] = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i] as LinhaDiff;
    if (l.tipo !== "del") { saida.push(l); i++; continue; }
    let j = i;
    while (j < linhas.length && (linhas[j] as LinhaDiff).tipo === "del") j++;
    let k = j;
    while (k < linhas.length && (linhas[k] as LinhaDiff).tipo === "add") k++;
    const dels = linhas.slice(i, j);
    const adds = linhas.slice(j, k);
    const n = Math.min(dels.length, adds.length);
    const iguais = n > 0 && dels.slice(0, n).every((d, x) => norm(d.texto) === norm((adds[x] as LinhaDiff).texto));
    if (iguais && dels.length === adds.length) {
      for (const a of adds) saida.push({ tipo: "ctx", texto: a.texto, antiga: dels[adds.indexOf(a)]?.antiga ?? null, nova: a.nova });
    } else saida.push(...dels, ...adds);
    i = k;
  }
  return saida;
}

export function achatar(diff: Diff, op: OpcoesAchatar = {}): LinhaPlana[] {
  const limite = op.limiteLinhasPorArquivo ?? LIMITE_LINHAS_ARQUIVO;
  const saida: LinhaPlana[] = [];
  diff.arquivos.forEach((f, arq) => {
    saida.push({ k: "arq", arq, f });
    if (f.binario) { saida.push({ k: "aviso", arq, texto: "Arquivo binário alterado (conteúdo não é carregado)." }); return; }
    if (f.submodulo !== undefined) { saida.push({ k: "aviso", arq, texto: "Submódulo: o ponteiro de commit mudou." }); return; }
    if (f.soFimDeLinha) saida.push({ k: "aviso", arq, texto: "Só o fim de linha mudou (conteúdo igual)." });
    const total = f.hunks.reduce((a, h) => a + h.linhas.length, 0);
    if (total > limite && op.expandirGrandes !== true) { saida.push({ k: "aviso", arq, texto: `Diff grande (${total.toLocaleString("pt-BR")} linhas): recolhido. Use "Mostrar tudo".` }); return; }
    f.hunks.forEach((h, hunk) => {
      saida.push({ k: "hunk", arq, hunk, h });
      const linhas = op.ignorarEspaco === true ? sobSemEspaco(h.linhas) : h.linhas;
      // o índice de estágio refere-se a `Hunk.linhas` ORIGINAL: com filtro de espaço o estágio por linha fica desligado (idx -1)
      const filtrado = op.ignorarEspaco === true;
      linhas.forEach((l, idx) => saida.push({ k: "linha", arq, hunk, idx: filtrado ? -1 : idx, l }));
      if (h.incompleto === true) saida.push({ k: "aviso", arq, texto: "Saída truncada neste hunk." });
    });
  });
  if (diff.truncado) saida.push({ k: "aviso", arq: Math.max(0, diff.arquivos.length - 1), texto: "Diff truncado pelo limite de bytes." });
  return saida;
}

export type LinhaLado =
  | Exclude<LinhaPlana, { k: "linha" }>
  | { k: "par"; arq: number; hunk: number; esq: { l: LinhaDiff; idx: number } | null; dir: { l: LinhaDiff; idx: number } | null };

/** Lado a lado: bloco de remoções pareado com o bloco de adições seguinte. */
export function paraLadoALado(planas: readonly LinhaPlana[]): LinhaLado[] {
  const saida: LinhaLado[] = [];
  let i = 0;
  while (i < planas.length) {
    const p = planas[i] as LinhaPlana;
    if (p.k !== "linha") { saida.push(p); i++; continue; }
    if (p.l.tipo === "ctx") { saida.push({ k: "par", arq: p.arq, hunk: p.hunk, esq: { l: p.l, idx: p.idx }, dir: { l: p.l, idx: p.idx } }); i++; continue; }
    const dels: Array<{ l: LinhaDiff; idx: number }> = [];
    const adds: Array<{ l: LinhaDiff; idx: number }> = [];
    while (i < planas.length && (planas[i] as LinhaPlana).k === "linha" && ((planas[i] as Extract<LinhaPlana, { k: "linha" }>).l.tipo === "del" || (planas[i] as Extract<LinhaPlana, { k: "linha" }>).l.tipo === "mod") && (planas[i] as Extract<LinhaPlana, { k: "linha" }>).hunk === p.hunk) {
      const x = planas[i] as Extract<LinhaPlana, { k: "linha" }>;
      dels.push({ l: x.l, idx: x.idx });
      i++;
    }
    while (i < planas.length && (planas[i] as LinhaPlana).k === "linha" && (planas[i] as Extract<LinhaPlana, { k: "linha" }>).l.tipo === "add" && (planas[i] as Extract<LinhaPlana, { k: "linha" }>).hunk === p.hunk) {
      const x = planas[i] as Extract<LinhaPlana, { k: "linha" }>;
      adds.push({ l: x.l, idx: x.idx });
      i++;
    }
    if (dels.length === 0 && adds.length === 0) { i++; continue; }
    const n = Math.max(dels.length, adds.length);
    for (let x = 0; x < n; x++) saida.push({ k: "par", arq: p.arq, hunk: p.hunk, esq: dels[x] ?? null, dir: adds[x] ?? null });
  }
  return saida;
}
