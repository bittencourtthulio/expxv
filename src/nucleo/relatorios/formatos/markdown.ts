// Markdown (T-19.14): mesmo modelo do HTML; todo texto passa por `escaparMd` (nada vira marcação, link ou HTML embutido); tabelas alinhadas; links só http(s) seguros.
import { PRODUTO } from "../../produto";
import { escaparMd, urlSegura } from "../seguranca";
import type { Celula, DocumentoRel } from "./documento";

function celula(c: Celula): string {
  if (c === null) return "—";
  if (typeof c === "object") {
    const u = c.href === null ? null : urlSegura(c.href);
    return u === null ? escaparMd(c.texto) : `[${escaparMd(c.texto)}](${u.replace(/[()]/g, (x) => (x === "(" ? "%28" : "%29"))})`;
  }
  return escaparMd(c);
}

export function renderizarMarkdown(d: DocumentoRel): string {
  const o: string[] = [`# ${escaparMd(d.titulo)}`, ""];
  if (d.subtitulo) o.push(`_${escaparMd(d.subtitulo)}_`, "");
  o.push(d.estado === "rascunho" ? "> **RASCUNHO**: este texto ainda não foi revisado nem aprovado por uma pessoa." : d.estado === "interno" ? "> Documento interno da equipe." : "> Texto revisado e aprovado.", "");
  for (const s of d.secoes) {
    o.push(`## ${escaparMd(s.titulo)}`, "");
    if (s.aviso) o.push(`> ${escaparMd(s.aviso)}`, "");
    if (s.cartoes) { for (const c of s.cartoes) o.push(`- **${escaparMd(c.rotulo)}:** ${escaparMd(c.valor)}${c.nota ? ` (${escaparMd(c.nota)})` : ""}`); o.push(""); }
    for (const p of s.paragrafos ?? []) o.push(escaparMd(p), "");
    if (s.lista && s.lista.length > 0) { for (const l of s.lista) o.push(`- ${escaparMd(l)}`); o.push(""); }
    if (s.grafico) { o.push(`**${escaparMd(s.grafico.titulo)}** (${escaparMd(s.grafico.unidade)}): ${s.grafico.barras.map((b) => `${escaparMd(b.rotulo)} ${b.valor}`).join("; ")}`, ""); }
    if (s.tabela) {
      const t = s.tabela;
      o.push(`**${escaparMd(t.legenda)}**`, "", `| ${t.colunas.map(escaparMd).join(" | ")} |`, `| ${t.colunas.map(() => "---").join(" | ")} |`);
      for (const l of t.linhas) o.push(`| ${l.map(celula).join(" | ")} |`);
      o.push("");
    }
  }
  if (d.fontes && d.fontes.length > 0) { o.push("## Fontes", ""); for (const f of d.fontes) o.push(`${f.n}. ${escaparMd(f.rotulo)}`); o.push(""); }
  o.push("---", `${d.marca.rodape ? `${escaparMd(d.marca.rodape)} · ` : ""}${escaparMd(d.marca.nome)} · ${escaparMd(d.carimbo)} · gerado por ${escaparMd(PRODUTO.nome)}`, "");
  return o.join("\n");
}
