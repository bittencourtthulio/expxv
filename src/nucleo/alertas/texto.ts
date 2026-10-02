// Sanitização, truncamento, redação e hash de argumentos (T-20.04). PURO e linear. A redação REUSA `memoria/redacao`
// (Fase 8) + `cofre/scrubber` (Fase 9, injetado); aqui só entram padrões que a Fase 8 não cobre (token de bot) e as proibições de canal.
import { createHash } from "node:crypto";
import type { NivelTemplate } from "../../compartilhado/alertas";
import { redigir } from "../memoria/redacao";

export const MARCA = "[removido]";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const BIDI_ZW = /[​-‏‪-‮⁠-⁯﻿]/g;

/** ANSI/OSC/controle/bidi/zero-width removidos; NFC. Mantém `\n` e `\t`. */
export function sanitizar(texto: string): string {
  let t = texto.includes("\u001b") ? texto.replace(ANSI, "") : texto;
  t = t.replace(CONTROLE, "").replace(BIDI_ZW, "").replace(/\r\n?/g, "\n");
  return t.normalize("NFC");
}

/** Corta por caracteres visíveis (pontos de código), com reticências dentro do limite; nunca deixa entidade HTML pela metade. */
export function truncarVisivel(texto: string, n: number): string {
  if (n <= 0) return "";
  const pontos = Array.from(texto);
  if (pontos.length <= n) return texto;
  let corte = pontos.slice(0, Math.max(0, n - 1)).join("");
  corte = corte.replace(/&#?[a-zA-Z0-9]{0,8}$/, "").trimEnd();
  return `${corte}…`;
}

export const contarVisiveis = (texto: string): number => Array.from(texto).length;

const TOKEN_BOT = /\b\d{6,12}:[A-Za-z0-9_-]{30,50}\b/g;
const CAMINHO_ABS = /(?:(?<![\w/:.-])\/(?:Users|home|var|private|tmp|etc|opt|usr|mnt|Volumes|root)\/[^\s"'<>)\]]*|\b[A-Za-z]:\\[^\s"'<>)\]]*)/g;
const BLOCO_CODIGO = /```[\s\S]*?(?:```|$)/g;
const DIFF = /^(?:@@ .*@@.*|diff --git .*|index [0-9a-f]+\.\.[0-9a-f]+.*|--- a\/.*|\+\+\+ b\/.*)$/gm;
const EMAIL = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g;
const URL_CRED = /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/@]{1,100}@[^\s]*/gi;
const URL_HTTP = /\bhttp:\/\/[^\s<>"']+/gi;
const URL_OUTRO = /\b(?:ftp|file|javascript|data):[^\s<>"']+/gi;

export interface OpcoesRedigir {
  /** `cofre.scrubSincrono` (valores literais do cofre em 7 variantes). */
  scrub?: (t: string) => string;
  /** limite de caracteres visíveis; sem limite = só a redação. */
  max?: number;
  /** `completo` permite pergunta/cache; aqui só altera o que `minimo` proíbe: caminhos relativos continuam, e-mail some sempre. */
  nivel?: NivelTemplate;
}

/**
 * Redação de TEXTO para canal. Aplicada na entrada do alerta e DE NOVO na saída. Remove: segredos (Fase 8 + cofre + token de bot),
 * caminho absoluto, bloco de código/diff, e-mail, URL com credencial e links que não sejam https.
 */
export function redigirParaCanal(texto: string, op: OpcoesRedigir = {}): string {
  // com limite, o que passa de 4x o limite nunca chega à saída: corta ANTES de redigir (entrada de 100 KB custa o mesmo que 8 KB)
  let t = sanitizar(op.max !== undefined && texto.length > op.max * 4 ? texto.slice(0, op.max * 4) : texto);
  if (op.scrub !== undefined) t = op.scrub(t);
  // pré-checagens baratas: só roda cada padrão quando o texto tem a "pista" dele (o custo cai muito em texto comum)
  if (t.includes(":")) t = t.replace(TOKEN_BOT, "[REDACTED]");
  t = redigir(t, op.scrub === undefined ? {} : { scrubber: { scrub: op.scrub } });
  if (t.includes("://")) t = t.replace(URL_CRED, MARCA);
  if (t.includes("```")) t = t.replace(BLOCO_CODIGO, "[código omitido]");
  if (t.includes("@@") || t.includes("diff --git") || t.includes("index ") || t.includes("--- a/") || t.includes("+++ b/")) t = t.replace(DIFF, "");
  if (t.includes("/") || t.includes(":\\")) t = t.replace(CAMINHO_ABS, "[caminho]");
  if (t.includes("@")) t = t.replace(EMAIL, "[e-mail]");
  if (t.includes("http://")) t = t.replace(URL_HTTP, "[link]");
  if (t.includes(":")) t = t.replace(URL_OUTRO, "[link]");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return op.max === undefined ? t : truncarVisivel(t, op.max);
}

/** Nome do campo de lista fechada usado em prompt injection: o pedido remoto entra dentro de `<pedido_remoto tipo="dados">`. */
/** remove tags do envelope até estabilizar (`</pedido_</pedido_remoto>remoto>` não pode reconstruir um fechamento) e então envolve o texto como DADO. */
export function envolverPedidoRemoto(texto: string): string {
  let t = texto;
  for (let i = 0; i < 20; i++) {
    const anterior = t;
    t = t.replace(/<\/?pedido_remoto[^>]*>/gi, "");
    if (t === anterior) break;
  }
  // sobra de `<`/`>` solto após 20 passadas = entrada hostil: remove o que ainda poderia formar a tag
  if (/<\/?pedido_remoto/i.test(t)) t = t.replace(/pedido_remoto/gi, "");
  return `<pedido_remoto tipo="dados">${t}</pedido_remoto>`;
}

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (typeof v === "object" && v !== null) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) o[k] = canonico(x);
    }
    return o;
  }
  return v;
}

/** SHA-256 hex de JSON canônico (chaves ordenadas): estável para a mesma estrutura, diferente para qualquer campo alterado. */
export const hashArgs = (v: unknown): string => createHash("sha256").update(JSON.stringify(canonico(v))).digest("hex");
export const sha256 = (t: string): string => createHash("sha256").update(t).digest("hex");
