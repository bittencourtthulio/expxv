// Lógica pura da captura no renderer (Fase 11): mapeamento viewport -> coordenadas lógicas do display, seleção, textos e dataURL. Sem DOM nem IPC.
import type { CodigoErroCaptura, RetanguloLogico } from "../../../compartilhado/captura";
import { LIMITES_CAPTURA } from "../../../compartilhado/captura";

export interface Ajuste { x: number; y: number; escala: number }

/** `object-fit: contain` de uma imagem lógica (lw×lh) numa área (vw×vh): deslocamento e escala (px de tela por px lógico). */
export function ajustarContain(vw: number, vh: number, lw: number, lh: number): Ajuste {
  if (vw <= 0 || vh <= 0 || lw <= 0 || lh <= 0) return { x: 0, y: 0, escala: 1 };
  const escala = Math.min(vw / lw, vh / lh);
  return { x: (vw - lw * escala) / 2, y: (vh - lh * escala) / 2, escala };
}

/** Ponto da tela (dentro da área) -> ponto lógico da imagem, preso aos limites. */
export function paraLogico(p: { x: number; y: number }, a: Ajuste, lw: number, lh: number): { x: number; y: number } {
  const x = (p.x - a.x) / a.escala;
  const y = (p.y - a.y) / a.escala;
  return { x: Math.max(0, Math.min(lw, x)), y: Math.max(0, Math.min(lh, y)) };
}

/** Seleção lógica (arredondada) entre dois pontos de tela. */
export function selecaoLogica(a: { x: number; y: number }, b: { x: number; y: number }, aj: Ajuste, lw: number, lh: number): RetanguloLogico {
  const p = paraLogico(a, aj, lw, lh);
  const q = paraLogico(b, aj, lw, lh);
  return { x: Math.round(Math.min(p.x, q.x)), y: Math.round(Math.min(p.y, q.y)), largura: Math.round(Math.abs(p.x - q.x)), altura: Math.round(Math.abs(p.y - q.y)) };
}

export const selecaoPequena = (s: RetanguloLogico): boolean => s.largura < LIMITES_CAPTURA.selecao_min_px || s.altura < LIMITES_CAPTURA.selecao_min_px;

/** `x,y · WxH` do leitor da mira. */
export const textoMira = (p: { x: number; y: number }, s: RetanguloLogico | null): string => `${Math.round(p.x)},${Math.round(p.y)}${s === null ? "" : ` · ${s.largura}x${s.altura}`}`;

/** `● 12/60 · 2 fps` do rodapé durante a gravação por quadros. */
export const textoQuadros = (n: number, max: number, fps: number): string => `● ${n}/${max} · ${fps} fps`;

export function paraDataUrl(bytes: Uint8Array, tipo: "png" | "jpeg"): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/${tipo};base64,${btoa(bin)}`;
}

const MENSAGENS: Partial<Record<CodigoErroCaptura, string>> = {
  permissao_tela_negada: "Sem permissão de Gravação de Tela.",
  sem_janela: "Não há janela do app para capturar.",
  sem_tela: "Nenhuma tela encontrada.",
  selecao_pequena: "Seleção pequena demais: cancelada.",
  token_invalido: "A imagem congelada expirou. Capture de novo.",
  ja_gravando: "Já existe uma gravação em andamento.",
  nao_gravando: "Não há gravação em andamento.",
  captura_inexistente: "Captura não encontrada.",
  sem_terminal: "O terminal de destino foi fechado.",
  disco_sem_escrita: "Não foi possível gravar no disco.",
  indisponivel: "Captura indisponível agora.",
};
export const mensagemDeCaptura = (c: CodigoErroCaptura, instrucao?: string): string => (instrucao !== undefined && instrucao !== "" ? instrucao : (MENSAGENS[c] ?? "Captura indisponível agora."));

/** Nome curto para a lista: `01/10 10:00:09` a partir do id (`2026-10-01_10-00-09`). */
export function rotuloDaCaptura(id: string): string {
  const m = /^(?:q_)?(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(id);
  if (m === null) return id;
  return `${m[3]}/${m[2]} ${m[4]}:${m[5]}:${m[6]}${id.startsWith("q_") ? " · quadros" : ""}`;
}
