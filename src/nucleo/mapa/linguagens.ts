import type { Linguagem } from "./tipos";

// Tabela extensão → linguagem e linguagem → gramática WASM (T-17.02). Puro: sem I/O.
// C usa a gramática `cpp` (parseia C quase todo; erros_parse é tolerado nesses arquivos). `jsx` usa a de JavaScript.

/** Nome do arquivo `.wasm` (sem o prefixo `tree-sitter-`) de cada linguagem com gramática embarcada. */
export const GRAMATICA_DA_LINGUAGEM: Readonly<Partial<Record<Linguagem, string>>> = {
  typescript: "typescript",
  tsx: "tsx",
  javascript: "javascript",
  jsx: "javascript",
  python: "python",
  java: "java",
  php: "php",
  csharp: "c-sharp",
  go: "go",
  ruby: "ruby",
  rust: "rust",
  c: "cpp",
  cpp: "cpp",
};

/** Gramáticas (nomes de arquivo) embarcadas: Onda 1 + Onda 2. */
export const GRAMATICAS_EMBARCADAS: readonly string[] = [...new Set(Object.values(GRAMATICA_DA_LINGUAGEM) as string[])].sort();

export function arquivoWasm(gramatica: string): string {
  return `tree-sitter-${gramatica}.wasm`;
}

export const EXTENSAO_PARA_LINGUAGEM: Readonly<Record<string, Linguagem>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".py": "python",
  ".pyw": "python",
  ".java": "java",
  ".php": "php",
  ".phtml": "php",
  ".cs": "csharp",
  ".go": "go",
  ".rb": "ruby",
  ".rake": "ruby",
  ".rs": "rust",
  ".c": "c",
  ".h": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
};

/** Extensões de linguagens SEM gramática embarcada que entram no mapa em modo degradado (T-17.15). */
export const EXTENSOES_DEGRADADAS: ReadonlySet<string> = new Set([
  ".kt", ".kts", ".swift", ".scala", ".sc", ".dart", ".pl", ".pm", ".pas", ".dpr", ".vb", ".cbl", ".cob", ".cpy", ".sql",
  ".lua", ".ex", ".exs", ".erl", ".hs", ".clj", ".groovy", ".gradle", ".sh", ".bash", ".ps1", ".r", ".m", ".mm", ".fs", ".vue", ".svelte",
]);

const SHEBANG: ReadonlyArray<[RegExp, Linguagem]> = [
  [/\b(node|nodejs|deno|bun)\b/, "javascript"],
  [/\bpython[0-9.]*\b/, "python"],
  [/\bphp\b/, "php"],
  [/\bruby\b/, "ruby"],
];

function extensaoDe(caminho: string): string {
  const base = caminho.slice(Math.max(caminho.lastIndexOf("/"), caminho.lastIndexOf("\\")) + 1);
  const ponto = base.lastIndexOf(".");
  return ponto <= 0 ? "" : base.slice(ponto).toLowerCase();
}

/** Linguagem pela extensão; `null` se desconhecida. */
export function linguagemPorExtensao(caminho: string): Linguagem | null {
  return EXTENSAO_PARA_LINGUAGEM[extensaoDe(caminho)] ?? null;
}

/** Linguagem pelo shebang da 1ª linha (`#!/usr/bin/env node`); `null` se não houver. */
export function linguagemPorShebang(primeiraLinha: string): Linguagem | null {
  if (!primeiraLinha.startsWith("#!")) return null;
  for (const [re, ling] of SHEBANG) if (re.test(primeiraLinha)) return ling;
  return null;
}

export function ehDegradada(caminho: string): boolean {
  return EXTENSOES_DEGRADADAS.has(extensaoDe(caminho));
}

/** Linguagem de um arquivo: extensão, depois shebang, depois `outra` (degradada) ou `null` (ignorar). */
export function detectarLinguagem(caminho: string, primeiraLinha?: string): Linguagem | null {
  const porExt = linguagemPorExtensao(caminho);
  if (porExt !== null) return porExt;
  if (primeiraLinha !== undefined) {
    const porShebang = linguagemPorShebang(primeiraLinha);
    if (porShebang !== null) return porShebang;
  }
  return ehDegradada(caminho) ? "outra" : null;
}

export function temGramatica(linguagem: Linguagem): boolean {
  return GRAMATICA_DA_LINGUAGEM[linguagem] !== undefined;
}
