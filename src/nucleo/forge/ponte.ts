import { semSegredos, truncarTexto } from "./comum";
import type { IssueDetalhe, IssueResumo } from "./forge";

// T-06.20 · Ponte com o método. Funções PURAS: o main cria a Missão depois. O texto da issue é dado NÃO confiável:
// sai limpo de controles e segredos, limitado, e nunca vira argumento de comando (o chamador entrega por stdin/arquivo).

export type TipoPedido = "pedido" | "ocorrencia";
export interface PedidoDeIssue {
  /** `pedido` abre o prodx; `ocorrencia` abre o runx. */
  tipo: TipoPedido;
  /** Comando do método a disparar na Missão. */
  comando: "/expx:prodx" | "/expx:runx";
  /** Referência estável ligando a Missão à issue (`#123`, ou `owner/repo#123` com `repo`). */
  referencia: string;
  numero: number;
  url: string;
  titulo: string;
  /** Texto cru do pedido/ocorrência (título + corpo limpos, com a origem). */
  texto: string;
  /** Linha para o corpo do PR que fecha a issue. */
  fechamento: string;
  truncado: boolean;
}
export interface OpcoesIssueParaPedido {
  /** Força o tipo (a escolha do usuário vence a heurística). */
  tipo?: TipoPedido;
  /** `owner/repo` para referência qualificada. */
  repo?: string;
  maxChars?: number;
}
const RE_DEFEITO = /\b(bug|defeito|erro|error|crash|regress|falha|quebra|broken|incident|ocorr[eê]ncia|hotfix)/i;

// eslint-disable-next-line no-control-regex
const limpar = (s: string): string => semSegredos(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n");

/** Issue → texto + ID de referência para abrir uma Missão `pedido` (prodx) ou `ocorrencia` (runx). Nunca lança. */
export function issueParaPedido(issue: Partial<IssueDetalhe> & Partial<IssueResumo>, op: OpcoesIssueParaPedido = {}): PedidoDeIssue {
  const numero = typeof issue.numero === "number" && Number.isSafeInteger(issue.numero) ? issue.numero : 0;
  const titulo = limpar(typeof issue.titulo === "string" ? issue.titulo : "").trim().slice(0, 300) || "(sem título)";
  const labels = Array.isArray(issue.labels) ? issue.labels.filter((l): l is string => typeof l === "string") : [];
  const tipo: TipoPedido = op.tipo ?? (labels.some((l) => RE_DEFEITO.test(l)) || RE_DEFEITO.test(titulo) ? "ocorrencia" : "pedido");
  const referencia = op.repo && /^[\w.-]+(\/[\w.-]+)+$/.test(op.repo) ? `${op.repo}#${numero}` : `#${numero}`;
  const url = typeof issue.url === "string" && /^https?:\/\//i.test(issue.url) ? semSegredos(issue.url) : "";
  const corpo = truncarTexto(limpar(typeof issue.corpo === "string" ? issue.corpo : "").trim(), op.maxChars ?? 8000);
  const texto = [`${titulo}`, "", corpo.texto || "(sem descrição)", "", `Origem: issue ${referencia}${url ? ` — ${url}` : ""}`, labels.length ? `Labels: ${labels.map((l) => limpar(l)).join(", ")}` : ""].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trimEnd();
  return { tipo, comando: tipo === "ocorrencia" ? "/expx:runx" : "/expx:prodx", referencia, numero, url, titulo, texto, fechamento: numero > 0 ? `Closes ${referencia}` : "", truncado: corpo.truncado };
}

/** Issues que o corpo de um PR fecha (`Closes #7`, `fixes #8`, `Resolves owner/repo#9`). */
export function issuesFechadasPorPr(corpo: string): number[] {
  const achados = new Set<number>();
  for (const m of corpo.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#(\d{1,9})\b/gi)) achados.add(Number(m[1]));
  return [...achados];
}
