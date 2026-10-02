// Evento do domínio (Fase 8): título como cabeçalho + texto (markdown). 1 chunk por evento curto; longo é dividido por título/parágrafo.
import type { EventoConhecimento } from "../../memoria/eventos-conhecimento";
import { chunksDeMarkdown, type ChunkPronto, type OpcoesChunking } from "./comum";

export function chunksDeEvento(e: Pick<EventoConhecimento, "titulo" | "texto" | "tags">, op: OpcoesChunking = {}): ChunkPronto[] {
  const etiquetas = e.tags.length > 0 ? `\n\nTags: ${e.tags.join(", ")}` : "";
  return chunksDeMarkdown("evento", `# ${e.titulo.trim()}\n\n${e.texto.trim()}${etiquetas}`, op).chunks;
}
