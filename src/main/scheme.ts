import { extname, join, normalize, sep } from "node:path";
import { PRODUTO } from "../nucleo/produto";

/**
 * Scheme privilegiado que serve o renderer (D-09): `<scheme>://app/…`. Sem servidor HTTP local.
 * Só arquivos dentro da pasta do renderer, com extensão conhecida; nada de traversal.
 */

export const SCHEME = PRODUTO.scheme;
export const HOST_APP = "app";

export function urlDoApp(): string {
  return `${SCHEME}://${HOST_APP}/index.html`;
}

const EXTENSOES_SERVIDAS = new Set([
  ".html", ".js", ".mjs", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".otf", ".map",
]);

/** Devolve o caminho absoluto do recurso pedido ou `null` se não pode ser servido. */
export function caminhoDoRecurso(url: string, raizRenderer: string): string | null {
  let pedido: URL;
  try {
    pedido = new URL(url);
  } catch {
    return null;
  }
  if (pedido.protocol !== `${SCHEME}:` || pedido.host !== HOST_APP) return null;
  let relativo: string;
  try {
    relativo = decodeURIComponent(pedido.pathname);
  } catch {
    return null;
  }
  if (relativo === "/" || relativo === "") relativo = "/index.html";
  if (relativo.includes("\0") || relativo.includes("\\")) return null;
  const raiz = normalize(raizRenderer);
  const candidato = normalize(join(raiz, relativo));
  if (candidato !== raiz && !candidato.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep)) return null;
  if (!EXTENSOES_SERVIDAS.has(extname(candidato).toLowerCase())) return null;
  return candidato;
}

/** CSP aplicada a toda resposta do scheme próprio. */
export const CONTEUDO_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

export function cabecalhosDoRenderer(): Record<string, string> {
  return {
    "Content-Security-Policy": CONTEUDO_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}
