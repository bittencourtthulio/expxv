import type { VistaExportavel } from "./comum";
import { ehFluxo } from "./comum";

export const SCHEMA_VERSION_EXPORT = 1;

/** `mapa-export.json`: `{schema_version, tipo, nos[], arestas[], metricas}`. Sem código-fonte; caminhos relativos. */
export function exportarJson(vista: VistaExportavel, extra: { versao_mapa?: number } = {}): string {
  let obj: Record<string, unknown>;
  if (ehFluxo(vista)) {
    const he = vista.arestas.filter((a) => a[3] === 0).length;
    obj = {
      schema_version: SCHEMA_VERSION_EXPORT, tipo: "fluxo", raiz: vista.raiz, nos: vista.nos, arestas: vista.arestas,
      metricas: { nos: vista.nos.length, arestas: vista.arestas.length, exatas: vista.arestas.length - he, heuristicas: he, truncado: vista.truncado, tabelas: vista.tabelas.length, externos: vista.externos.length },
    };
  } else {
    const he = vista.arestas.filter((a) => a[3] === 0).length;
    obj = {
      schema_version: SCHEMA_VERSION_EXPORT, tipo: "grafo", nivel: vista.nivel, versao_mapa: extra.versao_mapa ?? vista.versao_mapa, nos: vista.nos, arestas: vista.arestas,
      metricas: { nos: vista.nos.length, arestas: vista.arestas.length, exatas: vista.arestas.length - he, heuristicas: he, truncado: vista.truncado, total_nos: vista.total_nos, total_arestas: vista.total_arestas },
    };
  }
  return `${JSON.stringify(obj, null, 1)}\n`;
}
