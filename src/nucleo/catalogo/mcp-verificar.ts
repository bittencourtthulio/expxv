// Verificação SOB DEMANDA de um servidor MCP de usuário (T-07.13, D-42): `tools/list` só com `confirmado: true` vindo do diálogo da UI.
// A configuração é relida NA HORA, em memória, do arquivo de origem (nada de segredo persistido nem logado). `stdio`: spawn SEM shell, ambiente mínimo
// (+ o `env` declarado), timeout 5 s, árvore encerrada, saída limitada pelo SDK. `http`: SÓ loopback (nada sai da máquina; servidor remoto é testado pela Loja,
// com consentimento próprio). Persiste apenas `nome` e `descricao` saneada (≤ 300) das ferramentas.
import { readFile, stat } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CliCatalogo, ResultadoVerificarMcp } from "../../compartilhado/catalogo";
import { sanearTexto } from "./sanear";
import { lerMcpToml } from "./scanners/toml-minimo";

export const TIMEOUT_VERIFICAR_MS = 5000;
export const MAX_FERRAMENTAS = 200;

export interface ConfigMcpBruta {
  transporte: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env: Record<string, string>;
  headers: Record<string, string>;
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function strMapa(v: unknown): Record<string, string> {
  const o = obj(v);
  const r: Record<string, string> = {};
  if (o === null) return r;
  for (const [k, x] of Object.entries(o)) if (typeof x === "string") r[k] = x;
  return r;
}

function dePadrao(e: Record<string, unknown>): ConfigMcpBruta | null {
  const cmd = e["command"];
  const lista = Array.isArray(cmd) ? (cmd as unknown[]).filter((x): x is string => typeof x === "string") : null;
  const command = lista !== null ? lista[0] : typeof cmd === "string" ? cmd : undefined;
  const args = lista !== null ? lista.slice(1) : Array.isArray(e["args"]) ? (e["args"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const url = typeof e["url"] === "string" ? (e["url"] as string) : undefined;
  const tipo = typeof e["type"] === "string" ? (e["type"] as string).toLowerCase() : "";
  const http = tipo === "http" || tipo === "sse" || tipo === "remote" || tipo === "streamable-http" || (url !== undefined && command === undefined);
  if (http && url === undefined) return null;
  if (!http && command === undefined) return null;
  return { transporte: http ? "http" : "stdio", ...(command === undefined ? {} : { command }), args, ...(url === undefined ? {} : { url }), env: { ...strMapa(e["env"]), ...strMapa(e["environment"]) }, headers: { ...strMapa(e["headers"]), ...strMapa(e["http_headers"]) } };
}

/** Relê a configuração bruta do servidor `nome` no arquivo de origem. NUNCA persistir nem logar o resultado. */
export async function lerConfigBruta(args: { cli: CliCatalogo; nome: string; arquivoAbs: string }): Promise<ConfigMcpBruta | null> {
  try {
    const s = await stat(args.arquivoAbs);
    if (!s.isFile() || s.size > 16 * 1024 * 1024) return null;
    const texto = await readFile(args.arquivoAbs, "utf8");
    if (args.cli === "codex") {
      const achado = lerMcpToml(texto, { valores: true }).find((x) => x.nome === args.nome);
      if (achado === undefined) return null;
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(achado.bruto.env ?? {})) env[k] = typeof v === "string" ? v : "";
      return dePadrao({ command: achado.bruto.command, args: achado.bruto.args, url: achado.bruto.url, env });
    }
    const j = obj(JSON.parse(texto.replace(/^﻿/, "")));
    if (j === null) return null;
    const candidatos: unknown[] = [obj(j["mcpServers"])?.[args.nome], obj(j["mcp"])?.[args.nome], obj(j)?.[args.nome]];
    const projetos = obj(j["projects"]);
    if (projetos !== null) for (const p of Object.values(projetos)) candidatos.push(obj(obj(p)?.["mcpServers"])?.[args.nome]);
    for (const c of candidatos) {
      const o = obj(c);
      if (o !== null) {
        const r = dePadrao(o);
        if (r !== null) return r;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export type ListarFerramentas = (cfg: ConfigMcpBruta, abort: AbortSignal) => Promise<Array<{ name: string; description?: string }>>;

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/i;

/** Implementação real com o cliente do SDK. */
export const listarFerramentasReal: ListarFerramentas = async (cfg, abort) => {
  const cliente = new Client({ name: "catalogo-verificar", version: "1.0.0" }, { capabilities: {} });
  let transporte: StdioClientTransport | StreamableHTTPClientTransport;
  if (cfg.transporte === "stdio") {
    if (cfg.command === undefined) throw new Error("sem comando");
    // ambiente mínimo (PATH/HOME e o que o SDK considera seguro) + o `env` declarado
    transporte = new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: { ...getDefaultEnvironment(), ...cfg.env }, stderr: "ignore" });
  } else {
    const u = new URL(cfg.url ?? "");
    if (!LOOPBACK.test(u.hostname.replace(/^\[|\]$/g, "") === "::1" ? "[::1]" : u.hostname)) throw new Error("remoto_nao_suportado");
    transporte = new StreamableHTTPClientTransport(u, { requestInit: { headers: cfg.headers, redirect: "error" } });
  }
  const aoAbortar = (): void => void transporte.close().catch(() => undefined);
  abort.addEventListener("abort", aoAbortar, { once: true });
  try {
    await cliente.connect(transporte as unknown as Transport, { signal: abort, timeout: TIMEOUT_VERIFICAR_MS });
    const r = await cliente.listTools(undefined, { signal: abort, timeout: TIMEOUT_VERIFICAR_MS });
    return r.tools.map((t) => ({ name: t.name, ...(t.description === undefined ? {} : { description: t.description }) }));
  } finally {
    abort.removeEventListener("abort", aoAbortar);
    await cliente.close().catch(() => undefined);
    await transporte.close().catch(() => undefined);
  }
};

export interface ResultadoVerificacaoCompleto extends ResultadoVerificarMcp {
  lista: Array<{ nome: string; descricao: string | null }>;
}

export async function verificarServidor(cfg: ConfigMcpBruta | null, listar: ListarFerramentas = listarFerramentasReal, timeoutMs = TIMEOUT_VERIFICAR_MS + 1000): Promise<ResultadoVerificacaoCompleto> {
  const falha = (erro: string): ResultadoVerificacaoCompleto => ({ estado: "indisponivel", ferramentas: 0, erro, lista: [] });
  if (cfg === null) return falha("configuracao_nao_encontrada");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const bruto = await Promise.race([
      listar(cfg, ac.signal),
      new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(new Error("tempo_esgotado")), { once: true })),
    ]);
    const lista = bruto.slice(0, MAX_FERRAMENTAS).map((f) => ({ nome: sanearTexto(f.name, 80), descricao: f.description === undefined ? null : sanearTexto(f.description, 300) || null })).filter((f) => f.nome !== "");
    return { estado: "ok", ferramentas: lista.length, erro: null, lista };
  } catch (e) {
    // nunca devolve a mensagem crua (pode conter caminho/segredo): só códigos conhecidos
    const m = e instanceof Error ? e.message : "";
    return falha(m === "tempo_esgotado" || m === "remoto_nao_suportado" ? m : "falha_ao_listar");
  } finally {
    clearTimeout(t);
    ac.abort();
  }
}

