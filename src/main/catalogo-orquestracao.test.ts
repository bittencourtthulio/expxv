// Política de skills no main (Fase 7): banco SQLite real (migrations), snapshot persistido, gate por Pane, `catalog_list`, plugin efêmero e reattach.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalacaoEscaneada } from "../nucleo/catalogo/tipos";
import type { ItemAgregado } from "../nucleo/catalogo/varredura";
import { abrirBanco, type Banco } from "../nucleo/banco/banco";
import { migrar } from "../nucleo/banco/migrar";
import { criarRepositorios } from "../nucleo/banco/repos";
import { criarCatalogoOrqDoMain, type AlvoDaPolitica } from "./catalogo-orquestracao";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const T = "2026-10-01T10:00:00.000Z";
const inst = (o: Partial<InstalacaoEscaneada> = {}): InstalacaoEscaneada => ({ cli: "claude", escopo: "global", workspace_id: "", base: "home", caminho_rel: ".claude/skills/a/SKILL.md", metodo: "nativo", estado: "presente", habilitada: true, criado_pelo_app: false, hash_conteudo: "h", tamanho: 1, mtime_ms: 1, detalhe: {}, ...o });
const skill = (nome: string, o: Partial<ItemAgregado> = {}): ItemAgregado => ({ tipo: "skill", nome, nome_normalizado: nome.toLowerCase().replace(/[-_. ]/g, ""), plugin: null, autor: null, origem: "usuario", descricao: `desc ${nome}`, papel_sugerido: null, instalacoes: [inst()], ...o });

function montar() {
  const banco = abrirBanco(":memory:");
  abertos.push(banco);
  migrar(banco);
  const repos = criarRepositorios(banco);
  const ws = repos.workspace.criar({ nome: "w", raiz: "/tmp/w" });
  const missao = repos.mission.criar({ workspace_id: ws.id, modo: "squad", origem: "livre", titulo: "M" });
  const mkPane = (o: Record<string, unknown> = {}) => repos.pane.criar({ workspace_id: ws.id, mission_id: missao.id, tipo: "cli", cli: "claude", papel: "executor", ...o } as never);
  const dirApp = mkdtempSync(join(tmpdir(), "cat-orq-"));
  const eventos: Array<[string, unknown]> = [];
  const novoCat = () => criarCatalogoOrqDoMain({ repos, dirApp, dirSkills: () => join(process.cwd(), "resources", "skills"), emitir: (t, p) => eventos.push([t, p]) });
  repos.catalogo.upsertLote([skill("pdf"), skill("docx"), skill("xlsx"), skill("sprintx", { origem: "metodo" })], T);
  const alvo = (pane_id: string, o: Partial<AlvoDaPolitica> = {}): AlvoDaPolitica => ({ pane_id, workspace_id: ws.id, mission_id: missao.id, agente_id: null, modo: "squad", papel: "executor", cli: "claude", pedidas: null, membro: null, ...o });
  return { banco, repos, ws, missao, mkPane, dirApp, eventos, novoCat, alvo };
}

describe("preparar + gate", () => {
  it("política de 3 skills: as 3 passam e a 4ª é bloqueada; snapshot gravado e evento de isolamento duro", async () => {
    const m = montar();
    m.repos.catalogo.gravarPolitica({ workspace_id: m.ws.id, alvo_tipo: "papel", alvo_valor: "executor", skills: ["pdf", "docx", "xlsx"], mcp_do_usuario: "nenhum", servidores_mcp: [] }, T);
    const pane = m.mkPane();
    const cat = m.novoCat();
    const pol = await cat.preparar(m.alvo(pane.id));
    expect(pol?.resolvida.skills).toEqual(expect.arrayContaining(["pdf", "docx", "xlsx"]));
    expect(pol?.skillsConhecidas).toEqual(expect.arrayContaining(["pdf", "sprintx"]));
    for (const s of ["pdf", "docx", "xlsx"]) expect(cat.gate(pane.id, "skill", s).permitido).toBe(true);
    const d = cat.gate(pane.id, "skill", "sprintx");
    expect(d.permitido).toBe(false);
    expect(d.motivo).toContain("skill_not_allowed: sprintx");
    expect(m.repos.catalogo.lerSnapshotPane(pane.id)).toMatchObject({ cli: "claude", nivel_isolamento: "duro" });
    expect(m.eventos[0]?.[0]).toBe("catalog.isolation_applied");
  });
  it("Codex: isolamento parcial registrado (catalog.isolation_partial) e nada de plugin", async () => {
    const m = montar();
    const pane = m.mkPane({ cli: "codex" });
    const pol = await m.novoCat().preparar(m.alvo(pane.id, { cli: "codex" }));
    expect(pol?.temPluginEfemero).toBe(false);
    expect(m.eventos[0]?.[0]).toBe("catalog.isolation_partial");
    expect(m.repos.catalogo.lerSnapshotPane(pane.id)?.nivel_isolamento).toBe("parcial");
  });
  it("plugin efêmero só com as ev-* permitidas ao papel, dentro de <dirApp>/panes/<pane>/plugin", async () => {
    const m = montar();
    const pane = m.mkPane();
    const pol = await m.novoCat().preparar(m.alvo(pane.id));
    expect(pol?.temPluginEfemero).toBe(true);
    const raiz = join(m.dirApp, "panes", pane.id, "plugin");
    expect(existsSync(join(raiz, "skills", "ev-builder", "SKILL.md"))).toBe(true);
    expect(existsSync(join(raiz, "skills", "ev-pilot"))).toBe(false);
    expect(readFileSync(join(raiz, ".claude-plugin", "plugin.json"), "utf8")).toContain("ev-embarcadas");
  });
  it("livre: sem snapshot e sem isolamento; Pane livre/avulso sem snapshot é liberado", async () => {
    const m = montar();
    const pane = m.mkPane({ papel: "nenhum" });
    const cat = m.novoCat();
    expect(await cat.preparar(m.alvo(pane.id, { modo: "livre" }))).toBeNull();
    expect(cat.gate(pane.id, "skill", "qualquer").permitido).toBe(true);
    expect(cat.gate("pane_inexistente", "skill", "qualquer").permitido).toBe(true);
  });
  it("FALHA FECHADA: Pane orquestrado de Missão squad SEM snapshot é negado", () => {
    const m = montar();
    const pane = m.mkPane();
    const cat = m.novoCat();
    expect(cat.gate(pane.id, "skill", "pdf").permitido).toBe(false);
    expect(cat.gate(pane.id, "mcp", "mcp__github__x").permitido).toBe(false);
  });
  it("R-3: depois de 'reiniciar o app' (novo adaptador, mesmo banco) o gate segue correto para o Pane sobrevivente", async () => {
    const m = montar();
    m.repos.catalogo.gravarPolitica({ workspace_id: m.ws.id, alvo_tipo: "papel", alvo_valor: "executor", skills: ["pdf"], mcp_do_usuario: "nenhum", servidores_mcp: [] }, T);
    const pane = m.mkPane();
    await m.novoCat().preparar(m.alvo(pane.id));
    const reiniciado = m.novoCat();
    expect(reiniciado.gate(pane.id, "skill", "pdf").permitido).toBe(true);
    expect(reiniciado.gate(pane.id, "skill", "docx").permitido).toBe(false);
  });
  it("perfil do membro de squad é APLICADO: só estreita a política gravada; pedidas estreitam mais", async () => {
    const m = montar();
    m.repos.catalogo.gravarPolitica({ workspace_id: m.ws.id, alvo_tipo: "papel", alvo_valor: "executor", skills: ["pdf", "docx"], mcp_do_usuario: "nenhum", servidores_mcp: [] }, T);
    const cat = m.novoCat();
    const a = m.mkPane();
    await cat.preparar(m.alvo(a.id, { agente_id: "eq.impl", membro: { skills_permitidas: ["docx", "xlsx"], mcps_permitidos: [] } }));
    // política do papel = pdf+docx; o membro (docx+xlsx) só ESTREITA: docx (+ mínimo do papel); xlsx nunca entra e pdf sai
    expect(m.repos.catalogo.lerSnapshotPane(a.id)?.skills).toEqual(["docx", "evbuilder", "evevidencebeforedone"]);
    expect(cat.gate(a.id, "skill", "pdf").permitido).toBe(false);
    expect(cat.gate(a.id, "skill", "xlsx").permitido).toBe(false);
    const b = m.mkPane();
    await cat.preparar(m.alvo(b.id, { pedidas: ["pdf", "xlsx"] }));
    expect(cat.gate(b.id, "skill", "pdf").permitido).toBe(true);
    expect(cat.gate(b.id, "skill", "xlsx").permitido).toBe(false);
    expect(cat.gate(b.id, "skill", "docx").permitido).toBe(false);
  });
  it("respawn recalcula o snapshot (cache invalidado)", async () => {
    const m = montar();
    const pane = m.mkPane();
    const cat = m.novoCat();
    await cat.preparar(m.alvo(pane.id));
    expect(cat.gate(pane.id, "skill", "pdf").permitido).toBe(false);
    m.repos.catalogo.gravarPolitica({ workspace_id: m.ws.id, alvo_tipo: "papel", alvo_valor: "executor", skills: ["pdf"], mcp_do_usuario: "nenhum", servidores_mcp: [] }, T);
    await cat.preparar(m.alvo(pane.id));
    expect(cat.gate(pane.id, "skill", "pdf").permitido).toBe(true);
  });
});

describe("porta do MCP", () => {
  it("catalog_list de skill devolve SÓ as permitidas do snapshot (mais as ev-* do papel, sem caminho)", async () => {
    const m = montar();
    m.repos.catalogo.gravarPolitica({ workspace_id: m.ws.id, alvo_tipo: "papel", alvo_valor: "executor", skills: ["pdf", "docx"], mcp_do_usuario: "nenhum", servidores_mcp: [] }, T);
    const pane = m.mkPane();
    const cat = m.novoCat();
    await cat.preparar(m.alvo(pane.id));
    const permitidas = await cat.portaMcp.permitidasDoPane(pane.id);
    const r = await cat.portaMcp.listar({ workspace_id: m.ws.id, pane_id: pane.id, kind: "skill", query: null, limit: 25, cursor: null, permitidas });
    expect(r.items.map((i) => i.name).sort()).toEqual(["docx", "ev-builder", "ev-evidence-before-done", "pdf"]);
    expect(r.items.every((i) => i.allowed)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/\.claude|SKILL\.md/);
  });
  it("paginação por cursor e busca", async () => {
    const m = montar();
    m.repos.catalogo.upsertLote(Array.from({ length: 30 }, (_, i) => skill(`extra${String(i).padStart(2, "0")}`)), T);
    const cat = m.novoCat();
    const base = { workspace_id: m.ws.id, pane_id: "p", kind: "skill" as const, permitidas: null };
    const p1 = await cat.portaMcp.listar({ ...base, query: "extra", limit: 25, cursor: null });
    expect(p1.items).toHaveLength(25);
    expect(p1.next_cursor).toBe("25");
    const p2 = await cat.portaMcp.listar({ ...base, query: "extra", limit: 25, cursor: p1.next_cursor });
    expect(p2.items).toHaveLength(5);
    expect(p2.next_cursor).toBeNull();
    expect((await cat.portaMcp.listar({ ...base, query: null, limit: 5, cursor: "lixo" })).items).toHaveLength(5);
  });
  it("permitidasDoPapel valida pane_spawn.skills: livre = sem filtro; squad = política do papel", async () => {
    const m = montar();
    m.repos.catalogo.gravarPolitica({ workspace_id: m.ws.id, alvo_tipo: "papel", alvo_valor: "revisor", skills: ["pdf"], mcp_do_usuario: "nenhum", servidores_mcp: [] }, T);
    const cat = m.novoCat();
    const base = { workspace_id: m.ws.id, mission_id: m.missao.id, agente_id: null };
    expect(await cat.portaMcp.permitidasDoPapel({ ...base, modo: "livre", papel: "revisor" })).toBeNull();
    expect(await cat.portaMcp.permitidasDoPapel({ ...base, modo: "squad", papel: "revisor" })).toEqual(["evevidencebeforedone", "evreviewer", "pdf"]);
  });
});
