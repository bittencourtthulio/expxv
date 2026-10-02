// Scanners de Codex, OpenCode, Gemini e portátil (`.agents`) (T-07.08/09). Somente leitura.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { TipoCatalogo } from "../../../compartilhado/catalogo";
import { normalizarNome } from "../normalizar";
import { raizesConhecidas, type ContextoVarredura } from "../raizes";
import { sanearNome, sanearTexto } from "../sanear";
import type { ErroScanner, ItemEscaneado, ResultadoScanner } from "../tipos";
import { varrerRaiz } from "./comum";
import { itemMcp, itemRegra, itensMcpDoMapa, lerJson, lerTexto, type Alvo } from "./config";
import { lerMcpToml } from "./toml-minimo";

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function alvos(ctx: ContextoVarredura, cli: Alvo["cli"]): { global: Alvo; ws: Alvo[]; todos: Alvo[] } {
  const global: Alvo = { cli, escopo: "global", workspace_id: "", base: "home", baseAbs: ctx.home };
  const ws: Alvo[] = ctx.workspaces.map((w) => ({ cli, escopo: "projeto", workspace_id: w.id, base: "workspace", baseAbs: w.raiz }));
  return { global, ws, todos: [global, ...ws] };
}

export async function varrerCodex(ctx: ContextoVarredura, tipos: ReadonlySet<TipoCatalogo>): Promise<ResultadoScanner> {
  const erros: ErroScanner[] = [];
  const itens: ItemEscaneado[] = [];
  const raizes = await raizesConhecidas(ctx);
  const { global, ws } = alvos(ctx, "codex");
  if (tipos.has("skill")) {
    const lidos = await varrerRaiz(ctx, { cli: "codex", escopo: "global", workspace_id: "", base: "home", baseAbs: ctx.home, dirAbs: join(ctx.home, ".codex", "skills"), forma: "pasta_skill", tipo: "skill", profundidade: 3 }, raizes, erros);
    // `.system/` e pastas ocultas: skills nativas da CLI
    for (const it of lidos) if (/(^|\/)\.[^/]+\//.test(it.instalacao.caminho_rel.replace(/^\.codex\/skills\//, "")) && it.origem === "usuario") it.origem = "nativa";
    itens.push(...lidos);
  }
  if (tipos.has("command")) {
    itens.push(...(await varrerRaiz(ctx, { cli: "codex", escopo: "global", workspace_id: "", base: "home", baseAbs: ctx.home, dirAbs: join(ctx.home, ".codex", "prompts"), forma: "arquivo_md", tipo: "command", profundidade: 1 }, raizes, erros)));
  }
  if (tipos.has("mcp_server")) {
    const arq = join(ctx.home, ".codex", "config.toml");
    const t = await lerTexto(ctx, arq, 2 * 1024 * 1024);
    if (t !== null) {
      try {
        for (const s of lerMcpToml(t.texto)) {
          const it = itemMcp(global, arq, s.nome, s.bruto);
          if (it !== null) itens.push(it);
        }
      } catch {
        erros.push({ cli: "codex", tipo: "mcp_server", codigo: "toml_invalido", mensagem: "config.toml ilegível" });
      }
    }
  }
  if (tipos.has("rule")) {
    const fontes = [{ a: global, arq: join(ctx.home, ".codex", "AGENTS.md") }, ...ws.map((a) => ({ a, arq: join(a.baseAbs, "AGENTS.md") }))];
    for (const f of fontes) {
      const it = await itemRegra(ctx, f.a, f.arq, "AGENTS.md");
      if (it !== null) itens.push(it);
    }
  }
  return { itens, erros };
}

export async function varrerOpenCode(ctx: ContextoVarredura, tipos: ReadonlySet<TipoCatalogo>): Promise<ResultadoScanner> {
  const erros: ErroScanner[] = [];
  const itens: ItemEscaneado[] = [];
  const raizes = await raizesConhecidas(ctx);
  const { global, ws, todos } = alvos(ctx, "opencode");
  const pastaDe = (a: Alvo, nome: string): string[] => (a.escopo === "global" ? [join(ctx.home, ".config", "opencode", nome)] : [join(a.baseAbs, ".opencode", nome)]);
  const dirs: Array<{ t: "skill" | "agent" | "command"; nomes: string[]; forma: "pasta_skill" | "arquivo_md" }> = [
    { t: "skill", nomes: ["skills"], forma: "pasta_skill" },
    { t: "agent", nomes: ["agent", "agents"], forma: "arquivo_md" },
    { t: "command", nomes: ["command", "commands"], forma: "arquivo_md" },
  ];
  for (const a of todos) {
    for (const d of dirs) {
      if (!tipos.has(d.t)) continue;
      for (const n of d.nomes) {
        for (const dirAbs of pastaDe(a, n)) {
          itens.push(...(await varrerRaiz(ctx, { cli: "opencode", escopo: a.escopo, workspace_id: a.workspace_id, base: a.base, baseAbs: a.baseAbs, dirAbs, forma: d.forma, tipo: d.t }, raizes, erros)));
        }
      }
    }
  }
  if (tipos.has("mcp_server")) {
    const fontes = [{ a: global, arq: join(ctx.home, ".config", "opencode", "opencode.json") }, ...ws.map((a) => ({ a, arq: join(a.baseAbs, "opencode.json") }))];
    for (const f of fontes) {
      const j = obj(await lerJson(ctx, f.arq, "opencode", "mcp_server", erros));
      if (j !== null) itens.push(...itensMcpDoMapa(f.a, f.arq, j["mcp"]));
    }
  }
  if (tipos.has("hook")) {
    // plugins JS do OpenCode: só LISTA (nome do arquivo); nada é lido nem executado
    for (const a of ws) {
      for (const pasta of ["plugin", "plugins"]) {
        let nomes: string[] = [];
        try {
          nomes = (await readdir(join(a.baseAbs, ".opencode", pasta))).filter((n) => /\.(m?[jt]s)$/.test(n)).sort().slice(0, 200);
        } catch {
          continue;
        }
        for (const n of nomes) {
          const nome = sanearNome(`oc-plugin:${n}`);
          itens.push({
            tipo: "hook", nome, nome_normalizado: normalizarNome(nome), plugin: null, autor: null, origem: "usuario", descricao: null, papel_sugerido: null,
            instalacao: { cli: "opencode", escopo: "projeto", workspace_id: a.workspace_id, base: "workspace", caminho_rel: `.opencode/${pasta}/${n}`.slice(0, 200), metodo: "nativo", estado: "presente", habilitada: true, criado_pelo_app: false, hash_conteudo: null, tamanho: null, mtime_ms: null, detalhe: { evento: "plugin", cli: "opencode", escopo: "projeto", gerenciado_pelo_app: false, gerenciado_pelo_metodo: false } },
          });
        }
      }
    }
  }
  if (tipos.has("rule")) {
    const fontes = [{ a: global, arq: join(ctx.home, ".config", "opencode", "AGENTS.md") }, ...ws.map((a) => ({ a, arq: join(a.baseAbs, "AGENTS.md") }))];
    for (const f of fontes) {
      const it = await itemRegra(ctx, f.a, f.arq, "AGENTS.md");
      if (it !== null) itens.push(it);
    }
  }
  return { itens, erros };
}

export async function varrerGemini(ctx: ContextoVarredura, tipos: ReadonlySet<TipoCatalogo>): Promise<ResultadoScanner> {
  const erros: ErroScanner[] = [];
  const itens: ItemEscaneado[] = [];
  const { global, ws, todos } = alvos(ctx, "gemini");
  if (tipos.has("mcp_server")) {
    for (const a of todos) {
      const arq = join(a.escopo === "global" ? ctx.home : a.baseAbs, ".gemini", "settings.json");
      const j = obj(await lerJson(ctx, arq, "gemini", "mcp_server", erros));
      if (j !== null) itens.push(...itensMcpDoMapa(a, arq, j["mcpServers"]));
    }
  }
  if (tipos.has("rule")) {
    const fontes = [{ a: global, arq: join(ctx.home, ".gemini", "GEMINI.md") }, ...ws.map((a) => ({ a, arq: join(a.baseAbs, "GEMINI.md") }))];
    for (const f of fontes) {
      const it = await itemRegra(ctx, f.a, f.arq, "GEMINI.md");
      if (it !== null) itens.push(it);
    }
  }
  if (tipos.has("plugin")) {
    let nomes: string[] = [];
    try {
      nomes = (await readdir(join(ctx.home, ".gemini", "extensions"))).sort().slice(0, 200);
    } catch {
      nomes = [];
    }
    for (const n of nomes) {
      const arq = join(ctx.home, ".gemini", "extensions", n, "gemini-extension.json");
      const j = obj(await lerJson(ctx, arq, "gemini", "plugin", erros));
      if (j === null) continue;
      const nome = sanearNome(typeof j["name"] === "string" ? j["name"] : n);
      itens.push({
        tipo: "plugin", nome, nome_normalizado: normalizarNome(nome), plugin: null, autor: null, origem: "terceiro",
        descricao: typeof j["description"] === "string" ? sanearTexto(j["description"], 600) || null : null, papel_sugerido: null,
        instalacao: { cli: "gemini", escopo: "global", workspace_id: "", base: "home", caminho_rel: `.gemini/extensions/${sanearNome(n)}`, metodo: "nativo", estado: "presente", habilitada: true, criado_pelo_app: false, hash_conteudo: null, tamanho: null, mtime_ms: null, detalhe: { versao: typeof j["version"] === "string" ? sanearTexto(j["version"], 40) : null } },
      });
    }
  }
  return { itens, erros };
}

export async function varrerPortatil(ctx: ContextoVarredura, tipos: ReadonlySet<TipoCatalogo>): Promise<ResultadoScanner> {
  const erros: ErroScanner[] = [];
  const itens: ItemEscaneado[] = [];
  if (!tipos.has("skill")) return { itens, erros };
  const raizes = await raizesConhecidas(ctx);
  const { todos } = alvos(ctx, "portatil");
  for (const a of todos) {
    itens.push(...(await varrerRaiz(ctx, { cli: "portatil", escopo: a.escopo, workspace_id: a.workspace_id, base: a.base, baseAbs: a.baseAbs, dirAbs: join(a.baseAbs, ".agents", "skills"), forma: "pasta_skill", tipo: "skill" }, raizes, erros)));
  }
  return { itens, erros };
}
