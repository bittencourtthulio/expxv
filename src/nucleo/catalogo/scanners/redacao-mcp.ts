// Redação NA ORIGEM de configurações de MCP de usuário (T-07.06): o objeto bruto é lido em memória, reduzido a metadado estrutural e
// DESCARTADO. Valor de `env`, `headers`, argumentos, URL com credencial/caminho/query nunca é copiado (só nomes, contagens e scheme+host).
import { basename } from "node:path";

export interface McpRedigido {
  transporte: "stdio" | "http" | "sse";
  executavel_base: string | null;
  n_args: number;
  origem_url: string | null;
  chaves_env: string[];
  tem_segredo: boolean;
}

const RE_SEGREDO = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|BEARER|CREDENTIAL|COOKIE/i;
const RE_NOME_CHAVE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** scheme + host (+ porta); sem userinfo, caminho nem query. `null` se não for http(s)/ws. */
export function origemDaUrl(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 2048) return null;
  try {
    const p = new URL(u);
    if (!/^(https?|wss?):$/.test(p.protocol)) return null;
    return `${p.protocol}//${p.host}`;
  } catch {
    return null;
  }
}

export function basenameSeguro(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const b = basename(s.trim().replace(/\\/g, "/")).replace(/[^A-Za-z0-9_.@+-]/g, "").slice(0, 60);
  return b === "" ? null : b;
}

function nomes(o: Record<string, unknown> | null): string[] {
  return o === null ? [] : Object.keys(o).filter((k) => RE_NOME_CHAVE.test(k)).slice(0, 40);
}

/** `bruto` pode ser o formato do Claude/Gemini (`command`, `args`, `env`, `url`, `headers`, `type`), do OpenCode (`command` lista, `environment`, `type: local|remote`) ou do Codex. */
export function redigirMcp(bruto: unknown): McpRedigido | null {
  const o = obj(bruto);
  if (o === null) return null;
  const cmdBruto = o["command"];
  const cmdLista = Array.isArray(cmdBruto) ? cmdBruto : null;
  const exec = cmdLista !== null ? cmdLista[0] : cmdBruto;
  const args = Array.isArray(o["args"]) ? (o["args"] as unknown[]) : [];
  const nArgs = cmdLista !== null ? Math.max(0, cmdLista.length - 1) : args.length;
  const url = origemDaUrl(o["url"]);
  const tipo = typeof o["type"] === "string" ? (o["type"] as string).toLowerCase() : "";
  let transporte: McpRedigido["transporte"] = "stdio";
  if (tipo === "sse") transporte = "sse";
  else if (tipo === "http" || tipo === "streamable-http" || tipo === "remote" || (url !== null && typeof exec !== "string")) transporte = "http";
  const ambiente = obj(o["env"]) ?? obj(o["environment"]);
  const headers = obj(o["headers"]) ?? obj(o["http_headers"]);
  const chaves = [...nomes(ambiente), ...nomes(headers)];
  const extras: string[] = [];
  if (typeof o["bearer_token_env_var"] === "string" && RE_NOME_CHAVE.test(o["bearer_token_env_var"] as string)) extras.push(o["bearer_token_env_var"] as string);
  const todas = [...new Set([...chaves, ...extras])];
  const temSegredo = todas.some((k) => RE_SEGREDO.test(k)) || extras.length > 0;
  return {
    transporte,
    executavel_base: transporte === "stdio" ? basenameSeguro(exec) : null,
    n_args: nArgs,
    origem_url: transporte === "stdio" ? null : url,
    chaves_env: todas,
    tem_segredo: temSegredo,
  };
}

/** Detalhe persistível (só primitivos). `chaves_env` vira lista separada por vírgula (≤ 300 chars). */
export function detalheDeMcp(r: McpRedigido): Record<string, string | number | boolean | null> {
  return {
    transporte: r.transporte,
    executavel_base: r.executavel_base,
    n_args: r.n_args,
    origem_url: r.origem_url,
    chaves_env: r.chaves_env.join(",").slice(0, 300),
    tem_segredo: r.tem_segredo,
  };
}
