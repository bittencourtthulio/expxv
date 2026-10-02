// Scanner do Claude Code (T-07.05..07): skills, agentes e comandos (global, projeto e plugins), servidores MCP (redigidos), hooks e regras.
// Somente leitura. Nada do que lê é executado nem persistido além de metadado saneado.
import { join, resolve } from "node:path";
import type { TipoCatalogo } from "../../../compartilhado/catalogo";
import { normalizarNome } from "../normalizar";
import { dentroDe, raizesConhecidas, relativoA, type ContextoVarredura } from "../raizes";
import { sanearNome, sanearTexto } from "../sanear";
import type { ErroScanner, ItemEscaneado, ResultadoScanner } from "../tipos";
import { itemRegra, itensHookClaude, itensMcpDoMapa, lerJson, type Alvo } from "./config";
import { varrerRaiz, type RaizDeItens } from "./comum";

export interface PluginInstalado {
  chave: string;
  nome: string;
  scope: "user" | "project";
  workspace_id: string;
  installPath: string;
  versao: string | null;
  habilitada: boolean;
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Plugins instalados (`installed_plugins.json`, `version: 2`, tolerante a campo novo): só `scope: user` ou `project` com `projectPath` = workspace aberto. */
export async function lerPluginsClaude(ctx: ContextoVarredura, erros: ErroScanner[]): Promise<PluginInstalado[]> {
  const j = obj(await lerJson(ctx, join(ctx.home, ".claude", "plugins", "installed_plugins.json"), "claude", "plugin", erros));
  const plugins = obj(j?.["plugins"]);
  if (plugins === null) return [];
  const habilitados = new Map<string, boolean>();
  const fontes: Array<{ abs: string; ws: string }> = [{ abs: join(ctx.home, ".claude", "settings.json"), ws: "" }, ...ctx.workspaces.map((w) => ({ abs: join(w.raiz, ".claude", "settings.json"), ws: w.id }))];
  for (const f of fontes) {
    const s = obj(await lerJson(ctx, f.abs, "claude", "plugin", erros));
    const ep = obj(s?.["enabledPlugins"]);
    if (ep === null) continue;
    for (const [k, v] of Object.entries(ep)) if (typeof v === "boolean") habilitados.set(`${f.ws}|${k}`, v);
  }
  const raizes = await raizesConhecidas(ctx);
  const saida: PluginInstalado[] = [];
  for (const [chave, lista] of Object.entries(plugins).slice(0, 200)) {
    if (!Array.isArray(lista)) continue;
    for (const e of lista.slice(0, 10)) {
      const o = obj(e);
      if (o === null) continue;
      const scope = o["scope"];
      const installPath = o["installPath"];
      if ((scope !== "user" && scope !== "project") || typeof installPath !== "string") continue;
      let ws = "";
      if (scope === "project") {
        const pp = typeof o["projectPath"] === "string" ? resolve(o["projectPath"]) : "";
        const w = ctx.workspaces.find((x) => resolve(x.raiz) === pp);
        if (w === undefined) continue;
        ws = w.id;
      }
      const abs = resolve(installPath);
      if (!raizes.some((r) => dentroDe(r, abs))) continue;
      const hab = habilitados.get(`${ws}|${chave}`) ?? habilitados.get(`|${chave}`) ?? true;
      saida.push({
        chave,
        nome: sanearNome(chave.split("@")[0] ?? chave),
        scope,
        workspace_id: ws,
        installPath: abs,
        versao: typeof o["version"] === "string" ? sanearTexto(o["version"], 40) : null,
        habilitada: hab,
      });
    }
  }
  return saida;
}

export async function varrerClaude(ctx: ContextoVarredura, tipos: ReadonlySet<TipoCatalogo>): Promise<ResultadoScanner> {
  const erros: ErroScanner[] = [];
  const itens: ItemEscaneado[] = [];
  const raizes = await raizesConhecidas(ctx);
  const quer = (t: TipoCatalogo): boolean => tipos.has(t);

  const globalAlvo: Alvo = { cli: "claude", escopo: "global", workspace_id: "", base: "home", baseAbs: ctx.home };
  const alvosWs: Alvo[] = ctx.workspaces.map((w) => ({ cli: "claude", escopo: "projeto", workspace_id: w.id, base: "workspace", baseAbs: w.raiz }));
  const todos = [globalAlvo, ...alvosWs];

  // skills / agentes / comandos nativos
  const tiposDir: Array<{ t: "skill" | "agent" | "command"; pasta: string; forma: RaizDeItens["forma"] }> = [
    { t: "skill", pasta: "skills", forma: "pasta_skill" },
    { t: "agent", pasta: "agents", forma: "arquivo_md" },
    { t: "command", pasta: "commands", forma: "arquivo_md" },
  ];
  for (const a of todos) {
    for (const td of tiposDir) {
      if (!quer(td.t)) continue;
      itens.push(...(await varrerRaiz(ctx, { cli: "claude", escopo: a.escopo, workspace_id: a.workspace_id, base: a.base, baseAbs: a.baseAbs, dirAbs: join(a.baseAbs, ".claude", td.pasta), forma: td.forma, tipo: td.t }, raizes, erros)));
    }
  }

  // plugins (e o que trazem)
  if (quer("plugin") || quer("skill") || quer("agent") || quer("command") || quer("mcp_server") || quer("hook")) {
    const plugins = await lerPluginsClaude(ctx, erros);
    for (const p of plugins) {
      const a: Alvo = p.scope === "user" ? globalAlvo : (alvosWs.find((x) => x.workspace_id === p.workspace_id) ?? globalAlvo);
      const noHome = dentroDe(ctx.home, p.installPath);
      const baseAbs = noHome ? ctx.home : a.baseAbs;
      const alvoPlugin: Alvo = { ...a, baseAbs };
      const metodoPlugin = normalizarNome(p.chave).startsWith("expx") && p.chave.endsWith("@expx-local");
      if (quer("plugin")) {
        itens.push({
          tipo: "plugin",
          nome: p.nome,
          nome_normalizado: normalizarNome(p.nome),
          plugin: null,
          autor: null,
          origem: metodoPlugin ? "metodo" : "terceiro",
          descricao: null,
          papel_sugerido: null,
          instalacao: {
            cli: "claude",
            escopo: a.escopo,
            workspace_id: a.workspace_id,
            base: noHome ? "home" : a.base,
            caminho_rel: relativoA(baseAbs, p.installPath) ?? p.nome,
            metodo: "nativo",
            estado: "presente",
            habilitada: p.habilitada,
            criado_pelo_app: false,
            hash_conteudo: null,
            tamanho: null,
            mtime_ms: null,
            detalhe: { versao: p.versao, scope: p.scope, marketplace: sanearNome(p.chave.split("@")[1] ?? "") || null },
          },
        });
      }
      const base: Omit<RaizDeItens, "dirAbs" | "forma" | "tipo"> = { cli: "claude", escopo: a.escopo, workspace_id: a.workspace_id, base: noHome ? "home" : a.base, baseAbs, plugin: p.nome, habilitada: p.habilitada, origemPadrao: metodoPlugin ? "metodo" : "usuario" };
      for (const td of tiposDir) {
        if (!quer(td.t)) continue;
        itens.push(...(await varrerRaiz(ctx, { ...base, dirAbs: join(p.installPath, td.pasta), forma: td.forma, tipo: td.t }, raizes, erros)));
      }
      if (quer("mcp_server")) {
        const arq = join(p.installPath, ".mcp.json");
        const j = obj(await lerJson(ctx, arq, "claude", "mcp_server", erros));
        if (j !== null) itens.push(...itensMcpDoMapa(alvoPlugin, arq, obj(j["mcpServers"]) ?? j, p.nome));
      }
      if (quer("hook")) {
        const arq = join(p.installPath, "hooks", "hooks.json");
        const j = obj(await lerJson(ctx, arq, "claude", "hook", erros));
        if (j !== null) itens.push(...itensHookClaude(alvoPlugin, arq, j["hooks"], p.nome));
      }
    }
  }

  // MCP de usuário
  if (quer("mcp_server")) {
    const cj = join(ctx.home, ".claude.json");
    const j = obj(await lerJson(ctx, cj, "claude", "mcp_server", erros));
    if (j !== null) {
      itens.push(...itensMcpDoMapa(globalAlvo, cj, j["mcpServers"]));
      const projetos = obj(j["projects"]);
      if (projetos !== null) {
        for (const a of alvosWs) {
          const w = ctx.workspaces.find((x) => x.id === a.workspace_id);
          const p = w === undefined ? null : obj(projetos[w.raiz]);
          if (p !== null) itens.push(...itensMcpDoMapa({ ...a, base: "home", baseAbs: ctx.home }, cj, p["mcpServers"]));
        }
      }
    }
    for (const a of alvosWs) {
      const arq = join(a.baseAbs, ".mcp.json");
      const m = obj(await lerJson(ctx, arq, "claude", "mcp_server", erros));
      if (m !== null) itens.push(...itensMcpDoMapa(a, arq, obj(m["mcpServers"]) ?? m));
    }
  }

  // hooks de settings
  if (quer("hook")) {
    const fontes: Array<{ a: Alvo; arq: string }> = [{ a: globalAlvo, arq: join(ctx.home, ".claude", "settings.json") }];
    for (const a of alvosWs) {
      fontes.push({ a, arq: join(a.baseAbs, ".claude", "settings.json") }, { a, arq: join(a.baseAbs, ".claude", "settings.local.json") });
    }
    for (const f of fontes) {
      const s = obj(await lerJson(ctx, f.arq, "claude", "hook", erros));
      if (s !== null) itens.push(...itensHookClaude(f.a, f.arq, s["hooks"]));
    }
  }

  // regras
  if (quer("rule")) {
    const alvoRegra = [{ a: globalAlvo, arq: join(ctx.home, ".claude", "CLAUDE.md") }, ...alvosWs.map((a) => ({ a, arq: join(a.baseAbs, "CLAUDE.md") }))];
    for (const r of alvoRegra) {
      const it = await itemRegra(ctx, r.a, r.arq, "CLAUDE.md");
      if (it !== null) itens.push(it);
    }
  }
  return { itens, erros };
}
