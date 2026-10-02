// Remoto do GitHub (D-631): só `github.com`, por https ou ssh. Enterprise e outros hosts NÃO mostram os botões na v1 (registrado em D-631).
// Função pura: a URL vem de `git remote get-url origin` (leitura local). Credencial embutida na URL é descartada e nunca devolvida.

export interface RemotoGithub {
  host: "github.com";
  dono: string;
  repo: string;
}

const NOME = /^[A-Za-z0-9_.-]{1,100}$/;

function montar(dono: string | undefined, repo: string | undefined): RemotoGithub | null {
  if (dono === undefined || repo === undefined) return null;
  const r = repo.replace(/\.git$/i, "");
  if (!NOME.test(dono) || !NOME.test(r) || dono.startsWith(".") || r.startsWith(".") || r === "." || r === "..") return null;
  return { host: "github.com", dono, repo: r };
}

export function parsearRemotoGithub(url: string): RemotoGithub | null {
  const u = url.trim();
  if (u === "" || u.length > 500 || /[\s\0]/.test(u)) return null;
  // https://[usuario[:token]@]github.com/dono/repo[.git]
  const https = /^https:\/\/(?:[^@/\s]+@)?github\.com(?::443)?\/([^/]+)\/([^/]+?)\/?$/i.exec(u);
  if (https !== null) return montar(https[1], https[2]);
  // ssh://[git@]github.com[:22]/dono/repo[.git]
  const ssh = /^ssh:\/\/(?:[^@/\s]+@)?github\.com(?::22)?\/([^/]+)\/([^/]+?)\/?$/i.exec(u);
  if (ssh !== null) return montar(ssh[1], ssh[2]);
  // git@github.com:dono/repo[.git]
  const scp = /^(?:[^@/\s:]+@)?github\.com:([^/]+)\/([^/]+?)\/?$/i.exec(u);
  if (scp !== null) return montar(scp[1], scp[2]);
  return null;
}

/** `https://github.com/...` sem credencial e sem porta estranha: a única URL que o app abre no navegador por este fluxo. */
export function urlGithubSegura(url: string): boolean {
  if (typeof url !== "string" || url.length > 500 || /[\s\0]/.test(url)) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === "https:" && u.hostname === "github.com" && u.username === "" && u.password === "" && (u.port === "" || u.port === "443");
}
