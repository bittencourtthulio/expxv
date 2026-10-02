import { neutralizar, type VistaExportavel } from "./comum";

/** RFC 4180 + proteção contra injeção de fórmula: célula que começa com `= + - @` (ou tab/CR) ganha `'` na frente. */
export function celulaCsv(valor: string | number): string {
  let t = String(valor);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const linha = (cols: ReadonlyArray<string | number>): string => `${cols.map(celulaCsv).join(",")}\r\n`;

/** `nos.csv` e `arestas.csv` (sem agrupamento: exporta o que veio). */
export function exportarCsv(vista: VistaExportavel): { "nos.csv": string; "arestas.csv": string } {
  const v = neutralizar(vista, Number.MAX_SAFE_INTEGER);
  let nos = linha(["id", "rotulo", "tipo", "grupo", "peso"]);
  for (const n of v.nos) nos += linha([n.id, n.rotulo, n.tipo, n.grupo, n.peso]);
  let ar = linha(["de", "para", "tipo", "confianca", "peso"]);
  for (const a of v.arestas) ar += linha([(v.nos[a.de] as { id: string }).id, (v.nos[a.para] as { id: string }).id, a.tipo, a.exata ? "exata" : "heuristica", a.peso]);
  return { "nos.csv": nos, "arestas.csv": ar };
}
