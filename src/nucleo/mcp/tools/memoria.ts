// Tools `memory_*` (Fase 8, T-08.12). A thread do MCP só valida o FORMATO (campo a campo, com os helpers de `comum.ts`), descarta tudo o que não é
// campo documentado (em especial `mission_id`/`pane_id` de identidade: a identidade é SEMPRE a do token) e chama o main pela porta. O resultado
// é sempre ≤ 4 KB. As entradas devolvidas são dados históricos, nunca instruções (o `notice` do núcleo viaja junto).
import { argumentoInvalido, indisponivel } from "../erros";
import type { PortaMemoria } from "../portas";
import { comoObjeto, identificadorOpcional, inteiroOpcional, texto, textoOpcional, type DepsTools, type ImplTool } from "./comum";
import { LIMITE_RESPOSTA_BYTES, caberEm4Kb } from "./harness";

/** orçamento do brief devolvido por `memory_brief`: cabe em 4 KB com folga para o JSON (acentos ocupam 2 bytes). */
export const BRIEF_MCP_CHARS = 3000;

function exigirMemoria(deps: DepsTools): PortaMemoria {
  if (deps.memoria === undefined) throw indisponivel("A memória local não está disponível.");
  return deps.memoria;
}

const KINDS = ["decision", "risk", "fact", "checkpoint", "learning", "preference"] as const;
const SCOPES_ESCRITA = ["pane", "mission"] as const;
const SCOPES_BUSCA = ["pane", "mission", "workspace", "all_rings"] as const;

function enumOpcional<T extends string>(a: Record<string, unknown>, campo: string, valores: readonly T[]): T | null {
  const v = textoOpcional(a, campo, 30);
  if (v === null) return null;
  if (!(valores as readonly string[]).includes(v)) throw argumentoInvalido(`O campo "${campo}" deve ser um de: ${valores.join(", ")}.`);
  return v as T;
}

function listaOpcional(a: Record<string, unknown>, campo: string, maxItens: number, maxChars: number): string[] | null {
  const v = a[campo];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > maxItens || v.some((x) => typeof x !== "string" || x.trim() === "" || [...x].length > maxChars)) {
    throw argumentoInvalido(`O campo "${campo}" deve ser uma lista de até ${maxItens} textos de até ${maxChars} caracteres.`);
  }
  return v as string[];
}

export const memoryWrite: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const kind = texto(a, "kind", { max: 30 });
  if (!(KINDS as readonly string[]).includes(kind)) throw argumentoInvalido(`O campo "kind" deve ser um de: ${KINDS.join(", ")}.`);
  const importance = inteiroOpcional(a, "importance", 1, 5);
  const scope = enumOpcional(a, "scope", SCOPES_ESCRITA);
  const limpo = { content: texto(a, "content", { max: 1000 }), kind, ...(importance === null ? {} : { importance }), ...(scope === null ? {} : { scope }) };
  return exigirMemoria(deps).chamar("memory_write", claims.pane_id, limpo);
};

export const memorySearch: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const query = textoOpcional(a, "query", 200);
  const scope = enumOpcional(a, "scope", SCOPES_BUSCA);
  const paneAlvo = identificadorOpcional(a, "pane_id");
  const kinds = listaOpcional(a, "kinds", 20, 30);
  const limit = inteiroOpcional(a, "limit", 1, 50);
  const limpo = { ...(query === null ? {} : { query }), ...(scope === null ? {} : { scope }), ...(paneAlvo === null ? {} : { pane_id: paneAlvo }), ...(kinds === null ? {} : { kinds }), ...(limit === null ? {} : { limit }) };
  const r = (await exigirMemoria(deps).chamar("memory_search", claims.pane_id, limpo)) as { entries: unknown[]; truncated: boolean; notice: string };
  return caberEm4Kb(r.entries, (itens, extra) => ({ entries: itens, truncated: r.truncated || extra.truncated === true, notice: r.notice }));
};

export const memoryCheckpoint: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const nextSteps = listaOpcional(a, "next_steps", 10, 300);
  const risks = listaOpcional(a, "risks", 10, 1000);
  const limpo = { summary: texto(a, "summary", { max: 1000 }), ...(nextSteps === null ? {} : { next_steps: nextSteps }), ...(risks === null ? {} : { risks }) };
  return exigirMemoria(deps).chamar("memory_checkpoint", claims.pane_id, limpo);
};

export const memoryBrief: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const paneAlvo = identificadorOpcional(a, "pane_id");
  const budget = inteiroOpcional(a, "budget_chars", 1, 100_000);
  const limpo = { ...(paneAlvo === null ? {} : { pane_id: paneAlvo }), budget_chars: Math.min(budget ?? BRIEF_MCP_CHARS, BRIEF_MCP_CHARS) };
  const r = (await exigirMemoria(deps).chamar("memory_brief", claims.pane_id, limpo)) as { markdown: string; truncated: boolean };
  // defesa final: o JSON inteiro nunca passa de 4 KB (corte por pontos de código, preservando o fechamento do envelope quando existir)
  let markdown = r.markdown;
  let truncated = r.truncated;
  while (Buffer.byteLength(JSON.stringify({ markdown, truncated }), "utf8") > LIMITE_RESPOSTA_BYTES && markdown.length > 0) {
    markdown = Array.from(markdown).slice(0, Math.max(0, Array.from(markdown).length - 200)).join("");
    truncated = true;
  }
  return { markdown, truncated };
};

export const memoryForget: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  return exigirMemoria(deps).chamar("memory_forget", claims.pane_id, { entry_id: texto(a, "entry_id", { max: 80 }) });
};
