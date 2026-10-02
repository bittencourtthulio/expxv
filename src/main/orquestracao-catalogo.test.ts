// Política de skills/MCP no lançamento dos Panes (Fase 7): orquestração real + catálogo real (SQLite). Cobre o snapshot do piloto, os argumentos do Claude
// (strict-mcp, plugin efêmero), o settings com gates e deny, o gate de ponta a ponta pelos ganchos, `catalog_list` pela porta e a Missão livre intacta.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import type { PortaGanchos } from "../nucleo/mcp/portas";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoContas } from "../nucleo/provedores/contas";
import type { InstalacaoEscaneada } from "../nucleo/catalogo/tipos";
import type { ItemAgregado } from "../nucleo/catalogo/varredura";
import { criarBarramento } from "./barramento";
import { criarCatalogoOrqDoMain } from "./catalogo-orquestracao";
import { criarOrquestracao, type Orquestracao } from "./orquestracao";
import type { DepsDoServidorRemoto } from "./mcp-remoto";

afterEach(() => limpar());
const abertas: Orquestracao[] = [];
afterEach(async () => { while (abertas.length) await abertas.pop()?.encerrar(); });

const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};
const T = "2026-10-01T10:00:00.000Z";
const inst = (): InstalacaoEscaneada => ({ cli: "claude", escopo: "global", workspace_id: "", base: "home", caminho_rel: ".claude/skills/a/SKILL.md", metodo: "nativo", estado: "presente", habilitada: true, criado_pelo_app: false, hash_conteudo: "h", tamanho: 1, mtime_ms: 1, detalhe: {} });
const skill = (nome: string): ItemAgregado => ({ tipo: "skill", nome, nome_normalizado: nome.toLowerCase(), plugin: null, autor: null, origem: "usuario", descricao: `desc ${nome}`, papel_sugerido: null, instalacoes: [inst()] });

function montar() {
  const b = novoBanco();
  const { banco, repos } = b;
  const dados = criarTmp("orq-cat-dados-");
  const raiz = criarTmp("orq-cat-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  repos.catalogo.upsertLote([skill("pdf"), skill("docx")], T);
  const catalogo = criarCatalogoOrqDoMain({ repos, dirApp: dados, dirSkills: () => join(RAIZ_REPO, "resources", "skills") });
  let ganchos: PortaGanchos | null = null;
  let depsServidor: DepsDoServidorRemoto | null = null;
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes },
    banco, barramento: criarBarramento(), sessoes: async () => sessoes as never, dirApp: dados, executavelNode: "/app/Electron", electronComoNode: true,
    ativos: ATIVOS, atrasoFechamentoMs: 10, intervaloSegurancaMs: 50,
    catalogo: () => catalogo,
    iniciarServidor: (d, g) => {
      ganchos = g;
      depsServidor = d;
      return Promise.resolve({ url: "http://127.0.0.1:1/mcp", urlGanchos: "http://127.0.0.1:1/hooks", porta: 1, portaAnterior: null, portaReutilizada: true, emitirToken: (p) => `token-${p.pane_id}`, revogar: () => undefined, fechar: async () => undefined });
    },
  });
  abertas.push(orq);
  return { orq, repos, dados, ws, sessoes, missoes, ganchos: () => ganchos as PortaGanchos, deps: () => depsServidor as DepsDoServidorRemoto };
}
const ultima = (m: ReturnType<typeof montar>) => [...m.sessoes.sessoes.values()].at(-1)!;

describe("política de skills no piloto", () => {
  it("piloto agêntico no Claude: snapshot, --strict-mcp-config, --plugin-dir e settings com pre-skill/pre-mcp e deny das skills de fora", async () => {
    const m = montar();
    await m.orq.iniciar();
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "L", pedido: "x", clis: { piloto: "claude" } });
    const pane = missao.piloto_pane_id as string;
    const args = ultima(m).pedido["argumentos"] as string[];
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--plugin-dir") + 1]).toBe(join(m.dados, "panes", pane, "plugin"));
    expect(existsSync(join(m.dados, "panes", pane, "plugin", "skills", "ev-pilot", "SKILL.md"))).toBe(true);
    const settings = JSON.parse(readFileSync(join(m.dados, "panes", pane, "claude-settings.json"), "utf8")) as { permissions: { deny: string[] }; hooks: { PreToolUse: Array<{ matcher: string }> } };
    expect(settings.permissions.deny).toEqual(["Skill(docx)", "Skill(pdf)"]);
    expect(settings.hooks.PreToolUse.map((x) => x.matcher)).toEqual(expect.arrayContaining(["Skill", "mcp__.*"]));
    expect(m.repos.catalogo.lerSnapshotPane(pane)).toMatchObject({ cli: "claude", nivel_isolamento: "duro" });
  });

  it("gate ponta a ponta pelos ganchos: a skill fora da política é negada (evento), a embarcada do papel passa; MCP de usuário negado", async () => {
    const m = montar();
    await m.orq.iniciar();
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "L", pedido: "x", clis: { piloto: "claude" } });
    const ctx = { workspace_id: m.ws.id, mission_id: missao.id, pane_id: missao.piloto_pane_id as string };
    const g = m.ganchos();
    expect((await g.tratar("pre-skill", ctx, { tool_input: { skill: "ev-pilot" } })).saida).toBeNull();
    expect((await g.tratar("pre-skill", ctx, { tool_input: { skill: "pdf" } })).saida).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect((await g.tratar("pre-mcp", ctx, { tool_name: "mcp__github__create_issue" })).saida).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("política com `pdf` para o piloto: passa a valer (precedência papel) e `catalog_list` devolve só as permitidas", async () => {
    const m = montar();
    m.repos.catalogo.gravarPolitica({ workspace_id: m.ws.id, alvo_tipo: "papel", alvo_valor: "piloto", skills: ["pdf"], mcp_do_usuario: "nenhum", servidores_mcp: [] }, T);
    await m.orq.iniciar();
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "L", pedido: "x", clis: { piloto: "claude" } });
    const paneId = missao.piloto_pane_id as string;
    const cat = m.deps().catalogo!;
    const permitidas = await cat.permitidasDoPane(paneId);
    expect(permitidas).toEqual(expect.arrayContaining(["pdf", "evpilot"]));
    expect(permitidas).not.toContain("docx");
    const r = await cat.listar({ workspace_id: m.ws.id, pane_id: paneId, kind: "skill", query: null, limit: 25, cursor: null, permitidas });
    expect(r.items.map((i) => i.name)).toEqual(expect.arrayContaining(["pdf", "ev-pilot"]));
    expect(r.items.map((i) => i.name)).not.toContain("docx");
  });

  it("Missão livre: nada muda (sem snapshot, sem strict, sem plugin, sem gate de skill)", async () => {
    const m = montar();
    await m.orq.iniciar();
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "L", pedido: "x", clis: { piloto: "claude" } });
    const args = (ultima(m).pedido["argumentos"] as string[]) ?? [];
    expect(args).not.toContain("--plugin-dir");
    expect(args).not.toContain("--strict-mcp-config");
    expect(m.repos.catalogo.lerSnapshotPane(missao.piloto_pane_id as string)).toBeNull();
  });
});
