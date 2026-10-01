// O main revalida todo link pedido pelo renderer: esta é a fronteira de segurança.
const LIMITE = 2048;

/** Só http(s) sem credenciais e sem controle abre fora do app; devolve a URL normalizada ou null. */
export function urlDeLinkPermitida(bruta: string): string | null {
  if (bruta.length === 0 || bruta.length > LIMITE || /[\u0000-\u001f\u007f]/.test(bruta)) return null;
  try {
    const url = new URL(bruta);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url.href;
  } catch { return null; }
}
