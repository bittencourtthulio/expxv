// Modelo do grafo de conhecimento (DEC-6, D-87): nós e arestas com proveniência (`documento_id`). Extração SEM LLM.
import type { TipoArestaGrafo, TipoNoGrafo, TipoDocumento } from "../../../compartilhado/conhecimento";

export interface NoExtraido {
  tipo: TipoNoGrafo;
  chave: string;
  rotulo: string;
  props?: Record<string, unknown>;
}

export interface ArestaExtraida {
  de: { tipo: TipoNoGrafo; chave: string };
  para: { tipo: TipoNoGrafo; chave: string };
  tipo: TipoArestaGrafo;
  peso?: number;
}

export interface GrafoExtraido {
  nos: NoExtraido[];
  arestas: ArestaExtraida[];
}

/** Tipo de nó que representa um documento. */
export function tipoNoDoDocumento(t: TipoDocumento): TipoNoGrafo {
  switch (t) {
    case "relatorio":
    case "qa":
    case "causa_raiz":
    case "handoff":
      return "relatorio";
    case "decisao":
      return "decisao";
    case "task":
      return "task";
    case "missao":
      return "missao";
    case "commit":
      return "commit";
    case "pr":
      return "pr";
    case "transcricao":
    case "chat":
      return "sessao";
    case "aprendizado":
      return "aprendizado";
    case "codigo":
      return "arquivo";
    default:
      return "doc";
  }
}

export const chaveDe = (n: { tipo: TipoNoGrafo; chave: string }): string => `${n.tipo}:${n.chave}`;
