// Gráfico de barras em SVG inline (T-19.16, versão enxuta): sem script, sem cor literal (classes estilizadas pelo CSS com as variáveis da marca), com `<title>`/`<desc>` e
// a tabela equivalente sempre ao lado (quem emite o documento inclui). Todo texto é escapado.
import { escaparHtml } from "../seguranca";
import type { Grafico } from "./documento";

export function svgBarras(g: Grafico, id: string): string {
  const max = Math.max(1, ...g.barras.map((b) => b.valor));
  const L = 520;
  const linha = 26;
  const alt = 18 + g.barras.length * linha;
  const rotW = 150;
  const barras = g.barras.slice(0, 40).map((b, i) => {
    const w = Math.max(0, Math.round(((L - rotW - 70) * b.valor) / max));
    const y = 10 + i * linha;
    return `<g><text x="0" y="${y + 13}" class="g-rot">${escaparHtml(b.rotulo.slice(0, 24))}</text><rect x="${rotW}" y="${y}" width="${w}" height="16" class="${b.destaque === true ? "g-barra g-dest" : "g-barra"}"/><text x="${rotW + w + 6}" y="${y + 13}" class="g-val">${escaparHtml(String(b.valor))} ${escaparHtml(g.unidade)}</text></g>`;
  }).join("");
  return `<svg role="img" aria-labelledby="${escaparHtml(id)}-t ${escaparHtml(id)}-d" viewBox="0 0 ${L} ${alt}" class="grafico"><title id="${escaparHtml(id)}-t">${escaparHtml(g.titulo)}</title><desc id="${escaparHtml(id)}-d">${escaparHtml(g.descricao)}</desc>${barras}</svg>`;
}
