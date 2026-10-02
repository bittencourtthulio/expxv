// HTML AUTOCONTIDO (T-19.15): um único arquivo, sem JavaScript, sem rede, com CSP restritiva; CSS inline com variáveis de marca (contraste AA garantido), tema claro/escuro por
// `prefers-color-scheme` (impressão sempre clara), sumário por âncoras e CSS de impressão (A4). TODO conteúdo é escapado pelo construtor; links só http(s) sem credencial.
import { PRODUTO } from "../../produto";
import { escaparHtml, urlSegura } from "../seguranca";
import type { Celula, DocumentoRel, SecaoDoc } from "./documento";
import { svgBarras } from "./graficos";

export const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
}
export const contraste = (a: string, b: string): number => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
const mistura = (hex: string, alvo: number, f: number): string => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - f) + alvo * f).toString(16).padStart(2, "0")).join("")}`;
/** cor da marca válida (#rrggbb) ajustada até ter contraste AA (>= 4,5) com o fundo; o retorno diz se precisou ajustar. */
export function corAcessivel(cor: string, fundo: string): { cor: string; ajustada: boolean } {
  let c = /^#[0-9a-f]{6}$/i.test(cor) ? cor.toLowerCase() : "#2563eb";
  let ajustada = c !== cor.toLowerCase();
  const escurecer = luminancia(fundo) > 0.5;
  for (let i = 0; i < 40 && contraste(c, fundo) < 4.5; i++) { c = mistura(c, escurecer ? 0 : 255, 0.1); ajustada = true; }
  return { cor: c, ajustada };
}

function css(cor: string): string {
  const claro = corAcessivel(cor, "#ffffff").cor;
  const escuro = corAcessivel(cor, "#0f172a").cor;
  return `:root{--marca:${claro};--fundo:#fff;--texto:#0f172a;--suave:#475569;--borda:#cbd5e1;--cartao:#f8fafc}
@media (prefers-color-scheme:dark){:root{--marca:${escuro};--fundo:#0f172a;--texto:#f1f5f9;--suave:#cbd5e1;--borda:#334155;--cartao:#1e293b}}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--texto);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.75rem;margin:.2em 0;color:var(--marca)}h2{font-size:1.25rem;border-bottom:2px solid var(--marca);padding-bottom:4px;margin-top:2em}
.sub{color:var(--suave);margin:0 0 1em}.faixa{border:1px solid var(--borda);border-left:6px solid var(--marca);background:var(--cartao);padding:8px 12px;border-radius:4px;margin:12px 0}
nav.sumario ul{columns:2;padding-left:18px}nav.sumario a{color:var(--marca)}a{color:var(--marca)}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:.92rem}caption{text-align:left;font-weight:600;padding:4px 0}th,td{border:1px solid var(--borda);padding:6px 8px;text-align:left;vertical-align:top}thead th{background:var(--cartao)}
.cartoes{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.cartao{border:1px solid var(--borda);background:var(--cartao);border-radius:6px;padding:10px 12px;break-inside:avoid}.cartao b{display:block;font-size:1.4rem}.cartao span{color:var(--suave);font-size:.85rem}
.grafico{width:100%;max-width:560px;height:auto}.g-rot,.g-val{font-size:11px;fill:var(--texto)}.g-barra{fill:var(--suave)}.g-dest{fill:var(--marca)}
footer{margin-top:3em;border-top:1px solid var(--borda);padding-top:8px;color:var(--suave);font-size:.85rem}.fonte{font-size:.8rem;color:var(--suave)}
@page{size:A4;margin:18mm 16mm}
@media print{:root{--fundo:#fff;--texto:#000;--suave:#333;--borda:#999;--cartao:#fff}body{font-size:11pt}thead{display:table-header-group}tr,.cartao,figure{break-inside:avoid}h2{break-after:avoid}a[href^="http"]::after{content:" (" attr(href) ")";font-size:.8em}nav.sumario{display:none}}`;
}

function celula(c: Celula): string {
  if (c === null) return "—";
  if (typeof c === "object") {
    const u = c.href === null ? null : urlSegura(c.href);
    return u === null ? escaparHtml(c.texto) : `<a href="${escaparHtml(u)}" target="_blank" rel="noopener noreferrer">${escaparHtml(c.texto)}</a>`;
  }
  return escaparHtml(c);
}

function secao(s: SecaoDoc): string {
  const p: string[] = [`<section id="${escaparHtml(s.id)}"><h2>${escaparHtml(s.titulo)}</h2>`];
  if (s.aviso) p.push(`<p class="faixa" role="note">${escaparHtml(s.aviso)}</p>`);
  if (s.cartoes) p.push(`<div class="cartoes">${s.cartoes.map((c) => `<div class="cartao"><b>${escaparHtml(c.valor)}</b><span>${escaparHtml(c.rotulo)}${c.nota ? ` — ${escaparHtml(c.nota)}` : ""}</span></div>`).join("")}</div>`);
  for (const t of s.paragrafos ?? []) p.push(`<p>${escaparHtml(t)}</p>`);
  if (s.lista && s.lista.length > 0) p.push(`<ul>${s.lista.map((l) => `<li>${escaparHtml(l)}</li>`).join("")}</ul>`);
  if (s.grafico) p.push(`<figure>${svgBarras(s.grafico, `g-${s.id}`)}</figure>`);
  if (s.tabela) {
    const t = s.tabela;
    p.push(`<table><caption>${escaparHtml(t.legenda)}</caption><thead><tr>${t.colunas.map((c) => `<th scope="col">${escaparHtml(c)}</th>`).join("")}</tr></thead><tbody>${t.linhas.map((l) => `<tr>${l.map((c) => `<td>${celula(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
  }
  p.push("</section>");
  return p.join("");
}

export function renderizarHtml(d: DocumentoRel): string {
  const faixa = d.estado === "rascunho" ? "RASCUNHO — este texto ainda não foi revisado nem aprovado por uma pessoa." : d.estado === "interno" ? "Documento interno da equipe." : "Texto revisado e aprovado.";
  const sumario = d.secoes.length > 3 ? `<nav class="sumario" aria-label="Sumário"><ul>${d.secoes.map((s) => `<li><a href="#${escaparHtml(s.id)}">${escaparHtml(s.titulo)}</a></li>`).join("")}</ul></nav>` : "";
  const fontes = d.fontes && d.fontes.length > 0 ? `<section id="fontes"><h2>Fontes</h2><ol class="fonte">${d.fontes.map((f) => `<li>${escaparHtml(f.rotulo)}</li>`).join("")}</ol></section>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="no-referrer"><meta name="description" content="${escaparHtml(d.descricao.slice(0, 200))}"><title>${escaparHtml(d.titulo)}</title><style>${css(d.marca.cor)}</style></head><body><main><header><h1>${escaparHtml(d.titulo)}</h1>${d.subtitulo ? `<p class="sub">${escaparHtml(d.subtitulo)}</p>` : ""}<p class="faixa" role="note">${escaparHtml(faixa)}</p></header>${sumario}${d.secoes.map(secao).join("")}${fontes}<footer>${d.marca.rodape ? `${escaparHtml(d.marca.rodape)} · ` : ""}${escaparHtml(d.marca.nome)} · ${escaparHtml(d.carimbo)} · gerado por ${escaparHtml(PRODUTO.nome)}</footer></main></body></html>`;
}
