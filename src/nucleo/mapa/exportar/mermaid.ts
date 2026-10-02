import { neutralizar, rotuloSeguro, MAX_NOS_PADRAO, type VistaExportavel } from "./comum";

export interface OpcoesMermaid {
  maxNos?: number;
  direcao?: "LR" | "RL" | "TB" | "BT";
}

/** Escapa o texto para dentro de `["…"]` do Mermaid: aspas e delimitadores viram entidades. */
export function escaparMermaid(texto: string): string {
  const mapa: Record<string, string> = { '"': "#quot;", "<": "#lt;", ">": "#gt;" };
  return [...rotuloSeguro(texto)].map((c) => mapa[c] ?? (/[#;[\]{}()|%`\\]/.test(c) ? `#${c.charCodeAt(0)};` : c)).join("");
}

/** `flowchart LR`; ids `n<k>`; heurística tracejada (`-.->`). Acima de `maxNos` agrupa por módulo, com nota. */
export function exportarMermaid(vista: VistaExportavel, opcoes: OpcoesMermaid = {}): string {
  const v = neutralizar(vista, opcoes.maxNos ?? MAX_NOS_PADRAO);
  const linhas: string[] = [`flowchart ${opcoes.direcao ?? "LR"}`];
  if (v.nota !== null) linhas.push(`  %% ${rotuloSeguro(v.nota, 200).replace(/%/g, "")}`);
  v.nos.forEach((n, i) => linhas.push(`  n${i}["${escaparMermaid(n.rotulo)}"]`));
  for (const a of v.arestas) {
    const rot = escaparMermaid(a.tipo);
    linhas.push(a.exata ? `  n${a.de} -->|${rot}| n${a.para}` : `  n${a.de} -.->|${rot}| n${a.para}`);
  }
  return `${linhas.join("\n")}\n`;
}
