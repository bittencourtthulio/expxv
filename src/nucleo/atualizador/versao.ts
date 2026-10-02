// Semver estrito com ordem total (Fase 21, T-21.13). Puro: sem Electron, sem fs, sem rede.
// Aceita `MAJOR.MINOR.PATCH` e `-prerelease` (ex.: `1.2.0-beta.3`); metadados de build (`+x`) são recusados.

export interface Versao {
  major: number;
  minor: number;
  patch: number;
  /** identificadores da pré-release (números viram number). Vazio = estável. */
  pre: Array<string | number>;
}

const RE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function lerVersao(texto: unknown): Versao | null {
  if (typeof texto !== "string" || texto.length > 64) return null;
  const m = RE.exec(texto);
  if (m === null) return null;
  const pre: Array<string | number> = [];
  if (m[4] !== undefined) {
    for (const id of m[4].split(".")) {
      if (/^\d+$/.test(id)) {
        if (id.length > 1 && id.startsWith("0")) return null; // identificador numérico sem zero à esquerda
        if (id.length > 9) return null;
        pre.push(Number(id));
      } else pre.push(id);
    }
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

/** Ordem total do semver 2.0: -1, 0 ou 1. */
export function compararVersoes(a: Versao, b: Versao): -1 | 0 | 1 {
  for (const k of ["major", "minor", "patch"] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1; // estável > pré-release
  if (b.pre.length === 0) return -1;
  const n = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < n; i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1; // número < texto
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Compara dois textos de versão; `null` se algum for inválido. */
export function compararTextos(a: string, b: string): -1 | 0 | 1 | null {
  const va = lerVersao(a);
  const vb = lerVersao(b);
  return va === null || vb === null ? null : compararVersoes(va, vb);
}

export const ehPreRelease = (v: Versao): boolean => v.pre.length > 0;
