// Formatação do medidor de CPU e memória (D-530…): puro. O número é SEMPRE o sinal principal; o tom (cor) só reforça.
import { tomDoUso, type AmostraSistema, type TomSistema } from "../../compartilhado/sistema";

export const SEM_AMOSTRA = "—";

export const textoPct = (pct: number | null | undefined): string => (typeof pct === "number" ? `${Math.round(pct)}%` : SEM_AMOSTRA);

/** pior dos dois usos (CPU e RAM). */
export function tomGeral(a: AmostraSistema | null): TomSistema {
  if (a === null) return "normal";
  const t = [tomDoUso(a.cpu), tomDoUso(a.ram)];
  return t.includes("alerta") ? "alerta" : t.includes("aviso") ? "aviso" : "normal";
}

/** rótulo acessível do chip: 'CPU 23 por cento, memória 61 por cento'. */
export function ariaChip(a: AmostraSistema | null): string {
  return a === null ? "CPU e memória: aguardando a primeira medição" : `CPU ${Math.round(a.cpu)} por cento, memória ${Math.round(a.ram)} por cento`;
}

/** sinal textual do tom (a cor nunca é o único sinal): vazio no normal. */
export const sinalDoTom = (t: TomSistema): string => (t === "alerta" ? "!" : t === "aviso" ? "▲" : "");

/** Anúncio para o leitor de tela SÓ quando o tom muda (nunca por amostra); `null` = não anunciar. */
export function anuncioDeTransicao(antes: TomSistema, depois: TomSistema, a: AmostraSistema): string | null {
  if (antes === depois) return null;
  if (depois === "normal") return "CPU e memória voltaram ao normal.";
  const quem = tomDoUso(a.cpu) === depois && tomDoUso(a.ram) === depois ? "CPU e memória" : tomDoUso(a.cpu) === depois ? "CPU" : "Memória";
  return `${depois === "alerta" ? "Alerta" : "Atenção"}: ${quem} em ${Math.round(Math.max(a.cpu, a.ram))} por cento.`;
}

export function textoMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(mb)} MB`;
}

/** pontos de uma sparkline (viewBox 0..w × 0..h, 100% no topo) para a série em %. */
export function pontosSparkline(serie: readonly number[], largura: number, altura: number, maxPontos: number): string {
  if (serie.length === 0) return "";
  const passo = maxPontos > 1 ? largura / (maxPontos - 1) : largura;
  const x0 = largura - (serie.length - 1) * passo;
  return serie.map((v, i) => `${(x0 + i * passo).toFixed(1)},${(altura - (Math.min(100, Math.max(0, v)) / 100) * altura).toFixed(1)}`).join(" ");
}
