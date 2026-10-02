// Extração DETERMINÍSTICA de aprendizados (DEC-5, custo zero): seções "Causa raiz"/"Decisões" dos relatórios, memory.decision/learning,
// handoff parcial|bloqueado|falhou → armadilha, QA reprovado → armadilha, commit `fix`/`corrige` → correção ligada aos arquivos.
import type { CandidatoAprendizado, DocumentoEntrada } from "../tipos";

const RE_SECAO_CAUSA = /^#{1,4}\s*(?:\d+[.)]\s*)?causa[\s-]*raiz\b/i;
const RE_SECAO_DECISAO = /^#{1,4}\s*(?:\d+[.)]\s*)?decis(?:ão|ões|ao|oes)\b/i;
const RE_TITULO = /^#{1,6}\s/;
const RE_FIX = /^\s*(?:fix|corrige|corrigido|bugfix|hotfix)(?:\(|:|\s)/i;
const RE_HANDOFF_RUIM = /\b(?:parcial|bloqueado|falhou|failed|blocked|partial)\b/i;
const RE_QA_REPROVADO = /\b(?:reprovad[oa]|reprovação|failed|reprovar)\b/i;

const limpar = (t: string): string => t.replace(/\s+/g, " ").replace(/^[-*+]\s+/, "").trim();
const titulo = (t: string): string => limpar(t).slice(0, 120);

function itensDaSecao(linhas: string[]): string[] {
  const itens: string[] = [];
  let paragrafo: string[] = [];
  const fechar = (): void => {
    if (paragrafo.length > 0) itens.push(limpar(paragrafo.join(" ")));
    paragrafo = [];
  };
  for (const l of linhas) {
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(l)) {
      fechar();
      paragrafo.push(l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
    } else if (l.trim() === "") fechar();
    else paragrafo.push(l);
  }
  fechar();
  return itens.filter((i) => i.length >= 12);
}

export function extrairAprendizados(doc: DocumentoEntrada, extras: { memoria?: "decision" | "learning" } = {}): CandidatoAprendizado[] {
  const prov = { mission_id: doc.mission_id, task_ref: doc.task_ref, pane_id: doc.pane_id, cli: doc.cli, modelo: doc.modelo_autor, origem: doc.origem, em: doc.ocorrido_em };
  const fonte = doc.fonte;
  const saida: CandidatoAprendizado[] = [];
  const add = (tipo: CandidatoAprendizado["tipo"], texto: string, tit?: string, arquivos?: string[]): void => {
    const t = limpar(texto).slice(0, 1000);
    if (t.length < 12) return;
    saida.push({ tipo, titulo: titulo(tit ?? t), texto: t, fonte, proveniencia: prov, arquivos });
  };

  if (extras.memoria === "decision") add("decisao", doc.texto, doc.titulo);
  else if (extras.memoria === "learning") add("padrao", doc.texto, doc.titulo);

  if (doc.formato === "markdown" && (doc.tipo === "relatorio" || doc.tipo === "causa_raiz" || doc.tipo === "qa" || doc.tipo === "doc" || doc.tipo === "decisao" || doc.tipo === "handoff")) {
    const linhas = doc.texto.split("\n");
    let alvo: "causa_raiz" | "decisao" | null = null;
    let atual: string[] = [];
    const fechar = (): void => {
      if (alvo) for (const it of itensDaSecao(atual).slice(0, 7)) add(alvo, it);
      atual = [];
    };
    let cerca = false;
    for (const l of linhas) {
      if (/^\s{0,3}(`{3,}|~{3,})/.test(l)) cerca = !cerca;
      if (!cerca && RE_TITULO.test(l)) {
        fechar();
        alvo = RE_SECAO_CAUSA.test(l) ? "causa_raiz" : RE_SECAO_DECISAO.test(l) ? "decisao" : null;
      } else if (alvo) atual.push(l);
    }
    fechar();
  }
  if (doc.tipo === "handoff" && RE_HANDOFF_RUIM.test(doc.titulo)) add("armadilha", `${doc.titulo}. ${doc.texto}`, doc.titulo);
  if (doc.tipo === "qa" && RE_QA_REPROVADO.test(`${doc.titulo}\n${doc.texto.slice(0, 600)}`)) add("armadilha", `QA reprovou: ${doc.texto.slice(0, 700)}`, `QA reprovou: ${doc.titulo}`);
  if (doc.tipo === "commit" && RE_FIX.test(doc.titulo)) add("correcao", doc.titulo, doc.titulo, doc.arquivos ? [...doc.arquivos] : undefined);

  // dedupe dentro do próprio documento
  const vistos = new Set<string>();
  return saida.filter((c) => (vistos.has(`${c.tipo}|${c.texto}`) ? false : (vistos.add(`${c.tipo}|${c.texto}`), true)));
}

/** Aprendizado nasce `ativo` se vem de fonte humana ou de relatório do método; senão `candidato` (anti-envenenamento). */
export function estadoInicial(c: CandidatoAprendizado, doTipoDocumento: string | null = null): "candidato" | "ativo" {
  if (c.fonte === "usuario") return "ativo";
  if (c.fonte === "sistema" && doTipoDocumento !== null && ["relatorio", "causa_raiz", "qa", "decisao", "doc"].includes(doTipoDocumento)) return "ativo";
  return "candidato";
}
