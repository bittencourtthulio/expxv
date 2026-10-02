// Segurança do conhecimento (T-15.05): denylist de caminhos, caminhos relativos, saneamento de fonte e envelope de dados.
// Conteúdo indexado é DADO, nunca instrução: sai sempre dentro de um envelope fixo, escapado e rotulado.
import { redigirTexto, type OpcoesRedacao } from "../memoria/redacao";
import { linhaSegura } from "../memoria/sanear-brief";

const NOMES_PROIBIDOS = [/^\.env(?:\..*)?$/i, /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?$/i, /^credentials(?:\..*)?$/i, /^\.npmrc$/i, /^\.netrc$/i, /^auth\.json$/i, /^\.pypirc$/i, /^secrets?\.(?:json|ya?ml|toml)$/i];
const EXTENSOES_PROIBIDAS = /\.(?:pem|key|p12|pfx|jks|keystore|kdbx|gpg|asc|ovpn)$/i;
const SEGMENTOS_PROIBIDOS = new Set([".ssh", ".aws", ".gnupg", ".kube"]);

/** true = NUNCA ler nem indexar (AGENTS regra 3). Aceita caminho relativo ou absoluto; separadores `/` ou `\`. */
export function caminhoProibido(caminho: string): boolean {
  const partes = caminho
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  if (partes.length === 0) return false;
  if (partes.some((p) => SEGMENTOS_PROIBIDOS.has(p))) return true;
  const nome = partes[partes.length - 1] as string;
  return NOMES_PROIBIDOS.some((re) => re.test(nome)) || EXTENSOES_PROIBIDAS.test(nome);
}

const ABSOLUTO = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

/** Caminho relativo à raiz (separador `/`). Absoluto fora da raiz, `..` que escapa ou vazio → `null`. */
export function relativizar(caminho: string, raiz: string): string | null {
  if (caminho.includes("\u0000")) return null;
  const c = caminho.replace(/\\/g, "/");
  const r = raiz.replace(/\\/g, "/").replace(/\/+$/, "");
  let rel = c;
  if (ABSOLUTO.test(c)) {
    if (r === "" || !(c === r || c.startsWith(`${r}/`))) return null;
    rel = c.slice(r.length).replace(/^\/+/, "");
  }
  const saida: string[] = [];
  for (const p of rel.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (saida.length === 0) return null;
      saida.pop();
    } else saida.push(p);
  }
  return saida.length === 0 ? null : saida.join("/");
}

/** Reescreve caminhos absolutos citados no texto como relativos à raiz e tira o nome de usuário do SO. */
export function relativizarTexto(texto: string, raiz: string): string {
  const r = raiz.replace(/\\/g, "/").replace(/\/+$/, "");
  let t = texto;
  if (r.length > 1) t = t.split(`${r}/`).join("");
  t = t.replace(/\/(?:Users|home)\/[^/\s]+\//g, "~/").replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, "~\\");
  return t;
}

/** Uma linha segura para citar fonte em prompt (sem tag, heading, cerca, ANSI, bidi). */
export function sanearFonte(texto: string, max = 300): string {
  return linhaSegura(texto, max);
}

/** Redação de segredo + saneamento: o que sai do módulo para prompt, evento ou UI. */
export function limparParaSaida(texto: string, max: number, op: OpcoesRedacao = {}): string {
  return sanearFonte(redigirTexto(texto, op).texto, max);
}

/** Envelope fixo: abertura e fechamento são nossos; só `linhas` (já saneadas) vêm de dados. */
export function envelopeDados(tag: string, atributos: Readonly<Record<string, string>>, linhas: readonly string[], aviso: string): string {
  const attrs = Object.entries(atributos)
    .map(([k, v]) => ` ${k.replace(/[^a-z_]/g, "")}="${v.replace(/[^A-Za-z0-9:._-]/g, "")}"`)
    .join("");
  const tagSegura = tag.replace(/[^a-z_]/g, "");
  return [`<${tagSegura}${attrs} tipo="dados">`, aviso, ...linhas, `</${tagSegura}>`].join("\n");
}
