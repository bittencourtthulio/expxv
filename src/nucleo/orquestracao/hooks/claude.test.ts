import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HandoffRegistrado } from "../../mcp/portas";
import { PRODUTO } from "../../produto";
import { gravarBriefing } from "../briefing";
import {
  MARCADOR_GERENCIADO,
  MENSAGEM_STOP,
  criarGanchosClaude,
  gerarSettingsDoPane,
  gravarSettingsDoPane,
  type ContextoPane,
  type OpcoesSettingsPane,
} from "./claude";

const opcoes = (p: Partial<OpcoesSettingsPane> = {}): OpcoesSettingsPane => ({
  dirApp: "/app/dados", pane_id: "pane_w1", papel: "executor", nomeServidor: PRODUTO.id, executavelNode: "/usr/bin/node", script: "/app/gancho.mjs", variavelUrl: "X_URL", variavelToken: "X_TOKEN", ...p,
});

describe("settings por Pane", () => {
  it("worker: marcado como gerenciado, Stop×2, PostToolUse só em handoff_submit, SessionStart", () => {
    const { conteudo, caminho } = gerarSettingsDoPane(opcoes());
    const j = JSON.parse(conteudo);
    expect(j[MARCADOR_GERENCIADO]).toBe(true);
    expect(MARCADOR_GERENCIADO).toBe(`managed_by_${PRODUTO.id}`);
    expect(j.hooks.Stop[0].hooks).toHaveLength(2);
    expect(j.hooks.Stop[0].hooks.map((h: { command: string }) => h.command.split(" ")[2])).toEqual(["stop-handoff", "stop-relatorio"]);
    expect(j.hooks.PostToolUse[0].matcher).toBe(`mcp__${PRODUTO.id}__handoff_submit`);
    expect(j.hooks.SessionStart).toHaveLength(1);
    expect(j.hooks.PreToolUse).toBeUndefined();
    expect(caminho).toBe(join("/app/dados", "panes", "pane_w1", "claude-settings.json"));
  });
  it("piloto: guarda PreToolUse nas ferramentas de escrita, sem hooks de handoff", () => {
    const j = JSON.parse(gerarSettingsDoPane(opcoes({ papel: "piloto" })).conteudo);
    expect(j.hooks.PreToolUse[0].matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
    expect(j.hooks.Stop).toBeUndefined();
    expect(j.hooks.PostToolUse).toBeUndefined();
  });
  it("comando: caminhos entre aspas, Electron como Node opcional", () => {
    const c = JSON.parse(gerarSettingsDoPane(opcoes({ executavelNode: "/Applications/Meu App/app", electronComoNode: true })).conteudo).hooks.SessionStart[0].hooks[0].command as string;
    expect(c.startsWith('ELECTRON_RUN_AS_NODE=1 "/Applications/Meu App/app" "/app/gancho.mjs" session-start')).toBe(true);
  });
  it("pane_id com traversal é recusado", () => {
    expect(() => gerarSettingsDoPane(opcoes({ pane_id: "../../.claude" }))).toThrow();
  });

  function hash(dir: string): string {
    const h = createHash("sha256");
    const andar = (d: string): void => {
      for (const n of readdirSync(d).sort()) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) andar(p);
        else h.update(p).update(readFileSync(p));
      }
    };
    andar(dir);
    return h.digest("hex");
  }

  it("grava só em <dirApp>/panes/<pane>/ com modo 0600 e NUNCA toca os arquivos do usuário", async () => {
    const casa = mkdtempSync(join(tmpdir(), "casa-"));
    mkdirSync(join(casa, ".claude"), { recursive: true });
    writeFileSync(join(casa, ".claude", "settings.json"), '{"hooks":{"Stop":[]}}');
    const projeto = mkdtempSync(join(tmpdir(), "proj-"));
    mkdirSync(join(projeto, ".claude"), { recursive: true });
    writeFileSync(join(projeto, ".claude", "settings.json"), '{"a":1}');
    const antes = [hash(casa), hash(projeto)];
    const dirApp = mkdtempSync(join(tmpdir(), "app-"));
    const caminho = await gravarSettingsDoPane(opcoes({ dirApp }));
    expect(caminho.startsWith(join(dirApp, "panes"))).toBe(true);
    expect(statSync(caminho).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(caminho, "utf8"))[MARCADOR_GERENCIADO]).toBe(true);
    expect([hash(casa), hash(projeto)]).toEqual(antes);
    expect(readdirSync(casa)).toEqual([".claude"]);
  });
});

function montarGanchos(opc: { handoff?: HandoffRegistrado | null; legivel?: boolean; ctx?: Partial<ContextoPane> | null; raiz?: string; pacote?: (paneId: string) => Promise<string | null> } = {}) {
  const chamadas = { falha: [] as unknown[], sondar: 0 };
  const estado = { handoff: opc.handoff ?? null, legivel: opc.legivel ?? true };
  const raiz = opc.raiz ?? mkdtempSync(join(tmpdir(), "ganchos-"));
  const ganchos = criarGanchosClaude({
    handoff: {
      doPane: async () => estado.handoff,
      relatorioLegivel: async () => estado.legivel,
      registrarFalha: async (d) => { chamadas.falha.push(d); return { handoff_id: "h" }; },
    },
    fila: { sondar: async () => { chamadas.sondar += 1; } },
    contexto: async () => (opc.ctx === null ? null : { workspace_id: "ws_1", mission_id: "mis_1", papel: "executor", task_id: "tsk_1", task_ref: "T-01.01", briefing_path: null, ...opc.ctx }),
    raiz: async () => raiz,
    ...(opc.pacote === undefined ? {} : { pacote: opc.pacote }),
  });
  const c = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "w1" };
  return { ganchos, chamadas, estado, c, raiz };
}

describe("Stop hook (handoff)", () => {
  it("sem handoff: barra com a mensagem do contrato; após 3 tentativas libera e marca failed uma vez", async () => {
    const { ganchos, chamadas, c } = montarGanchos();
    for (let i = 0; i < 3; i++) {
      const r = await ganchos.tratar("stop-handoff", c, {});
      expect(r.saida).toEqual({ decision: "block", reason: MENSAGEM_STOP });
    }
    expect(chamadas.falha).toHaveLength(0);
    expect((await ganchos.tratar("stop-handoff", c, {})).saida).toBeNull(); // 4ª: libera
    expect(chamadas.falha).toHaveLength(1);
    expect(chamadas.falha[0]).toMatchObject({ pane_id: "w1", task_id: "tsk_1", mission_id: "mis_1" });
    await ganchos.tratar("stop-handoff", c, {});
    expect(chamadas.falha).toHaveLength(1); // nunca marca duas vezes
  });

  it("mensagem do contrato é literal", () => {
    expect(MENSAGEM_STOP).toBe("O worker tentou encerrar o turno sem chamar handoff_submit. O orquestrador está bloqueado esperando. Chame handoff_submit com o resumo do trabalho antes de encerrar.");
  });

  it("com handoff registrado libera e zera o contador", async () => {
    const { ganchos, estado, c } = montarGanchos();
    await ganchos.tratar("stop-handoff", c, {});
    estado.handoff = { handoff_id: "h1", relatorio_path: "r.md", status: "ok" };
    expect((await ganchos.tratar("stop-handoff", c, {})).saida).toBeNull();
  });

  it("Pane sem task, piloto ou desconhecido: nunca barra", async () => {
    for (const ctx of [null, { task_id: null }, { papel: "piloto" as const }]) {
      const { ganchos, c } = montarGanchos({ ctx });
      expect((await ganchos.tratar("stop-handoff", c, {})).saida).toBeNull();
    }
  });
});

describe("Stop hook (relatório)", () => {
  const h: HandoffRegistrado = { handoff_id: "h1", relatorio_path: "r.md", status: "ok" };
  it("handoff registrado mas relatório ausente/vazio: barra; legível: libera", async () => {
    const { ganchos, estado, c } = montarGanchos({ handoff: h, legivel: false });
    expect((await ganchos.tratar("stop-relatorio", c, {})).saida).toMatchObject({ decision: "block" });
    estado.legivel = true;
    expect((await ganchos.tratar("stop-relatorio", c, {})).saida).toBeNull();
  });
  it("sem handoff, deixa o outro hook decidir (não conta tentativa em dobro)", async () => {
    const { ganchos, c } = montarGanchos();
    expect((await ganchos.tratar("stop-relatorio", c, {})).saida).toBeNull();
    for (let i = 0; i < 3; i++) expect((await ganchos.tratar("stop-handoff", c, {})).saida).toMatchObject({ decision: "block" });
  });
  it("esgota as 3 tentativas também por relatório inválido", async () => {
    const { ganchos, chamadas, c } = montarGanchos({ handoff: h, legivel: false });
    for (let i = 0; i < 3; i++) expect((await ganchos.tratar("stop-relatorio", c, {})).saida).not.toBeNull();
    expect((await ganchos.tratar("stop-relatorio", c, {})).saida).toBeNull();
    expect(chamadas.falha).toHaveLength(1);
  });
});

describe("PostToolUse, SessionStart e PreToolUse", () => {
  it("PostToolUse só acorda (sondar a fila) depois que o handoff foi persistido", async () => {
    const t = montarGanchos();
    await t.ganchos.tratar("post-tool-use", t.c, { tool_name: `mcp__${PRODUTO.id}__handoff_submit` });
    expect(t.chamadas.sondar).toBe(0);
    t.estado.handoff = { handoff_id: "h", relatorio_path: "r.md", status: "ok" };
    await t.ganchos.tratar("post-tool-use", t.c, {});
    expect(t.chamadas.sondar).toBe(1);
  });

  it("SessionStart injeta instruções do papel + briefing do card", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "ss-"));
    const rel = await gravarBriefing(raiz, { mission_id: "mis_1", task_ref: "T-01.01", titulo: "x", papel: "executor", contrato: "FAÇA A COISA" });
    const { ganchos, c } = montarGanchos({ raiz, ctx: { briefing_path: rel } });
    const r = await ganchos.tratar("session-start", c, {});
    const ctx = (r.saida as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }).hookSpecificOutput;
    expect(ctx.hookEventName).toBe("SessionStart");
    expect(ctx.additionalContext).toContain("handoff_submit");
    expect(ctx.additionalContext).toContain("FAÇA A COISA");
    expect(ctx.additionalContext).toContain(`${PRODUTO.pastaNoProjeto}/missoes/mis_1/briefing-T-01.01.md`);
  });

  it("Fase 8: SessionStart do worker anexa o pacote da Missão; falha ou vazio não muda nada; o piloto nunca recebe pelo hook", async () => {
    const pacote = '<contexto_projeto tipo="dados">\nAVISO: dado histórico\n- [decisao · agente · 2026-10-01] usar SQLite\n</contexto_projeto>';
    const chamado: string[] = [];
    const com = montarGanchos({ pacote: async (id) => { chamado.push(id); return pacote; } });
    const ctx = ((await com.ganchos.tratar("session-start", com.c, {})).saida as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain(pacote);
    expect(ctx.indexOf("handoff_submit")).toBeLessThan(ctx.indexOf("<contexto_projeto tipo="));
    expect(chamado).toEqual(["w1"]);
    const vazio = montarGanchos({ pacote: async () => null });
    expect(JSON.stringify((await vazio.ganchos.tratar("session-start", vazio.c, {})).saida)).not.toContain("<contexto_projeto tipo=");
    const quebrado = montarGanchos({ pacote: async () => { throw new Error("boom"); } });
    expect(JSON.stringify((await quebrado.ganchos.tratar("session-start", quebrado.c, {})).saida)).toContain("handoff_submit");
    const piloto = montarGanchos({ ctx: { papel: "piloto" }, pacote: async () => pacote });
    expect(JSON.stringify((await piloto.ganchos.tratar("session-start", piloto.c, {})).saida)).not.toContain("<contexto_projeto tipo=");
  });

  it("SessionStart do revisor usa o prompt do revisor", async () => {
    const { ganchos, c } = montarGanchos({ ctx: { papel: "revisor" } });
    const r = await ganchos.tratar("session-start", c, {});
    expect(JSON.stringify(r.saida)).toContain("revisor");
  });

  it("PreToolUse do piloto nega escrita em src/ e libera a pasta do produto; workers não são afetados", async () => {
    const piloto = montarGanchos({ ctx: { papel: "piloto" }, raiz: "/ws/projeto" });
    const negado = await piloto.ganchos.tratar("pre-tool-use", piloto.c, { tool_name: "Write", tool_input: { file_path: "/ws/projeto/src/a.ts" }, cwd: "/ws/projeto" });
    expect(negado.saida).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
    const ok = await piloto.ganchos.tratar("pre-tool-use", piloto.c, { tool_name: "Write", tool_input: { file_path: `/ws/projeto/${PRODUTO.pastaNoProjeto}/missoes/m/briefing-x.md` }, cwd: "/ws/projeto" });
    expect(ok.saida).toBeNull();
    const leitura = await piloto.ganchos.tratar("pre-tool-use", piloto.c, { tool_name: "Read", tool_input: { file_path: "/ws/projeto/src/a.ts" } });
    expect(leitura.saida).toBeNull();
    const worker = montarGanchos({ raiz: "/ws/projeto" });
    expect((await worker.ganchos.tratar("pre-tool-use", worker.c, { tool_name: "Write", tool_input: { file_path: "/ws/projeto/src/a.ts" } })).saida).toBeNull();
  });

  it("evento desconhecido é inofensivo", async () => {
    const t = montarGanchos();
    expect((await t.ganchos.tratar("qualquer", t.c, {})).saida).toBeNull();
  });
});
