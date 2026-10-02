import { neutralizar, rotuloSeguro, MAX_NOS_PADRAO, type VistaExportavel, type VistaNeutra } from "./comum";

/** Cores já resolvidas do tema no momento da exportação (o SVG estático não lê variáveis CSS). */
export interface CoresSvg {
  fundo: string;
  no: string;
  borda: string;
  texto: string;
  aresta: string;
  heuristica: string;
  destaque: string;
}

export const CORES_SVG_PADRAO: Readonly<CoresSvg> = Object.freeze({
  fundo: "#ffffff",
  no: "#f3f4f6",
  borda: "#9ca3af",
  texto: "#111827",
  aresta: "#6b7280",
  heuristica: "#9ca3af",
  destaque: "#2563eb",
});

export interface OpcoesSvg {
  maxNos?: number;
  cores?: Partial<CoresSvg>;
}

const LARG_NO = 168;
const ALT_NO = 26;
const FOLGA_X = 72;
const FOLGA_Y = 14;
const MARGEM = 16;

export function escaparXml(texto: string): string {
  return rotuloSeguro(texto, 200).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Cor aceita no SVG: só `#rgb[a]`, `rgb()/hsl()` simples ou nome; recusa qualquer coisa que feche o atributo. */
function corSegura(c: string, padrao: string): string {
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|(?:rgb|hsl)a?\([0-9 ,.%/]+\))$/.test(c) ? c : padrao;
}

/** Níveis em camadas: BFS a partir das fontes, ignorando arestas de retorno (determinístico). */
export function niveisEmCamadas(v: VistaNeutra): number[] {
  const n = v.nos.length;
  const saida: number[][] = Array.from({ length: n }, () => []);
  const entrada = new Array<number>(n).fill(0);
  for (const a of v.arestas) {
    (saida[a.de] as number[]).push(a.para);
    entrada[a.para] = (entrada[a.para] as number) + 1;
  }
  const nivel = new Array<number>(n).fill(-1);
  const fila: number[] = [];
  for (let i = 0; i < n; i++) if (entrada[i] === 0) { nivel[i] = 0; fila.push(i); }
  const iniciar = (i: number): void => { nivel[i] = 0; fila.push(i); };
  for (let h = 0; ; h++) {
    for (; h < fila.length; h++) {
      const x = fila[h] as number;
      for (const y of saida[x] as number[]) {
        if (nivel[y] === -1) { nivel[y] = (nivel[x] as number) + 1; fila.push(y); }
      }
    }
    const resto = nivel.indexOf(-1); // só ciclos puros sem fonte
    if (resto < 0) break;
    iniciar(resto);
    h = fila.length - 1;
  }
  return nivel;
}

export function exportarSvg(vista: VistaExportavel, opcoes: OpcoesSvg = {}): string {
  const v = neutralizar(vista, opcoes.maxNos ?? MAX_NOS_PADRAO);
  const c: CoresSvg = { ...CORES_SVG_PADRAO };
  for (const k of Object.keys(CORES_SVG_PADRAO) as Array<keyof CoresSvg>) c[k] = corSegura(opcoes.cores?.[k] ?? CORES_SVG_PADRAO[k], CORES_SVG_PADRAO[k]);
  const nivel = niveisEmCamadas(v);
  const contagem = new Map<number, number>();
  const pos = v.nos.map((_, i) => {
    const nv = nivel[i] as number;
    const linha = contagem.get(nv) ?? 0;
    contagem.set(nv, linha + 1);
    return { x: MARGEM + nv * (LARG_NO + FOLGA_X), y: MARGEM + linha * (ALT_NO + FOLGA_Y) };
  });
  const colunas = Math.max(0, ...nivel) + 1;
  const linhasMax = Math.max(1, ...contagem.values());
  const largura = MARGEM * 2 + colunas * LARG_NO + (colunas - 1) * FOLGA_X;
  const altura = MARGEM * 2 + linhasMax * ALT_NO + (linhasMax - 1) * FOLGA_Y;
  const S: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Mapa lógico do código">`,
    `<title>Mapa lógico do código</title>`,
  ];
  if (v.nota !== null) S.push(`<desc>${escaparXml(v.nota)}</desc>`);
  S.push(`<rect width="${largura}" height="${altura}" fill="${c.fundo}"/>`);
  for (const a of v.arestas) {
    const p = pos[a.de] as { x: number; y: number };
    const q = pos[a.para] as { x: number; y: number };
    const x1 = p.x + LARG_NO;
    const y1 = p.y + ALT_NO / 2;
    const x2 = q.x;
    const y2 = q.y + ALT_NO / 2;
    const tr = a.exata ? "" : ` stroke-dasharray="4 3"`;
    const cor = a.exata ? c.aresta : c.heuristica;
    S.push(`<path d="M${x1} ${y1} C${x1 + FOLGA_X / 2} ${y1} ${x2 - FOLGA_X / 2} ${y2} ${x2} ${y2}" fill="none" stroke="${cor}" stroke-width="${Math.min(3, 1 + Math.log2(a.peso))}"${tr}/>`);
  }
  v.nos.forEach((n, i) => {
    const p = pos[i] as { x: number; y: number };
    S.push(`<g><title>${escaparXml(n.id)}</title><rect x="${p.x}" y="${p.y}" width="${LARG_NO}" height="${ALT_NO}" rx="5" fill="${c.no}" stroke="${n.tipo === "entrada" ? c.destaque : c.borda}"/>` +
      `<text x="${p.x + 8}" y="${p.y + 17}" font-family="sans-serif" font-size="11" fill="${c.texto}">${escaparXml(rotuloSeguro(n.rotulo, 26))}</text></g>`);
  });
  S.push("</svg>");
  return `${S.join("\n")}\n`;
}
