// Transcripts/rollouts SINTÉTICOS no formato real das CLIs (verificado em Claude Code e Codex instalados), com SENTINELAS de conteúdo para provar que nada vaza.
// Nunca copiam conteúdo real. Só gravam em pasta temporária do teste.
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { once } from "node:events";

export const SENTINELA_CONVERSA = "SENTINELA-FRASE-DE-CONVERSA-9f3a";
export const SENTINELA_CODIGO = "function SENTINELA_CODIGO_77b1() { return 42 }";
export const SENTINELA_CAMINHO = "/Users/fulano/segredo-sentinela/projeto/src/arquivo.ts";
export const SENTINELAS = [SENTINELA_CONVERSA, "SENTINELA_CODIGO_77b1", "segredo-sentinela"] as const;

export interface OpcoesClaude {
  id: string;
  ts: string;
  modelo?: string | null;
  entrada?: number;
  saida?: number;
  cache_escrita?: number;
  cache_leitura?: number;
  costUSD?: number;
  sidechain?: boolean;
  semUsage?: boolean;
}
export function linhaClaude(o: OpcoesClaude): string {
  const message: Record<string, unknown> = {
    id: o.id,
    type: "message",
    role: "assistant",
    ...(o.modelo === null ? {} : { model: o.modelo ?? "claude-sonnet-4-5" }),
    content: [{ type: "text", text: `${SENTINELA_CONVERSA} ${SENTINELA_CODIGO} ${SENTINELA_CAMINHO}` }],
    ...(o.semUsage ? {} : { usage: { input_tokens: o.entrada ?? 100, cache_creation_input_tokens: o.cache_escrita ?? 0, cache_read_input_tokens: o.cache_leitura ?? 0, output_tokens: o.saida ?? 10, service_tier: "standard" } }),
  };
  return JSON.stringify({ type: "assistant", uuid: `u-${o.id}`, parentUuid: null, isSidechain: o.sidechain ?? false, cwd: SENTINELA_CAMINHO, sessionId: "s1", timestamp: o.ts, message, ...(o.costUSD === undefined ? {} : { costUSD: o.costUSD }) });
}
export const linhaUsuario = (ts: string): string => JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: `${SENTINELA_CONVERSA} peça` } });

export const linhaTurnContext = (ts: string, modelo: string | null): string =>
  JSON.stringify({ timestamp: ts, type: "turn_context", payload: { cwd: SENTINELA_CAMINHO, ...(modelo === null ? {} : { model: modelo }), summary: SENTINELA_CONVERSA } });
export interface TotalCodex {
  input: number;
  cached?: number;
  output: number;
  reasoning?: number;
}
export const linhaTokenCount = (ts: string, ordinal: number, t: TotalCodex): string =>
  JSON.stringify({
    timestamp: ts,
    ordinal,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: t.input, cached_input_tokens: t.cached ?? 0, cache_write_input_tokens: 0, output_tokens: t.output, reasoning_output_tokens: t.reasoning ?? 0, total_tokens: t.input + t.output }, last_token_usage: {} },
      rate_limits: null,
      texto: SENTINELA_CONVERSA,
    },
  });

/** Grava ~`bytes` de transcript do Claude (linhas ≈ 500 B, 3 blocos por mensagem) em streaming. Devolve o nº de mensagens ÚNICAS e as linhas. */
export async function gerarTranscriptClaudeGrande(caminho: string, bytes: number, inicio = Date.UTC(2026, 5, 1)): Promise<{ mensagens: number; linhas: number; entradaTotal: number; saidaTotal: number }> {
  mkdirSync(dirname(caminho), { recursive: true });
  const ws = createWriteStream(caminho);
  let escritos = 0;
  let linhas = 0;
  let mensagens = 0;
  let entradaTotal = 0;
  let saidaTotal = 0;
  let acumulado = "";
  const enche = "x".repeat(230);
  while (escritos < bytes) {
    const id = `msg_${String(mensagens).padStart(8, "0")}`;
    const ts = new Date(inicio + mensagens * 1000).toISOString();
    const entrada = 50 + (mensagens % 7);
    const saida = 20 + (mensagens % 5);
    for (let b = 0; b < 3; b++) {
      const l = `${linhaClaude({ id, ts, entrada, saida }).replace(SENTINELA_CONVERSA, enche)}\n`;
      acumulado += l;
      escritos += l.length;
      linhas++;
    }
    mensagens++;
    entradaTotal += entrada;
    saidaTotal += saida;
    if (acumulado.length > 1 << 20) {
      if (!ws.write(acumulado)) await once(ws, "drain");
      acumulado = "";
    }
  }
  if (acumulado !== "") ws.write(acumulado);
  ws.end();
  await once(ws, "finish");
  return { mensagens, linhas, entradaTotal, saidaTotal };
}
