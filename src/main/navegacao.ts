import { HOST_APP, SCHEME } from "./scheme";

/**
 * Filtro de navegação: dentro do app só o scheme próprio. http/https viram `shell.openExternal`
 * (sem credenciais); qualquer outro protocolo é negado em silêncio.
 */

export function urlPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.host === HOST_APP;
  } catch {
    return false;
  }
}

/** O frame principal só pode ser o documento do app (sem query/hash). */
export function urlDocumentoPrincipalPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === `${SCHEME}:` &&
      u.host === HOST_APP &&
      (u.pathname === "/" || u.pathname === "/index.html") &&
      u.search === "" &&
      u.hash === ""
    );
  } catch {
    return false;
  }
}

export function urlExternaSegura(url: string): boolean {
  if (url.length > 2048) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username !== "" || u.password !== "") return false;
    // eslint-disable-next-line no-control-regex
    return !/[\u0000-\u001f\u007f]/.test(url);
  } catch {
    return false;
  }
}

export type DecisaoAbertura = "allow" | "deny";

/** Para window.open: internos allow; externos seguros → openExternal + deny; o resto deny. */
export function decidirAbertura(url: string, openExternal: (url: string) => void): DecisaoAbertura {
  if (urlPermitida(url)) return "allow";
  if (urlExternaSegura(url)) openExternal(url);
  return "deny";
}
