// Modelo puro das anotações (Fase 11, T-11.18): seta, caneta vermelha, retângulo e texto, com desfazer/refazer. O desenho no Canvas 2D recebe `ctx` mínimo (testável sem DOM).
export type Ferramenta = "seta" | "caneta" | "retangulo" | "texto";
export interface Ponto { x: number; y: number }
export type Forma =
  | { tipo: "seta"; de: Ponto; para: Ponto }
  | { tipo: "caneta"; pontos: Ponto[] }
  | { tipo: "retangulo"; de: Ponto; para: Ponto }
  | { tipo: "texto"; em: Ponto; texto: string };

/** vermelho nomeado (o Canvas 2D não lê tokens CSS): a anotação precisa saltar aos olhos em qualquer tema. */
export const COR_ANOTACAO = "crimson";
export const LARGURA_TRACO = 3;
export const TEXTO_MAX = 200;

export interface Historico {
  formas: readonly Forma[];
  refazer: readonly Forma[];
}
export const historicoVazio = (): Historico => ({ formas: [], refazer: [] });

export function adicionar(h: Historico, f: Forma): Historico {
  if (f.tipo === "texto" && (f.texto.trim() === "" || f.texto.length > TEXTO_MAX)) return h;
  if (f.tipo === "caneta" && f.pontos.length < 2) return h;
  return { formas: [...h.formas, f], refazer: [] };
}
export function desfazer(h: Historico): Historico {
  const u = h.formas[h.formas.length - 1];
  return u === undefined ? h : { formas: h.formas.slice(0, -1), refazer: [...h.refazer, u] };
}
export function refazer(h: Historico): Historico {
  const u = h.refazer[h.refazer.length - 1];
  return u === undefined ? h : { formas: [...h.formas, u], refazer: h.refazer.slice(0, -1) };
}
/** Há algo para gravar? (autosave só com mudança). */
export const temMudanca = (h: Historico): boolean => h.formas.length > 0;

export interface Ctx2D {
  strokeStyle: string; fillStyle: string; lineWidth: number; lineCap: string; lineJoin: string; font: string; textBaseline: string;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void; closePath(): void; fill(): void;
  strokeRect(x: number, y: number, w: number, h: number): void; fillText(t: string, x: number, y: number): void;
}

/** Pontas da seta (duas hastes a 25° do corpo). */
export function pontasDaSeta(de: Ponto, para: Ponto, tamanho = 16): [Ponto, Ponto] {
  const ang = Math.atan2(para.y - de.y, para.x - de.x);
  const abre = Math.PI / 7;
  return [
    { x: para.x - tamanho * Math.cos(ang - abre), y: para.y - tamanho * Math.sin(ang - abre) },
    { x: para.x - tamanho * Math.cos(ang + abre), y: para.y - tamanho * Math.sin(ang + abre) },
  ];
}

export function desenhar(ctx: Ctx2D, formas: readonly Forma[], escala = 1): void {
  ctx.strokeStyle = COR_ANOTACAO;
  ctx.fillStyle = COR_ANOTACAO;
  ctx.lineWidth = LARGURA_TRACO * escala;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const f of formas) {
    if (f.tipo === "seta") {
      ctx.beginPath(); ctx.moveTo(f.de.x * escala, f.de.y * escala); ctx.lineTo(f.para.x * escala, f.para.y * escala); ctx.stroke();
      const [a, b] = pontasDaSeta(f.de, f.para, 16);
      ctx.beginPath(); ctx.moveTo(f.para.x * escala, f.para.y * escala); ctx.lineTo(a.x * escala, a.y * escala); ctx.moveTo(f.para.x * escala, f.para.y * escala); ctx.lineTo(b.x * escala, b.y * escala); ctx.stroke();
    } else if (f.tipo === "caneta") {
      ctx.beginPath();
      f.pontos.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * escala, p.y * escala) : ctx.lineTo(p.x * escala, p.y * escala)));
      ctx.stroke();
    } else if (f.tipo === "retangulo") {
      ctx.strokeRect(Math.min(f.de.x, f.para.x) * escala, Math.min(f.de.y, f.para.y) * escala, Math.abs(f.para.x - f.de.x) * escala, Math.abs(f.para.y - f.de.y) * escala);
    } else {
      ctx.font = `${Math.round(18 * escala)}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(f.texto, f.em.x * escala, f.em.y * escala);
    }
  }
}
