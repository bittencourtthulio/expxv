// T-21.25 / D-347: notas de versão a partir do CHANGELOG (Keep a Changelog 1.1.0, Fase 19) ou do `git log` local. Puro e determinístico.
export const MARCA_HISTORICO = "gerada do histórico";

export class ErroNotas extends Error {}

/** Escapa HTML na origem: a UI mostra texto, e o que sai daqui nunca carrega marcação ativa. */
export function escaparHtml(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const normVersao = (v) => String(v ?? "").trim().replace(/^v(?=\d)/, "");

/** Extrai a seção `## [versão]` (até o próximo `## `). Devolve `{ versao, data, secoes: [{titulo, itens[]}] }`. */
export function extrairSecao(changelog, versao) {
  const alvo = normVersao(versao);
  if (!alvo) throw new ErroNotas("versão não informada");
  const linhas = String(changelog).replace(/\r\n?/g, "\n").split("\n");
  let i = linhas.findIndex((l) => {
    const m = /^##\s+\[([^\]]+)\](?:\s*-\s*(.*))?\s*$/.exec(l);
    return m !== null && normVersao(m[1]) === alvo;
  });
  if (i < 0) throw new ErroNotas(`seção [${alvo}] não encontrada no CHANGELOG`);
  const cab = /^##\s+\[([^\]]+)\](?:\s*-\s*(.*))?\s*$/.exec(linhas[i]);
  const secoes = [];
  let atual = null;
  for (i += 1; i < linhas.length && !/^##\s/.test(linhas[i]); i++) {
    const l = linhas[i];
    if (/^\[[^\]]+\]:\s/.test(l)) continue; // links de rodapé
    const t = /^###\s+(.+?)\s*$/.exec(l);
    if (t) { atual = { titulo: t[1], itens: [] }; secoes.push(atual); continue; }
    const it = /^\s*[-*]\s+(.*\S)\s*$/.exec(l);
    if (it) {
      if (!atual) { atual = { titulo: "Alterado", itens: [] }; secoes.push(atual); }
      atual.itens.push(it[1]);
    } else if (atual && atual.itens.length && /^\s{2,}\S/.test(l)) {
      atual.itens[atual.itens.length - 1] += ` ${l.trim()}`;
    }
  }
  const vazias = secoes.filter((s) => s.itens.length > 0);
  if (vazias.length === 0) throw new ErroNotas(`seção [${alvo}] do CHANGELOG está vazia`);
  return { versao: cab[1].trim(), data: (cab[2] ?? "").trim(), secoes: vazias, origem: "changelog" };
}

/** Nota mínima a partir do histórico. `executorGit(args[])` devolve a saída em texto (leitura local). */
export function notasDoHistorico(versao, executorGit) {
  let anterior = "";
  try { anterior = String(executorGit(["describe", "--tags", "--abbrev=0"]) ?? "").trim(); } catch { anterior = ""; }
  const faixa = anterior ? `${anterior}..HEAD` : "HEAD";
  let saida;
  try { saida = String(executorGit(["log", faixa, "--pretty=%s"]) ?? ""); } catch (e) { throw new ErroNotas(`git log falhou: ${e instanceof Error ? e.message : e}`); }
  const itens = saida.split("\n").map((s) => s.trim()).filter(Boolean);
  if (itens.length === 0) throw new ErroNotas("sem CHANGELOG e sem commits no intervalo para gerar notas");
  return { versao: normVersao(versao), data: "", secoes: [{ titulo: "Alterado", itens }], origem: "historico" };
}

/** Markdown (NOTAS.md), tudo escapado. */
export function renderizarMarkdown(n) {
  const cab = `# Notas da versão ${escaparHtml(n.versao)}${n.data ? ` - ${escaparHtml(n.data)}` : ""}`;
  const corpo = n.secoes.map((s) => `### ${escaparHtml(s.titulo)}\n\n${s.itens.map((i) => `- ${escaparHtml(i)}`).join("\n")}`).join("\n\n");
  const marca = n.origem === "historico" ? `\n_Nota ${MARCA_HISTORICO}._\n` : "";
  return `${cab}\n${marca}\n${corpo}\n`;
}

/** Texto puro para o campo de notas do manifesto/latest*.yml (a UI usa textContent). */
export function renderizarTextoPuro(n) {
  const marca = n.origem === "historico" ? `(${MARCA_HISTORICO})\n` : "";
  return `${marca}${n.secoes.map((s) => `${escaparHtml(s.titulo)}:\n${s.itens.map((i) => `- ${escaparHtml(i)}`).join("\n")}`).join("\n\n")}\n`;
}

/** Orquestra. `changelog` é o texto (ou null/undefined quando não há arquivo). */
export function gerarNotas({ versao, changelog, executorGit }) {
  const n = changelog != null ? extrairSecao(changelog, versao) : notasDoHistorico(versao, executorGit ?? (() => { throw new ErroNotas("sem CHANGELOG e sem executor git"); }));
  return { origem: n.origem, markdown: renderizarMarkdown(n), texto: renderizarTextoPuro(n) };
}
