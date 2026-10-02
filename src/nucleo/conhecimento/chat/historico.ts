// Histórico do chat: resumo limitado da conversa para o LLM (redigido) e a troca que vira entrada de ingestão (opt-in por conversa).
import { redigir } from "../chunking/comum";
import type { EntradaConhecimento } from "../tipos";

export interface MensagemHistorico {
  papel: "usuario" | "assistente" | "sistema" | "progresso";
  texto: string;
}

/** Últimas trocas (usuário/assistente) como linhas curtas, até `maxChars` no total (mais recentes primeiro na seleção). */
export function resumirHistorico(msgs: readonly MensagemHistorico[], maxChars = 1500): string[] {
  const linhas: string[] = [];
  let gasto = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] as MensagemHistorico;
    if (m.papel !== "usuario" && m.papel !== "assistente") continue;
    const l = `${m.papel === "usuario" ? "Usuário" : "Assistente"}: ${redigir(m.texto).replace(/\s+/g, " ").slice(0, 280)}`;
    if (gasto + l.length > maxChars) break;
    linhas.unshift(l);
    gasto += l.length;
  }
  return linhas;
}

export function trocaParaIngestao(p: { workspace_id: string; conversa_id: string; indice: number; pergunta: string; resposta: string; quando: string; indexar: boolean }): EntradaConhecimento | null {
  if (!p.indexar) return null;
  return { tipo: "chat.exchange", workspace_id: p.workspace_id, conversa_id: p.conversa_id, indice: p.indice, pergunta: p.pergunta, resposta: p.resposta, ocorrido_em: p.quando };
}
