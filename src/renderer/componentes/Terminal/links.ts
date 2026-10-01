const LIMITE = 2048;

/** Só http(s) sem credenciais e sem controle abre fora do app; devolve a URL normalizada ou null. O main revalida. */
export function urlDeLinkPermitida(bruta: string): string | null {
  if (bruta.length === 0 || bruta.length > LIMITE || /[\u0000-\u001f\u007f]/.test(bruta)) return null;
  try {
    const url = new URL(bruta);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url.href;
  } catch { return null; }
}

/** URL http(s) que cobre a posição `indice` do texto (sem a pontuação que fecha a frase), ou null. */
export function urlNoTexto(texto: string, indice: number): string | null {
  for (const m of texto.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]}]+$/, "");
    const inicio = m.index ?? 0;
    if (indice >= inicio && indice < inicio + url.length) return url;
  }
  return null;
}

/**
 * Cmd/Ctrl+clique num link do terminal. A saída do terminal não é confiável: só http(s) sem credenciais
 * abre e clique simples não abre. Devolve true se pediu a abertura.
 */
export function abrirLinkDoTerminal(
  api: { abrirLink?: (url: string) => Promise<boolean> },
  evento: Pick<MouseEvent, "metaKey" | "ctrlKey">,
  uri: string,
): boolean {
  if (!evento.metaKey && !evento.ctrlKey) return false;
  const url = urlDeLinkPermitida(uri);
  if (url === null || api.abrirLink === undefined) return false;
  void api.abrirLink(url).catch(() => undefined);
  return true;
}
