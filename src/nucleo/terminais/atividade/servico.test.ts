import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { EventoTerminal } from "../../../compartilhado/terminais";
import { adaptadorCodex } from "./adaptadores/codex";
import { adaptadorOpenCode } from "./adaptadores/opencode";
import { HeuristicaOciosidade, ServicoAtividade, type EventoAtividadeParcial } from "./servico";

const pastas: string[] = [];
const pasta = (): string => { const p = mkdtempSync(join(tmpdir(), "atividade-")); pastas.push(p); return p; };
afterEach(() => { pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })); });

const fx = (nome: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/atividade", nome), "utf8")) as Record<string, unknown>;
const esperar = async (condicao: () => boolean, ms = 3000): Promise<void> => {
  const limite = Date.now() + ms;
  while (!condicao()) { if (Date.now() > limite) throw new Error("tempo esgotado"); await new Promise((r) => setTimeout(r, 10)); }
};
const criar = (extra: Partial<ConstructorParameters<typeof ServicoAtividade>[0]> = {}) => {
  const eventos: Array<[string, EventoAtividadeParcial]> = [];
  const servico = new ServicoAtividade({ diretorio: pasta(), emitir: (id, e) => eventos.push([id, e]), intervalo_ms: 10, ...extra });
  return { servico, eventos };
};

describe("ServicoAtividade: HTTP local", () => {
  async function urlDaSessao(servico: ServicoAtividade, sessao = "sessao_pai"): Promise<string> {
    await servico.iniciar();
    const args = servico.argumentosPara("claude", sessao);
    const cfg = JSON.parse(readFileSync(args[1]!, "utf8")) as { hooks: { Stop: Array<{ hooks: Array<{ url: string }> }> } };
    return cfg.hooks.Stop[0]!.hooks[0]!.url;
  }

  it("escuta só em 127.0.0.1 numa porta efêmera", async () => {
    const { servico } = criar();
    await servico.iniciar();
    expect(servico.porta).toBeGreaterThan(0);
    const url = await urlDaSessao(servico);
    expect(url.startsWith(`http://127.0.0.1:${servico.porta}/atividade/sessao_pai/`)).toBe(true);
    await servico.fechar();
  });

  it("token inválido, sessão desconhecida ou sem token respondem 401; GET 405; rota estranha 404", async () => {
    const { servico, eventos } = criar();
    const url = await urlDaSessao(servico);
    const corpo = JSON.stringify(fx("claude-UserPromptSubmit.json"));
    expect((await fetch(url.replace(/\/[^/]+$/, "/token-errado"), { method: "POST", body: corpo })).status).toBe(401);
    expect((await fetch(url.replace("/sessao_pai/", "/sessao_outra/"), { method: "POST", body: corpo })).status).toBe(401);
    expect((await fetch(url.replace(/\/[^/]+$/, "/"), { method: "POST", body: corpo })).status).toBe(401);
    expect((await fetch(url, { method: "GET" })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${servico.porta}/outra/rota`, { method: "POST", body: corpo })).status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(eventos).toEqual([]);
    await servico.fechar();
  });

  it("token válido responde 200 com JSON e gera o evento de atividade", async () => {
    const { servico, eventos } = criar();
    const url = await urlDaSessao(servico);
    const r = await fetch(url, { method: "POST", body: JSON.stringify(fx("claude-UserPromptSubmit.json")) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({});
    await esperar(() => eventos.length === 1);
    expect(eventos[0]).toEqual(["sessao_pai", { tipo: "atividade", atividade: "trabalhando" }]);
    await servico.fechar();
  });

  it("corpo acima de 1 MiB é recusado (413) e nada é processado; JSON inválido não derruba o serviço", async () => {
    const { servico, eventos } = criar();
    const url = await urlDaSessao(servico);
    const grande = JSON.stringify({ ...fx("claude-UserPromptSubmit.json"), prompt: "x".repeat(1024 * 1024 + 10) });
    const r = await fetch(url, { method: "POST", body: grande }).catch(() => null);
    expect(r === null || r.status === 413).toBe(true);
    const ruim = await fetch(url, { method: "POST", body: "{quebrado" });
    expect(ruim.status).toBe(200);
    await new Promise((res) => setTimeout(res, 50));
    expect(eventos).toEqual([]);
    expect((await fetch(url, { method: "POST", body: JSON.stringify(fx("claude-Stop.json")) })).status).toBe(200);
    await esperar(() => eventos.length === 1);
    await servico.fechar();
  });

  it("encerrar a sessão invalida o token (401) e apaga o arquivo de apoio; ferramenta sem adaptador não ganha nada", async () => {
    const { servico } = criar();
    await servico.iniciar();
    expect(servico.observacaoPara("gemini", "sessao_x")).toEqual({ argumentos: [], ambiente: {} });
    const args = servico.argumentosPara("claude", "sessao_y");
    expect(existsSync(args[1]!)).toBe(true);
    const url = (JSON.parse(readFileSync(args[1]!, "utf8")) as { hooks: { Stop: Array<{ hooks: Array<{ url: string }> }> } }).hooks.Stop[0]!.hooks[0]!.url;
    servico.encerrarSessao("sessao_y");
    expect(existsSync(args[1]!)).toBe(false);
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
    await servico.fechar();
  });

  it("antes de iniciar (ou depois de fechar) não entrega observação", async () => {
    const { servico } = criar();
    expect(servico.observacaoPara("claude", "s")).toEqual({ argumentos: [], ambiente: {} });
    await servico.iniciar();
    await servico.fechar();
    expect(servico.observacaoPara("claude", "s")).toEqual({ argumentos: [], ambiente: {} });
  });
});

describe("ServicoAtividade: payloads reais viram eventos", () => {
  it("Claude: prompt, ferramenta, permissão, retorno à ferramenta e Stop; só emite quando a atividade muda", async () => {
    const { servico, eventos } = criar();
    await servico.iniciar();
    servico.observacaoPara("claude", "sessao_a");
    for (const n of ["claude-UserPromptSubmit", "claude-PostToolUse", "claude-Notification-permissao", "claude-PostToolUse", "claude-Stop"]) await servico.receber("sessao_a", fx(`${n}.json`));
    expect(eventos).toEqual([
      ["sessao_a", { tipo: "atividade", atividade: "trabalhando" }],
      ["sessao_a", { tipo: "atividade", atividade: "aguardando" }],
      ["sessao_a", { tipo: "atividade", atividade: "trabalhando" }],
      ["sessao_a", { tipo: "atividade", atividade: "pronto" }],
    ]);
    await servico.fechar();
  });

  it("Codex: permissão → aguardando; Stop de subagente não vira pronto; conversa uma vez", async () => {
    const { servico, eventos } = criar({ adaptadores: [adaptadorCodex] });
    await servico.iniciar();
    servico.observacaoPara("codex", "sessao_cx", "automatico");
    for (const n of ["codex-UserPromptSubmit", "codex-PermissionRequest", "codex-PreToolUse", "codex-subagente-Stop", "codex-Stop"]) await servico.receber("sessao_cx", fx(`${n}.json`));
    expect(eventos.map(([, e]) => e)).toEqual([
      { tipo: "conversa", conversa_id: "019a3c5e-7d21-7f00-9c4b-0a1b2c3d4e5f" },
      { tipo: "atividade", atividade: "trabalhando" },
      { tipo: "atividade", atividade: "aguardando" },
      { tipo: "atividade", atividade: "trabalhando" },
      { tipo: "atividade", atividade: "pronto" },
    ]);
    await servico.fechar();
  });

  it("OpenCode: avisos do plugin viram atividade", async () => {
    const { servico, eventos } = criar({ adaptadores: [adaptadorOpenCode] });
    await servico.iniciar();
    const obs = servico.observacaoPara("opencode", "sessao_oc");
    const arquivo = new URL((JSON.parse(obs.ambiente["OPENCODE_CONFIG_CONTENT"]!) as { plugin: string[] }).plugin[0]!).pathname;
    expect(existsSync(arquivo)).toBe(true);
    for (const n of ["opencode-status-busy", "opencode-permissao", "opencode-idle"]) await servico.receber("sessao_oc", fx(`${n}.json`));
    expect(eventos.map(([, e]) => e)).toEqual([
      { tipo: "atividade", atividade: "trabalhando" }, { tipo: "atividade", atividade: "aguardando" }, { tipo: "atividade", atividade: "pronto" },
    ]);
    servico.encerrarSessao("sessao_oc");
    expect(existsSync(arquivo)).toBe(false);
    await servico.fechar();
  });

  it("conversa do Claude sai uma vez por mudança, e só se já gravada em disco", async () => {
    const { servico, eventos } = criar();
    await servico.iniciar();
    servico.observacaoPara("claude", "sessao_a");
    const dir = pasta();
    const conv = (id: string, gravar = true): string => { const a = join(dir, `${id}.jsonl`); if (gravar) writeFileSync(a, "{}\n"); return a; };
    const c1 = conv("c1");
    const c2 = conv("c2");
    await servico.receber("sessao_a", { hook_event_name: "Stop", transcript_path: conv("c0", false) });
    await servico.receber("sessao_a", { hook_event_name: "Stop", transcript_path: c1 });
    await servico.receber("sessao_a", { hook_event_name: "Stop", transcript_path: c1 });
    await servico.receber("sessao_a", { hook_event_name: "Stop", transcript_path: conv("inválido!") });
    await servico.receber("sessao_a", { hook_event_name: "Stop", transcript_path: c2 });
    expect(eventos.filter(([, e]) => e.tipo === "conversa").map(([, e]) => e)).toEqual([
      { tipo: "conversa", conversa_id: "c1" }, { tipo: "conversa", conversa_id: "c2" },
    ]);
    await servico.fechar();
  });

  it("os eventos parciais são compatíveis com EventoTerminal (envelope completado pelo gerenciador de sessões)", () => {
    const parcial: EventoAtividadeParcial = { tipo: "atividade", atividade: "pronto" };
    const completo: EventoTerminal = { versao: 1, sequencia: 1, sessao_id: "s", ...parcial };
    expect(completo.tipo).toBe("atividade");
  });
});

describe("ServicoAtividade: subagentes", () => {
  function transcript(id = "abc123") {
    const raiz = pasta();
    const dir = join(raiz, "sess-1", "subagents");
    mkdirSync(dir, { recursive: true });
    return { principal: join(raiz, "sess-1.jsonl"), arquivo: join(dir, `agent-${id}.jsonl`) };
  }
  const inicio = (t: ReturnType<typeof transcript>, id = "abc123") => ({ hook_event_name: "SubagentStart", session_id: "sess-1", transcript_path: t.principal, agent_id: id, agent_type: "Explore" });
  const fim = (t: ReturnType<typeof transcript>, id = "abc123") => ({ hook_event_name: "SubagentStop", session_id: "sess-1", agent_id: id, agent_type: "Explore", agent_transcript_path: t.arquivo });
  const jsonl = (...r: unknown[]) => r.map((x) => JSON.stringify(x)).join("\n") + "\n";

  it("início, linhas do transcript e fim viram eventos na ordem, ligados à sessão-pai", async () => {
    const { servico, eventos } = criar();
    const t = transcript();
    writeFileSync(t.arquivo, jsonl({ type: "user", message: { content: "tarefa" } }));
    await servico.iniciar();
    servico.argumentosPara("claude", "sessao_pai");
    await servico.receber("sessao_pai", inicio(t));
    await esperar(() => eventos.some(([, e]) => e.tipo === "subagente_saida"));
    appendFileSync(t.arquivo, jsonl({ type: "assistant", message: { content: [{ type: "text", text: "pronto" }] } }));
    await servico.receber("sessao_pai", fim(t));
    expect(eventos.map(([id, e]) => [id, e.tipo])).toEqual([
      ["sessao_pai", "subagente_iniciado"], ["sessao_pai", "subagente_saida"], ["sessao_pai", "subagente_saida"], ["sessao_pai", "subagente_concluido"],
    ]);
    expect(eventos[2]![1]).toMatchObject({ linhas: [{ papel: "texto", texto: "pronto" }] });
    await servico.fechar();
  });

  it("SubagentStart repetido é ignorado; fim de agente nunca anunciado não gera evento", async () => {
    const { servico, eventos } = criar();
    const t = transcript();
    await servico.iniciar();
    servico.argumentosPara("claude", "sessao_pai");
    await servico.receber("sessao_pai", fim(t, "interno"));
    await servico.receber("sessao_pai", inicio(t));
    await servico.receber("sessao_pai", inicio(t));
    expect(eventos.filter(([, e]) => e.tipo === "subagente_iniciado")).toHaveLength(1);
    expect(eventos.some(([, e]) => e.tipo === "subagente_concluido")).toBe(false);
    await servico.fechar();
  });

  it("sem transcript legível, o resumo final vira a linha exibida antes de concluir", async () => {
    const { servico, eventos } = criar();
    const t = transcript();
    await servico.iniciar();
    servico.argumentosPara("claude", "sessao_pai");
    await servico.receber("sessao_pai", inicio(t));
    await servico.receber("sessao_pai", { ...fim(t), last_assistant_message: "Achei 3 pastas" });
    expect(eventos.map(([, e]) => e.tipo)).toEqual(["subagente_iniciado", "subagente_saida", "subagente_concluido"]);
    expect(eventos[1]![1]).toMatchObject({ linhas: [{ papel: "texto", texto: "Achei 3 pastas" }] });
    await servico.fechar();
  });

  it("Codex: atividade que chega antes do início anuncia o subagente; início atrasado é ignorado; fim traz o resumo se não houve linha", async () => {
    const AG = "01a0ea72-ae1c-7971-8919-b25c89266184";
    const { servico, eventos } = criar({ adaptadores: [adaptadorCodex] });
    await servico.iniciar();
    servico.argumentosPara("codex", "sessao_cx", "automatico");
    const pre = fx("codex-subagente-PreToolUse.json");
    await servico.receber("sessao_cx", pre);
    await servico.receber("sessao_cx", { hook_event_name: "SubagentStart", agent_id: AG, agent_type: "default" });
    await servico.receber("sessao_cx", { hook_event_name: "PostToolUse", agent_id: AG, tool_response: "a\n" });
    await servico.receber("sessao_cx", { hook_event_name: "SubagentStop", agent_id: AG, last_assistant_message: "final" });
    expect(eventos.filter(([, e]) => e.tipo.startsWith("subagente")).map(([, e]) => e.tipo)).toEqual(["subagente_iniciado", "subagente_saida", "subagente_saida", "subagente_concluido"]);
    await servico.fechar();
  });
});

describe("ServicoAtividade: Codex por permissão do workspace (AUD-02, P-09)", () => {
  it("seguro: sem flag, sem hook, e a sessão cai na heurística estimada; automatico: flag e hooks, fora da heurística", async () => {
    let agora = 0;
    const estimados: Array<[string, string, boolean]> = [];
    const heuristica = new HeuristicaOciosidade({ ocioso_ms: 1_000, agora: () => agora, emitir: (id, a, est) => estimados.push([id, a, est]) });
    const { servico } = criar({ adaptadores: [adaptadorCodex], heuristica });
    await servico.iniciar();
    const seguro = servico.observacaoPara("codex", "cx_seguro", "seguro");
    expect(seguro).toEqual({ argumentos: [], ambiente: {} });
    expect(servico.observacaoPara("codex", "cx_padrao")).toEqual({ argumentos: [], ambiente: {} }); // omitir = seguro
    heuristica.registrarSaida("cx_seguro");
    agora = 1_500;
    heuristica.verificar();
    expect(estimados).toEqual([["cx_seguro", "trabalhando", true], ["cx_seguro", "pronto", true]]);
    const auto = servico.observacaoPara("codex", "cx_auto", "automatico");
    expect(auto.argumentos).toContain("--dangerously-bypass-hook-trust");
    heuristica.registrarSaida("cx_auto");
    expect(estimados).toHaveLength(2); // com hook exato, a heurística não age
    await servico.fechar();
  });
});

describe("HeuristicaOciosidade (sem hook, estimada)", () => {
  it("saída recente = trabalhando; silêncio prolongado = pronto; ambos marcados como estimados", () => {
    let agora = 1_000;
    const emitidos: Array<[string, string, boolean]> = [];
    const h = new HeuristicaOciosidade({ ocioso_ms: 3_000, agora: () => agora, emitir: (id, atividade, estimada) => emitidos.push([id, atividade, estimada]) });
    h.registrarSaida("s1");
    h.registrarSaida("s1");
    agora += 2_000;
    h.verificar();
    expect(emitidos).toEqual([["s1", "trabalhando", true]]);
    agora += 1_500;
    h.verificar();
    h.verificar();
    expect(emitidos).toEqual([["s1", "trabalhando", true], ["s1", "pronto", true]]);
    agora += 10;
    h.registrarSaida("s1");
    expect(emitidos.at(-1)).toEqual(["s1", "trabalhando", true]);
  });
  it("sessão com hook é ignorada (o hook é exato); remover limpa o estado", () => {
    let agora = 0;
    const emitidos: unknown[] = [];
    const h = new HeuristicaOciosidade({ ocioso_ms: 100, agora: () => agora, emitir: (...a) => emitidos.push(a) });
    h.usarHook("s2");
    h.registrarSaida("s2");
    agora += 500;
    h.verificar();
    expect(emitidos).toEqual([]);
    h.registrarSaida("s3");
    h.remover("s3");
    agora += 500;
    h.verificar();
    expect(emitidos).toEqual([["s3", "trabalhando", true]]);
  });
});
