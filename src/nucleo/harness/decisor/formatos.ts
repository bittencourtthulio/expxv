// Formatos de requisição/resposta do decisor (esquema tipado; P-16). Dois formatos:
//  - `probs_json` (chamada direta ao JEV): POST {kind, purpose?, question, options:[{id,description}]} → {probs:{id:p}, model?, usage?:{cost?}}
//  - `openai_chat` (via OpenRouter ou endpoint compatível): chat/completions; a resposta traz o JSON `{probs}` em `choices[0].message.content`.
// A resposta é validada por esquema: ids ⊂ opções, cada p em [0,1], soma em [0,99; 1,01]. Fora disso = inválida (descartada).
import type { FormatoDecisor } from "../../../compartilhado/harness";
import { PROMPT_SISTEMA } from "./prompts";

export interface OpcaoFechada {
  id: string;
  description: string;
}
export interface PedidoFormato {
  kind: string;
  purpose?: string;
  question: string;
  options: OpcaoFechada[];
  modelo: string | null;
}
export interface UsoModelo {
  cost: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}
export type LeituraResposta =
  | { ok: true; probs: Record<string, number>; modelo: string | null; uso: UsoModelo }
  | { ok: false; motivo: "json_invalido" | "resposta_invalida" };

export function montarCorpo(formato: FormatoDecisor, p: PedidoFormato): string {
  const base = { kind: p.kind, question: p.question, options: p.options.map((o) => ({ id: o.id, description: o.description })) };
  if (formato === "probs_json") return JSON.stringify(p.purpose === undefined ? base : { ...base, purpose: p.purpose });
  return JSON.stringify({
    model: p.modelo ?? undefined,
    temperature: 0,
    max_tokens: 300,
    response_format: { type: "json_object" },
    usage: { include: true },
    messages: [
      { role: "system", content: PROMPT_SISTEMA },
      { role: "user", content: JSON.stringify(base) },
    ],
  });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function extrairJson(texto: string): unknown {
  const t = texto.trim();
  try {
    return JSON.parse(t);
  } catch {
    const i = t.indexOf("{");
    const f = t.lastIndexOf("}");
    if (i < 0 || f <= i) throw new Error("sem json");
    return JSON.parse(t.slice(i, f + 1));
  }
}

function validarProbs(bruto: unknown, ids: string[]): Record<string, number> | null {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return null;
  const p: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  let soma = 0;
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (!ids.includes(k)) return null; // opção inventada
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return null;
    p[k] = v;
    soma += v;
  }
  return soma >= 0.99 && soma <= 1.01 ? p : null;
}

function usoDe(d: Record<string, unknown>): UsoModelo {
  const u = (typeof d.usage === "object" && d.usage !== null ? d.usage : {}) as Record<string, unknown>;
  return { cost: num(u.cost), prompt_tokens: num(u.prompt_tokens), completion_tokens: num(u.completion_tokens) };
}

export function lerResposta(formato: FormatoDecisor, texto: string, ids: string[]): LeituraResposta {
  let doc: unknown;
  try {
    doc = extrairJson(texto);
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
  if (typeof doc !== "object" || doc === null) return { ok: false, motivo: "resposta_invalida" };
  const d = doc as Record<string, unknown>;
  const modelo = typeof d.model === "string" ? d.model : null;
  if (formato === "probs_json") {
    const probs = validarProbs(d.probs, ids);
    return probs === null ? { ok: false, motivo: "resposta_invalida" } : { ok: true, probs, modelo, uso: usoDe(d) };
  }
  const escolhas = d.choices;
  const msg = Array.isArray(escolhas) && typeof escolhas[0] === "object" && escolhas[0] !== null ? ((escolhas[0] as Record<string, unknown>).message as Record<string, unknown> | undefined) : undefined;
  const conteudo = msg?.content;
  if (typeof conteudo !== "string") return { ok: false, motivo: "resposta_invalida" };
  let interno: unknown;
  try {
    interno = extrairJson(conteudo);
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
  const probs = typeof interno === "object" && interno !== null ? validarProbs((interno as Record<string, unknown>).probs, ids) : null;
  return probs === null ? { ok: false, motivo: "resposta_invalida" } : { ok: true, probs, modelo, uso: usoDe(d) };
}
