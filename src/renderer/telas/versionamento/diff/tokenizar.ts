// Tokenizador leve (puro) para realce de sintaxe: comentários de linha, strings, números e palavras-chave por família de
// extensão. Sem dependência; uma linha por vez (estado de bloco não é carregado entre linhas: custo mínimo e previsível).

export type TipoToken = "texto" | "comentario" | "string" | "numero" | "chave";
export interface Token {
  t: TipoToken;
  s: string;
}

const CHAVES_C = "if else for while do switch case break continue return function const let var class extends new import export from default async await try catch finally throw typeof instanceof interface type enum public private protected static void null true false undefined this super in of as struct impl fn pub use mod match let mut trait def lambda None True False self elif pass raise with yield int long char bool string namespace using package func go defer chan select range";
const CONJUNTO = new Set(CHAVES_C.split(" "));

const FAMILIAS: Record<string, "c" | "hash" | "sql" | "nenhuma"> = {
  ts: "c", tsx: "c", js: "c", jsx: "c", mjs: "c", cjs: "c", java: "c", go: "c", rs: "c", c: "c", h: "c", cpp: "c", cs: "c", php: "c", swift: "c", kt: "c", css: "c", scss: "c",
  py: "hash", rb: "hash", sh: "hash", yml: "hash", yaml: "hash", toml: "hash", md: "nenhuma", json: "nenhuma", sql: "sql",
};

export function familiaDe(caminho: string): "c" | "hash" | "sql" | "nenhuma" {
  const ext = /\.([A-Za-z0-9]+)$/.exec(caminho)?.[1]?.toLowerCase() ?? "";
  return FAMILIAS[ext] ?? "nenhuma";
}

export function tokenizarLinha(texto: string, familia: "c" | "hash" | "sql" | "nenhuma"): Token[] {
  if (familia === "nenhuma" || texto.length === 0 || texto.length > 2000) return [{ t: "texto", s: texto }];
  const saida: Token[] = [];
  let acumulado = "";
  const solta = (): void => { if (acumulado !== "") { saida.push({ t: "texto", s: acumulado }); acumulado = ""; } };
  let i = 0;
  while (i < texto.length) {
    const c = texto[i] as string;
    const dois = texto.slice(i, i + 2);
    if ((familia === "c" && dois === "//") || (familia === "hash" && c === "#") || (familia === "sql" && dois === "--")) {
      solta();
      saida.push({ t: "comentario", s: texto.slice(i) });
      return saida;
    }
    if (c === '"' || c === "'" || c === "`") {
      solta();
      let j = i + 1;
      while (j < texto.length && texto[j] !== c) j += texto[j] === "\\" ? 2 : 1;
      saida.push({ t: "string", s: texto.slice(i, Math.min(j + 1, texto.length)) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) && !/[A-Za-z_]/.test(texto[i - 1] ?? "")) {
      solta();
      const m = /^(0x[0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9]+)?)/.exec(texto.slice(i));
      const s = m?.[0] ?? c;
      saida.push({ t: "numero", s });
      i += s.length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(texto.slice(i));
      const s = m?.[0] ?? c;
      if (CONJUNTO.has(s)) { solta(); saida.push({ t: "chave", s }); } else acumulado += s;
      i += s.length;
      continue;
    }
    acumulado += c;
    i++;
  }
  solta();
  return saida;
}
