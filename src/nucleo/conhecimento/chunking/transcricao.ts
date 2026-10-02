// Transcrição por TROCA: mensagem do usuário + resposta final do assistente + resumo das tools (nome e caminhos).
// Saída de ferramenta e blocos de raciocínio NUNCA entram (o chamador nem os passa).
import { caminhoProibido } from "../seguranca";
import { chunksDeMarkdown, montar, redigir, type ChunkPronto, type OpcoesChunking } from "./comum";

export interface Troca {
  usuario: string;
  resposta: string;
  ferramentas?: readonly string[];
  arquivos?: readonly string[];
}

export function chunksDeTroca(t: Troca, op: OpcoesChunking = {}): ChunkPronto[] {
  const arquivos = (t.arquivos ?? []).filter((a) => !caminhoProibido(a)).slice(0, 20);
  const ferr = (t.ferramentas ?? []).slice(0, 20);
  const resumo = [ferr.length > 0 ? `Ferramentas: ${ferr.join(", ")}` : "", arquivos.length > 0 ? `Arquivos: ${arquivos.join(", ")}` : ""].filter(Boolean).join("\n");
  const bruto = `Usuário: ${t.usuario.trim()}\n\nAssistente: ${t.resposta.trim()}${resumo ? `\n\n${resumo}` : ""}`;
  const r = chunksDeMarkdown("transcricao", bruto, op);
  if (r.chunks.length > 0) return r.chunks;
  return montar([{ texto: redigir(bruto, op) }]);
}
