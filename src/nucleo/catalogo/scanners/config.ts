// Auxiliares dos scanners de configuração: JSON com limite, itens de MCP (redigidos), regras (só tamanho/linhas) e hooks (nunca o texto do comando).
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { CliCatalogo, EscopoCatalogo, OrigemCatalogo, TipoCatalogo } from "../../../compartilhado/catalogo";
import { normalizarNome } from "../normalizar";
import { LIMITES, relativoA, sha256, type ContextoVarredura } from "../raizes";
import { sanearNome } from "../sanear";
import type { DetalheInstalacao, ErroScanner, ItemEscaneado } from "../tipos";
import { basenameSeguro, detalheDeMcp, redigirMcp } from "./redacao-mcp";

export const LIMITE_JSON = 16 * 1024 * 1024;

export interface Alvo {
  cli: CliCatalogo;
  escopo: EscopoCatalogo;
  workspace_id: string;
  base: "home" | "workspace";
  baseAbs: string;
}

/** Lê e interpreta JSON (≤ 16 MB) em memória. Ausente = `undefined`; inválido/grande = erro nominal e `undefined`. */
export async function lerJson(ctx: ContextoVarredura, abs: string, cli: CliCatalogo, tipo: TipoCatalogo, erros: ErroScanner[]): Promise<unknown> {
  let s;
  try {
    s = await stat(abs);
  } catch {
    return undefined;
  }
  if (!s.isFile()) return undefined;
  if (s.size > LIMITE_JSON) {
    erros.push({ cli, tipo, codigo: "arquivo_grande", mensagem: "configuração grande demais: ignorada" });
    return undefined;
  }
  try {
    const buf = await ctx.lerArquivo(abs, LIMITE_JSON);
    return JSON.parse(buf.toString("utf8").replace(/^﻿/, ""));
  } catch {
    erros.push({ cli, tipo, codigo: "json_invalido", mensagem: "configuração ilegível (JSON inválido)" });
    return undefined;
  }
}

export async function lerTexto(ctx: ContextoVarredura, abs: string, max = LIMITES.skillMd): Promise<{ texto: string; tamanho: number; mtime_ms: number } | null> {
  try {
    const s = await stat(abs);
    if (!s.isFile()) return null;
    const buf = await ctx.lerArquivo(abs, Math.min(max, Math.max(1, s.size)));
    return { texto: buf.toString("utf8"), tamanho: s.size, mtime_ms: Math.trunc(s.mtimeMs) };
  } catch {
    return null;
  }
}

function base(alvo: Alvo, abs: string): string {
  return relativoA(alvo.baseAbs, abs) ?? "config";
}

export function itemMcp(alvo: Alvo, abs: string, nomeBruto: string, bruto: unknown, plugin: string | null = null, origem: OrigemCatalogo = "usuario"): ItemEscaneado | null {
  const r = redigirMcp(bruto);
  if (r === null) return null;
  const nome = sanearNome(nomeBruto);
  if (nome === "") return null;
  return {
    tipo: "mcp_server",
    nome,
    nome_normalizado: normalizarNome(nome),
    plugin,
    autor: null,
    origem: plugin !== null && origem === "usuario" ? "terceiro" : origem,
    descricao: null,
    papel_sugerido: null,
    instalacao: {
      cli: alvo.cli,
      escopo: alvo.escopo,
      workspace_id: alvo.workspace_id,
      base: alvo.base,
      caminho_rel: base(alvo, abs),
      metodo: "nativo",
      estado: "presente",
      habilitada: true,
      criado_pelo_app: false,
      hash_conteudo: null,
      tamanho: null,
      mtime_ms: null,
      detalhe: detalheDeMcp(r),
    },
  };
}

/** `mapa` pode ser `{nome: cfg}`; devolve só os itens válidos (≤ 200). */
export function itensMcpDoMapa(alvo: Alvo, abs: string, mapa: unknown, plugin: string | null = null): ItemEscaneado[] {
  if (typeof mapa !== "object" || mapa === null || Array.isArray(mapa)) return [];
  const saida: ItemEscaneado[] = [];
  for (const [nome, cfg] of Object.entries(mapa as Record<string, unknown>).slice(0, 200)) {
    const it = itemMcp(alvo, abs, nome, cfg, plugin);
    if (it !== null) saida.push(it);
  }
  return saida;
}

/** Regra (CLAUDE.md, AGENTS.md, GEMINI.md): só tamanho e nº de linhas; o conteúdo não é guardado. */
export async function itemRegra(ctx: ContextoVarredura, alvo: Alvo, abs: string, nome: string): Promise<ItemEscaneado | null> {
  const t = await lerTexto(ctx, abs);
  if (t === null) return null;
  const linhas = t.texto === "" ? 0 : t.texto.split("\n").length;
  return {
    tipo: "rule",
    nome,
    nome_normalizado: normalizarNome(nome),
    plugin: null,
    autor: null,
    origem: "usuario",
    descricao: null,
    papel_sugerido: null,
    instalacao: {
      cli: alvo.cli,
      escopo: alvo.escopo,
      workspace_id: alvo.workspace_id,
      base: alvo.base,
      caminho_rel: base(alvo, abs),
      metodo: "nativo",
      estado: "presente",
      habilitada: true,
      criado_pelo_app: false,
      hash_conteudo: sha256(t.texto),
      tamanho: t.tamanho,
      mtime_ms: t.mtime_ms,
      detalhe: { tamanho: t.tamanho, linhas: linhas },
    },
  };
}

const INTERPRETADORES = new Set(["bash", "sh", "zsh", "node", "python", "python3", "npx", "env", "uv", "uvx", "bun", "deno", "exec", "sudo", "nohup"]);

/** Executável "significativo" de uma linha de comando de hook: o primeiro token que não é interpretador nem opção. Só o basename; o texto NUNCA sai daqui. */
export function executavelDoHook(comando: string): { exec: string | null; n_args: number } {
  const tokens = comando.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) ?? [];
  const limpos = tokens.map((t) => t.replace(/["']/g, ""));
  const i = limpos.findIndex((t) => !INTERPRETADORES.has(basenameSeguro(t)?.toLowerCase() ?? "") && !t.startsWith("-") && !/^\w+=/.test(t));
  if (i < 0) return { exec: null, n_args: Math.max(0, limpos.length - 1) };
  return { exec: basenameSeguro(limpos[i]), n_args: Math.max(0, limpos.length - 1 - i) };
}

export const RE_HOOK_DO_METODO = /(^|[/\\])\.claude[/\\]hooks[/\\](expx|memox)-|^(expx|memox)-/;

/** Hooks do formato do Claude (`hooks: { Evento: [{ matcher, hooks: [{ type, command }] }] }`). */
export function itensHookClaude(alvo: Alvo, abs: string, hooks: unknown, plugin: string | null = null): ItemEscaneado[] {
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) return [];
  const saida: ItemEscaneado[] = [];
  for (const [evento, grupos] of Object.entries(hooks as Record<string, unknown>).slice(0, 40)) {
    if (!Array.isArray(grupos)) continue;
    for (const g of grupos.slice(0, 50)) {
      const lista = typeof g === "object" && g !== null ? (g as Record<string, unknown>)["hooks"] : undefined;
      if (!Array.isArray(lista)) continue;
      for (const h of lista.slice(0, 50)) {
        const cmd = typeof h === "object" && h !== null ? (h as Record<string, unknown>)["command"] : undefined;
        if (typeof cmd !== "string") continue;
        const { exec, n_args } = executavelDoHook(cmd);
        const metodo = RE_HOOK_DO_METODO.test(cmd) || (exec !== null && RE_HOOK_DO_METODO.test(exec));
        const nome = sanearNome(`${evento}:${exec ?? "comando"}`);
        const detalhe: DetalheInstalacao = {
          evento: sanearNome(evento),
          cli: alvo.cli,
          escopo: alvo.escopo,
          executavel_base: exec,
          n_args,
          gerenciado_pelo_app: false,
          gerenciado_pelo_metodo: metodo,
        };
        saida.push({
          tipo: "hook",
          nome,
          nome_normalizado: normalizarNome(nome),
          plugin,
          autor: null,
          origem: metodo ? "metodo" : plugin !== null ? "terceiro" : "usuario",
          descricao: null,
          papel_sugerido: null,
          instalacao: {
            cli: alvo.cli,
            escopo: alvo.escopo,
            workspace_id: alvo.workspace_id,
            base: alvo.base,
            caminho_rel: base(alvo, abs),
            metodo: "nativo",
            estado: "presente",
            habilitada: true,
            criado_pelo_app: false,
            hash_conteudo: null,
            tamanho: null,
            mtime_ms: null,
            detalhe,
          },
        });
      }
    }
  }
  return saida;
}

