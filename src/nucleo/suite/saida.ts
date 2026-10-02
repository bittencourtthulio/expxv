// Saída do instalador para a tela: sem ANSI, sem segredos, sem o início do caminho do usuário, limitada em tamanho (D-475). Pura.
import { homedir } from "node:os";
import { LIMITES_SUITE } from "./modelo";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-Za-z]|\u001b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const SEGREDOS: ReadonlyArray<[RegExp, string]> = [
  [/(_authToken\s*=\s*)\S+/gi, "$1***"],
  [/(\/\/[^\s/]+\/[^\s:]*:_auth(?:Token)?=)\S+/gi, "$1***"],
  [/\bnpm_[A-Za-z0-9]{20,}\b/g, "npm_***"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "gh_***"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "github_pat_***"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-***"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 ***"],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1***@"],
  [/\b((?:password|passwd|token|secret|api[_-]?key|access[_-]?key)\s*[=:]\s*)\S+/gi, "$1***"],
];

/** Tira ANSI/controle e resolve `\r` (barra de progresso): sobra o último trecho da linha. */
export function limparAnsi(texto: string): string {
  return texto.replace(ANSI, "").split("\n").map((l) => (l.includes("\r") ? (l.split("\r").filter((p) => p !== "").pop() ?? "") : l)).join("\n").replace(CONTROLE, "");
}

/** Esconde segredos conhecidos e o início do caminho do usuário (`/Users/ana/x` → `~/x`). `scrub` extra (cofre) é opcional e nunca derruba. */
export function redigir(texto: string, scrub?: (t: string) => string, inicio: string = homedir()): string {
  let t = texto;
  for (const [padrao, troca] of SEGREDOS) t = t.replace(padrao, troca);
  if (inicio !== "" && inicio !== "/") t = t.split(inicio).join("~");
  t = t.replace(/\/(?:Users|home)\/[^/\s]+\//g, "~/").replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, "~\\");
  if (scrub !== undefined) { try { t = scrub(t); } catch { /* o scrubber nunca derruba a instalação */ } }
  return t;
}

/** Uma linha pronta para o log: limpa, redigida e cortada. Linha vazia vira `null`. */
export function linhaDeLog(bruta: string, scrub?: (t: string) => string, inicio?: string): string | null {
  const t = redigir(limparAnsi(bruta), scrub, inicio).trimEnd();
  if (t.trim() === "") return null;
  return t.length > LIMITES_SUITE.log_linha_chars ? `${t.slice(0, LIMITES_SUITE.log_linha_chars)}…` : t;
}

/** Cauda de log com teto de linhas; avisa se descartou. */
export interface CaudaDeLog {
  adicionar(linha: string): void;
  linhas(n?: number): string[];
  truncado(): boolean;
  total(): number;
}

export function criarCauda(max: number = LIMITES_SUITE.log_linhas): CaudaDeLog {
  const itens: string[] = [];
  let descartou = false;
  let total = 0;
  return {
    adicionar(linha) {
      total += 1;
      itens.push(linha);
      if (itens.length > max) { itens.splice(0, itens.length - max); descartou = true; }
    },
    linhas: (n) => (n === undefined ? [...itens] : itens.slice(-n)),
    truncado: () => descartou,
    total: () => total,
  };
}
