// Leitor do transcript do Claude Code (T-10.04). Formato verificado na CLI instalada: uma linha JSON por bloco de conteúdo; as de `type:"assistant"` trazem
// `message.{id,model,usage{input_tokens,cache_creation_input_tokens,cache_read_input_tokens,output_tokens}}` e `timestamp`. O mesmo `message.id` aparece em
// várias linhas (um bloco cada): vira UM registro (maior valor; `fundirPorChave`). `costUSD` da linha, quando existir, é o valor medido. Sidechains/subagentes
// são arquivos `subagents/agent-*.jsonl` do MESMO Pane (`fontes.ts`). Nada além de {ts, modelo, tokens, chave, usd_medido?} sai daqui.
import type { RegistroExtraido } from "../../../compartilhado/custo";
import type { FabricaLeitor, LeitorFormato } from "./leitor";

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.trunc(x) : 0);

export function extrairClaude(bytes: Buffer): RegistroExtraido | null {
  // filtro barato antes do JSON.parse: só linhas de assistente com `usage` interessam
  if (!bytes.includes('"usage"') || !bytes.includes('"assistant"')) return null;
  let o: unknown;
  try {
    o = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null) return null;
  const l = o as Record<string, unknown>;
  if (l["type"] !== "assistant") return null;
  const m = l["message"];
  if (typeof m !== "object" || m === null) return null;
  const msg = m as Record<string, unknown>;
  const u = msg["usage"];
  if (typeof u !== "object" || u === null) return null;
  const us = u as Record<string, unknown>;
  const ts = typeof l["timestamp"] === "string" ? l["timestamp"] : null;
  if (ts === null || !Number.isFinite(Date.parse(ts))) return null;
  const id = typeof msg["id"] === "string" && msg["id"] !== "" ? msg["id"] : typeof l["uuid"] === "string" ? l["uuid"] : null;
  if (id === null) return null;
  const modeloBruto = typeof msg["model"] === "string" ? msg["model"].trim() : "";
  if (modeloBruto === "<synthetic>") return null; // mensagem sintética do cliente (erro/interrupção): sem consumo real
  const tokens = { entrada: num(us["input_tokens"]), cache_escrita: num(us["cache_creation_input_tokens"]), cache_leitura: num(us["cache_read_input_tokens"]), saida: num(us["output_tokens"]) };
  if (tokens.entrada + tokens.cache_escrita + tokens.cache_leitura + tokens.saida === 0) return null;
  const r: RegistroExtraido = { chave: id, ts, modelo: modeloBruto === "" ? null : modeloBruto, tokens };
  const c = l["costUSD"];
  if (typeof c === "number" && Number.isFinite(c) && c >= 0) r.usd_medido = c;
  return r;
}

export const fabricaClaude: FabricaLeitor = {
  id: "claude",
  retomavel: true,
  criar(): LeitorFormato {
    return { linha: extrairClaude, estado: () => null };
  },
};
