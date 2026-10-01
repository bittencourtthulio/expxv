import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptadorOpenCode, codigoDoPlugin } from "./opencode";

const fx = (nome: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/atividade", nome), "utf8")) as Record<string, unknown>;
const F = "ses_f15645dd5ffeLkccE0nMDmJKXG";

describe("adaptador do OpenCode", () => {
  it("atividade: avisos do plugin viram trabalhando/aguardando/pronto; o resto não muda o estado", () => {
    const a = (n: string) => adaptadorOpenCode.interpretarAtividade!(fx(n));
    expect(a("opencode-status-busy.json")).toBe("trabalhando");
    expect(a("opencode-permissao.json")).toBe("aguardando");
    expect(a("opencode-idle.json")).toBe("pronto");
    expect(a("opencode-subagente-iniciado.json")).toBeNull();
    expect(adaptadorOpenCode.interpretarAtividade!({ evento: "atividade", estado: "dormindo" })).toBeNull();
    expect(adaptadorOpenCode.interpretarAtividade!("x")).toBeNull();
  });
  it("subagente: início (sem o sufixo do título), ferramenta, resultado, texto e fim; sem agent_id é ignorado", () => {
    const i = (c: unknown) => adaptadorOpenCode.interpretar(c);
    expect(i(fx("opencode-subagente-iniciado.json"))).toEqual({ tipo: "iniciado", subagente_id: F, rotulo: "general", descricao: "List tmp directory", arquivo: null });
    expect(i({ evento: "ferramenta", agent_id: F, tool: "bash", input: { command: "ls /tmp" }, output: null })).toMatchObject({ tipo: "atividade", linhas: [{ papel: "ferramenta", texto: "bash: ls /tmp" }] });
    expect(i({ evento: "ferramenta", agent_id: F, tool: "bash", input: null, output: "a\nb\n" })).toMatchObject({ linhas: [{ papel: "resultado", texto: "a\nb" }] });
    expect(i({ evento: "texto", agent_id: F, texto: "pronto" })).toMatchObject({ linhas: [{ papel: "texto", texto: "pronto" }] });
    expect(i({ evento: "concluido", agent_id: F, resumo: "fim" })).toEqual({ tipo: "concluido", subagente_id: F, arquivo: null, resumo: "fim" });
    expect(i({ evento: "iniciado", titulo: "x" })).toBeNull();
    expect(i({ evento: "atividade", estado: "pronto" })).toBeNull();
  });
  it("configuração: plugin gravado em arquivo do app e OPENCODE_CONFIG_CONTENT apontando para ele", () => {
    let nome = "";
    let fonte = "";
    const alvo = { url: "http://127.0.0.1:1/atividade/sessao_oc/tok", sessao_id: "sessao_oc", permissao: "seguro" as const, gravarArquivo: (n: string, c: string) => { nome = n; fonte = c; return "/tmp/app/plugin.mjs"; } };
    expect(adaptadorOpenCode.argumentosDeObservacao(alvo)).toEqual([]);
    const env = adaptadorOpenCode.ambienteDeObservacao!(alvo);
    expect(JSON.parse(env["OPENCODE_CONFIG_CONTENT"]!)).toEqual({ plugin: ["file:///tmp/app/plugin.mjs"] });
    expect(nome.endsWith(".mjs")).toBe(true);
    expect(fonte).toContain("/atividade/sessao_oc/tok");
  });

  async function rodarPlugin(eventos: unknown[]): Promise<Array<Record<string, unknown>>> {
    const enviados: Array<Record<string, unknown>> = [];
    const fonte = codigoDoPlugin("http://127.0.0.1:1/atividade/s/t");
    const modulo = await import(`data:text/javascript;base64,${Buffer.from(fonte).toString("base64")}`) as { PluginAtividade: () => Promise<{ event: (e: unknown) => Promise<void> }> };
    const original = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init: { body: string }) => { enviados.push(JSON.parse(init.body) as Record<string, unknown>); return new Response("{}"); }) as typeof fetch;
    try {
      const { event } = await modulo.PluginAtividade();
      for (const e of eventos) await event(e);
    } finally { globalThis.fetch = original; }
    return enviados;
  }

  it("plugin: sessão raiz avisa atividade só quando muda; sessões-filhas viram subagentes, uma vez por parte e na ordem", async () => {
    const tool = (status: string, extra: object) => ({ event: { type: "message.part.updated", properties: { part: { id: "p1", sessionID: "ses_filho", type: "tool", tool: "bash", state: { status, input: { command: "date" }, ...extra } } } } });
    const enviados = await rodarPlugin([
      { event: { type: "session.created", properties: { info: { id: "ses_pai" } } } },
      { event: { type: "session.status", properties: { sessionID: "ses_pai", status: { type: "busy" } } } },
      { event: { type: "session.status", properties: { sessionID: "ses_pai", status: { type: "busy" } } } },
      { event: { type: "permission.updated", properties: { sessionID: "ses_pai", id: "perm1" } } },
      { event: { type: "permission.replied", properties: { sessionID: "ses_pai", permissionID: "perm1", response: "once" } } },
      { event: { type: "session.created", properties: { info: { id: "ses_filho", parentID: "ses_pai", agent: "general", title: "T (@general subagent)" } } } },
      { event: { type: "session.status", properties: { sessionID: "ses_filho", status: { type: "busy" } } } }, // filho não muda a atividade da raiz
      tool("pending", {}), tool("running", {}), tool("completed", { output: "hoje" }), tool("completed", { output: "hoje" }),
      { event: { type: "message.part.updated", properties: { part: { id: "p2", sessionID: "ses_filho", type: "text", text: "feito", time: { end: 2 } } } } },
      { event: { type: "session.idle", properties: { sessionID: "ses_filho" } } },
      { event: { type: "session.idle", properties: { sessionID: "ses_filho" } } },
      { event: { type: "session.idle", properties: { sessionID: "ses_pai" } } },
    ]);
    expect(enviados.map((e) => e["evento"] === "atividade" ? `atividade:${e["estado"]}` : e["evento"])).toEqual([
      "atividade:trabalhando", "atividade:aguardando", "atividade:trabalhando",
      "iniciado", "ferramenta", "ferramenta", "texto", "concluido", "atividade:pronto",
    ]);
    expect(enviados.find((e) => e["evento"] === "concluido")).toMatchObject({ agent_id: "ses_filho", resumo: "feito" });
  });
});
