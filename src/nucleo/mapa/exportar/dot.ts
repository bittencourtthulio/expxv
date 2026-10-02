import { neutralizar, rotuloSeguro, MAX_NOS_PADRAO, type VistaExportavel } from "./comum";

export interface OpcoesDot {
  maxNos?: number;
  rankdir?: "LR" | "TB" | "RL" | "BT";
}

export const escaparDot = (texto: string): string => rotuloSeguro(texto, 120).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** `digraph` com `rankdir=LR` e um `subgraph cluster_*` por módulo; heurística tracejada. */
export function exportarDot(vista: VistaExportavel, opcoes: OpcoesDot = {}): string {
  const v = neutralizar(vista, opcoes.maxNos ?? MAX_NOS_PADRAO);
  const L: string[] = ["digraph mapa {", `  rankdir=${opcoes.rankdir ?? "LR"};`, '  node [shape=box, fontname="Helvetica", fontsize=10];'];
  if (v.nota !== null) L.push(`  // ${rotuloSeguro(v.nota, 200).replace(/[\r\n]/g, " ")}`);
  if (v.agrupada) {
    v.nos.forEach((n, i) => L.push(`  n${i} [label="${escaparDot(n.rotulo)}"];`));
  } else {
    const grupos = new Map<string, number[]>();
    v.nos.forEach((n, i) => {
      const l = grupos.get(n.grupo);
      if (l === undefined) grupos.set(n.grupo, [i]);
      else l.push(i);
    });
    let k = 0;
    for (const [g, idxs] of [...grupos].sort((a, b) => a[0].localeCompare(b[0]))) {
      L.push(`  subgraph cluster_${k++} {`, `    label="${escaparDot(g)}";`);
      for (const i of idxs) L.push(`    n${i} [label="${escaparDot((v.nos[i] as { rotulo: string }).rotulo)}"];`);
      L.push("  }");
    }
  }
  for (const a of v.arestas) L.push(`  n${a.de} -> n${a.para} [label="${escaparDot(a.tipo)}"${a.exata ? "" : ", style=dashed"}];`);
  L.push("}");
  return `${L.join("\n")}\n`;
}
