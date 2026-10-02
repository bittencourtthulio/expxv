import type { FormatoExportacaoMapa } from "../../../compartilhado/mapa";
import type { VistaExportavel } from "./comum";
import { exportarCsv } from "./csv";
import { exportarDot } from "./dot";
import { exportarJson } from "./json";
import { exportarMarkdown, type EntradaRelatorio } from "./markdown";
import { exportarMermaid } from "./mermaid";
import { exportarSvg, type CoresSvg } from "./svg";

export * from "./comum";
export * from "./csv";
export * from "./destino";
export * from "./dot";
export * from "./json";
export * from "./markdown";
export * from "./mermaid";
export * from "./svg";

export interface PedidoGerarExportacao {
  formato: FormatoExportacaoMapa;
  vista?: VistaExportavel;
  relatorio?: EntradaRelatorio;
  cores?: Partial<CoresSvg>;
  carimbo?: string;
}

/** nome do arquivo -> conteúdo, para `gravarExportacao`. */
export function gerarExportacao(p: PedidoGerarExportacao): Record<string, string> {
  if (p.formato === "md") {
    if (p.relatorio === undefined) throw new Error("relatório ausente");
    return { [`relatorio-${p.carimbo ?? "mapa"}.md`]: exportarMarkdown(p.relatorio) };
  }
  if (p.vista === undefined) throw new Error("vista ausente");
  switch (p.formato) {
    case "mermaid": return { "mapa.mmd": exportarMermaid(p.vista) };
    case "dot": return { "mapa.dot": exportarDot(p.vista) };
    case "svg": return { "mapa.svg": exportarSvg(p.vista, p.cores === undefined ? {} : { cores: p.cores }) };
    case "json": return { "mapa-export.json": exportarJson(p.vista) };
    case "csv": return { ...exportarCsv(p.vista) };
  }
}
