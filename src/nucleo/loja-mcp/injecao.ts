// Injeção por CLI/Pane (Fase 7B, T-07B.20): gera, para Claude Code, Codex e OpenCode, a configuração dos
// servidores da Loja HABILITADOS para um Pane, na mesma forma de `configuracaoDeMcp` (`argumentos`,
// `ambiente`, `arquivo`). Puro: não escreve nada na casa do usuário (D-41) — só devolve flags, variáveis do
// Pane e o conteúdo do arquivo 0600 por Pane (que o main grava e apaga). Gemini: `null` (D-136).
//
// Segredo NUNCA entra em argv, arquivo ou ambiente do Pane: servidor stdio com segredo roda pelo lançador
// (`mcp-run`), que busca os valores por loopback; a CLI só enxerga `command=<node> args=[<mcp-run>, --servidor, id]`
// e os NOMES das variáveis de loopback (`${VAR}`/`{env:VAR}`/`env_vars`, valores só no ambiente do Pane).

import { combinarAmbientes, type ConfiguracaoMcp } from "../terminais/catalogo";
import { montarComando, type ContextoComando } from "./comando";
import type { EntradaMcp } from "./esquema";

export const PREFIXO_NOME_CLI = "ev_";
export const CLIS_COM_INJECAO = ["claude", "codex", "opencode"] as const;
export type CliInjecao = (typeof CLIS_COM_INJECAO)[number];

/** `ev_<id com _>` ≤ 40, `[a-z0-9_]`. Identifica o que a Loja criou (remoção segura, gate `mcp__ev_<id>__*`). */
export function nomeNaCli(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("id inválido");
  return `${PREFIXO_NOME_CLI}${id.replace(/-/g, "_")}`.slice(0, 40);
}

/** Padrão de tool no gate `pre-mcp`. */
export const padraoToolDoServidor = (id: string): string => `mcp__${nomeNaCli(id)}__*`;

export interface ServidorLojaPane {
  entrada: EntradaMcp;
  /** Variáveis (secretas e não) com valor no cofre: decide lançador × direto. Só nomes. */
  definidas: ReadonlySet<string>;
  /** Valores NÃO secretos (ex.: SUPABASE_PROJECT_REF), para `{{VAR:X}}` e variáveis do servidor. */
  publicos?: Readonly<Record<string, string>>;
}

export interface LancadorMcp {
  /** Caminho absoluto de `mcp-run.mjs`. */
  script: string;
  /** Nomes (não valores) das variáveis do Pane com a URL e o token de loopback. */
  variavelUrl: string;
  variavelToken: string;
}

export interface ContextoInjecao extends Pick<ContextoComando, "userData" | "workspace" | "plataforma" | "node" | "nodeEhElectron"> {
  lancador: LancadorMcp;
  /** Missão deny-by-default: só os servidores acima (Claude: `--strict-mcp-config`). */
  estrito?: boolean;
}

export interface ConfiguracaoMcpLoja extends ConfiguracaoMcp {
  /** ids efetivamente injetados. */
  servidores: string[];
  nomes: Record<string, string>;
  /** Variáveis que o Pane precisa ter no ambiente para o lançador funcionar (só nomes). */
  ambiente_requerido: string[];
  avisos: string[];
}

interface Especificacao {
  id: string;
  nome: string;
  tipo: "stdio" | "remoto";
  executavel: string | null;
  args: string[];
  url: string | null;
  variaveis: Record<string, string>;
  /** variáveis do Pane repassadas por referência ao filho. */
  referencias: string[];
}

const RE_PLACEHOLDER_SEGREDO = /\{\{SEGREDO:/;

function usaLancador(s: ServidorLojaPane): boolean {
  const e = s.entrada;
  if (e.instalacao.metodo === "remoto") return false;
  if (e.args.some((a) => RE_PLACEHOLDER_SEGREDO.test(a))) return true;
  return e.variaveis.some((v) => v.secreta && s.definidas.has(v.nome));
}

function especificar(s: ServidorLojaPane, ctx: ContextoInjecao, avisos: string[]): Especificacao {
  const e = s.entrada;
  const publicos = s.publicos ?? {};
  const base: ContextoComando = { userData: ctx.userData, workspace: ctx.workspace, variaveis: publicos, modo: "execucao" };
  if (ctx.plataforma) base.plataforma = ctx.plataforma;
  if (ctx.node) base.node = ctx.node;
  if (ctx.nodeEhElectron !== undefined) base.nodeEhElectron = ctx.nodeEhElectron;
  const c = montarComando(e, base);
  const nome = nomeNaCli(e.id);
  if (c.tipo === "remoto") {
    if (e.variaveis.some((v) => v.secreta && s.definidas.has(v.nome))) {
      avisos.push(`${e.id}: chave remota não é injetada (autenticação pela CLI/OAuth; cabeçalho por chave exige campo próprio no catálogo)`);
    }
    return { id: e.id, nome, tipo: "remoto", executavel: null, args: [], url: c.url, variaveis: {}, referencias: [] };
  }
  if (usaLancador(s)) {
    const variaveis: Record<string, string> = {};
    if (ctx.nodeEhElectron) variaveis["ELECTRON_RUN_AS_NODE"] = "1";
    return {
      id: e.id, nome, tipo: "stdio", executavel: ctx.node ?? process.execPath,
      args: [ctx.lancador.script, "--servidor", e.id], url: null, variaveis,
      referencias: [ctx.lancador.variavelUrl, ctx.lancador.variavelToken],
    };
  }
  const variaveis: Record<string, string> = { ...c.env_fixas };
  for (const v of e.variaveis) if (!v.secreta && publicos[v.nome] !== undefined) variaveis[v.nome] = publicos[v.nome]!;
  return { id: e.id, nome, tipo: "stdio", executavel: c.executavel, args: c.args, url: null, variaveis, referencias: [] };
}

const toml = (v: string): string => JSON.stringify(v);
const RE_CHAVE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const tomlTabela = (o: Record<string, string>): string =>
  `{${Object.entries(o).filter(([k]) => RE_CHAVE.test(k)).map(([k, v]) => `${k}=${toml(v)}`).join(",")}}`;

/**
 * Configuração dos servidores da Loja para um Pane. `arquivo` é o caminho do mcp.json 0600 do Pane (Claude).
 * `null` para CLIs sem injeção por Pane. Lista vazia ⇒ configuração vazia (nada a injetar).
 */
export function configuracaoDeMcpLoja(cli: string, servidores: readonly ServidorLojaPane[], ctx: ContextoInjecao, arquivo: string): ConfiguracaoMcpLoja | null {
  if (!(CLIS_COM_INJECAO as readonly string[]).includes(cli)) return null;
  const avisos: string[] = [];
  const specs = servidores.map((s) => especificar(s, ctx, avisos));
  const nomes: Record<string, string> = Object.fromEntries(specs.map((s) => [s.id, s.nome]));
  const requerido = [...new Set(specs.flatMap((s) => s.referencias))];
  const vazio: ConfiguracaoMcpLoja = { argumentos: [], ambiente: {}, arquivo: null, servidores: specs.map((s) => s.id), nomes, ambiente_requerido: requerido, avisos };
  if (specs.length === 0) return vazio;

  if (cli === "claude") {
    const mcpServers: Record<string, unknown> = {};
    for (const s of specs) {
      if (s.tipo === "remoto") { mcpServers[s.nome] = { type: "http", url: s.url }; continue; }
      const variaveis: Record<string, string> = { ...s.variaveis };
      for (const r of s.referencias) variaveis[r] = "${" + r + "}";
      mcpServers[s.nome] = { type: "stdio", command: s.executavel, args: s.args, ...(Object.keys(variaveis).length ? { env: variaveis } : {}) };
    }
    return { ...vazio, argumentos: ["--mcp-config", arquivo, ...(ctx.estrito ? ["--strict-mcp-config"] : [])], arquivo: JSON.stringify({ mcpServers }) };
  }
  if (cli === "codex") {
    const argumentos: string[] = [];
    for (const s of specs) {
      const k = `mcp_servers.${s.nome}`;
      if (s.tipo === "remoto") { argumentos.push("-c", `${k}.url=${toml(s.url!)}`); continue; }
      argumentos.push("-c", `${k}.command=${toml(s.executavel!)}`, "-c", `${k}.args=[${s.args.map(toml).join(",")}]`);
      if (Object.keys(s.variaveis).length) argumentos.push("-c", `${k}.env=${tomlTabela(s.variaveis)}`);
      if (s.referencias.length) argumentos.push("-c", `${k}.env_vars=[${s.referencias.map(toml).join(",")}]`);
    }
    return { ...vazio, argumentos };
  }
  const mcp: Record<string, unknown> = {};
  for (const s of specs) {
    if (s.tipo === "remoto") { mcp[s.nome] = { type: "remote", url: s.url, enabled: true }; continue; }
    const environment: Record<string, string> = { ...s.variaveis };
    for (const r of s.referencias) environment[r] = `{env:${r}}`;
    mcp[s.nome] = { type: "local", command: [s.executavel, ...s.args], ...(Object.keys(environment).length ? { environment } : {}), enabled: true };
  }
  return { ...vazio, ambiente: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp }) } };
}

/**
 * Junta a configuração de MCP do app (D-13) com a da Loja: um único `--mcp-config`, JSON do arquivo fundido
 * (`mcpServers` somados; o nome do app vence), ambientes por `combinarAmbientes` (OpenCode funde o `mcp`).
 */
export function combinarConfiguracoesMcp(app: ConfiguracaoMcp | null, loja: ConfiguracaoMcp | null): ConfiguracaoMcp | null {
  if (!app) return loja;
  if (!loja) return app;
  const args: string[] = [];
  for (const lista of [app.argumentos, loja.argumentos]) {
    for (let i = 0; i < lista.length; i++) {
      const a = lista[i]!;
      if (a === "--mcp-config") { if (!args.includes("--mcp-config")) args.push(a, lista[i + 1]!); i++; continue; }
      if (a === "--strict-mcp-config" && args.includes(a)) continue;
      args.push(a);
    }
  }
  let arquivo = app.arquivo ?? loja.arquivo;
  if (app.arquivo && loja.arquivo) {
    const a = JSON.parse(app.arquivo) as { mcpServers?: Record<string, unknown> };
    const l = JSON.parse(loja.arquivo) as { mcpServers?: Record<string, unknown> };
    arquivo = JSON.stringify({ ...a, mcpServers: { ...l.mcpServers, ...a.mcpServers } });
  }
  return { argumentos: args, ambiente: combinarAmbientes([loja.ambiente, app.ambiente]), arquivo };
}
