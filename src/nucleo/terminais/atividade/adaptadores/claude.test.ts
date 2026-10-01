import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptadorClaude } from "./claude";

const fx = (nome: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/atividade", nome), "utf8")) as Record<string, unknown>;

describe("adaptador do Claude Code: payloads reais de hook", () => {
  it("atividade: prompt e ferramenta = trabalhando; permissão = aguardando; idle e Stop = pronto", () => {
    const a = (n: string) => adaptadorClaude.interpretarAtividade!(fx(n));
    expect(a("claude-UserPromptSubmit.json")).toBe("trabalhando");
    expect(a("claude-PostToolUse.json")).toBe("trabalhando");
    expect(a("claude-Notification-permissao.json")).toBe("aguardando");
    expect(a("claude-Notification-ocioso.json")).toBe("pronto");
    expect(a("claude-Stop.json")).toBe("pronto");
    expect(a("claude-SubagentStop.json")).toBeNull();
    expect(a("claude-SubagentStart.json")).toBeNull();
    expect(adaptadorClaude.interpretarAtividade!({ hook_event_name: "Notification", notification_type: "auth_success" })).toBeNull();
    expect(adaptadorClaude.interpretarAtividade!({ hook_event_name: "Notification", notification_type: "elicitation_dialog" })).toBe("aguardando");
    expect(adaptadorClaude.interpretarAtividade!("x")).toBeNull();
  });

  it("subagente: SubagentStart/Stop reais viram sinais; caminho fora de subagents/ é descartado; id hostil recusado", () => {
    const ini = adaptadorClaude.interpretar(fx("claude-SubagentStart.json"));
    expect(ini).toMatchObject({ tipo: "iniciado", subagente_id: "a1b2c3d4e5f6", rotulo: "Explore" });
    expect((ini as { arquivo: string }).arquivo.endsWith("/8f3c2a1e-5b7d-4c9a-a1f0-2d6e9b4c7a10/subagents/agent-a1b2c3d4e5f6.jsonl")).toBe(true);
    expect(adaptadorClaude.interpretar(fx("claude-SubagentStop.json"))).toMatchObject({ tipo: "concluido", subagente_id: "a1b2c3d4e5f6", resumo: "Achei 3 pastas", arquivo: expect.stringContaining("/subagents/agent-a1b2c3d4e5f6.jsonl") });
    expect(adaptadorClaude.interpretar({ ...fx("claude-SubagentStop.json"), agent_transcript_path: "/etc/passwd" })).toMatchObject({ arquivo: null });
    expect(adaptadorClaude.interpretar(fx("claude-Stop.json"))).toBeNull();
    expect(adaptadorClaude.interpretar({ hook_event_name: "SubagentStart", agent_id: "../x" })).toBeNull();
    expect(adaptadorClaude.interpretar("lixo")).toBeNull();
  });

  it("descrição do subagente vem do .meta.json ao lado do transcript", () => {
    const raiz = mkdtempSync(join(tmpdir(), "claude-meta-"));
    const dir = join(raiz, "sess-1", "subagents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "agent-abc.meta.json"), JSON.stringify({ description: "Mapear o repositório" }));
    const r = adaptadorClaude.interpretar({ hook_event_name: "SubagentStart", session_id: "sess-1", transcript_path: join(raiz, "sess-1.jsonl"), agent_id: "abc", agent_type: "Explore" });
    expect(r).toMatchObject({ descricao: "Mapear o repositório" });
  });

  it("conversa: só vale a conversa já gravada em disco (senão --resume falha); subagente e id inválido ignorados", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-conv-"));
    const grava = (id: string, gravar = true): string => { const a = join(dir, `${id}.jsonl`); if (gravar) writeFileSync(a, "{}\n"); return a; };
    expect(adaptadorClaude.conversaDoHook!({ ...fx("claude-Stop.json"), transcript_path: grava("abc-123_X") })).toBe("abc-123_X");
    expect(adaptadorClaude.conversaDoHook!(fx("claude-Stop.json"))).toBeNull(); // arquivo do fixture não existe nesta máquina
    expect(adaptadorClaude.conversaDoHook!({ transcript_path: grava("abc", false) })).toBeNull();
    expect(adaptadorClaude.conversaDoHook!({ transcript_path: grava("a b; rm") })).toBeNull();
    expect(adaptadorClaude.conversaDoHook!({ agent_id: "sub1", transcript_path: grava("abc") })).toBeNull();
    expect(adaptadorClaude.conversaDoHook!({})).toBeNull();
  });

  it("linhas do transcript viram prompt, texto, ferramenta e resultado; thinking é ignorado", () => {
    const l = (r: unknown) => adaptadorClaude.analisarLinha(JSON.stringify(r));
    expect(l({ type: "user", message: { role: "user", content: "Faça X" } })).toEqual([{ papel: "prompt", texto: "Faça X" }]);
    expect(l({ type: "assistant", message: { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Olá" }, { type: "tool_use", name: "Bash", input: { command: "ls -la", description: "" } }] } }))
      .toEqual([{ papel: "texto", texto: "Olá" }, { papel: "ferramenta", texto: "Bash: ls -la" }]);
    expect(l({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: "a\nb" }] } })).toEqual([{ papel: "resultado", texto: "a\nb" }]);
    expect(adaptadorClaude.analisarLinha("{quebrado")).toEqual([]);
  });

  it("configuração: --settings aponta para ARQUIVO do app com hooks HTTP para a URL da sessão; nada vai para o settings do usuário", () => {
    let nome = "";
    let gravado = "";
    const args = adaptadorClaude.argumentosDeObservacao({ url: "http://127.0.0.1:1/atividade/sessao_a/tok", sessao_id: "sessao_a", permissao: "seguro", gravarArquivo: (n, c) => { nome = n; gravado = c; return "/tmp/app/x.json"; } });
    expect(args).toEqual(["--settings", "/tmp/app/x.json"]);
    expect(nome).not.toMatch(/\.claude|settings\.json$/);
    const cfg = JSON.parse(gravado) as { hooks: Record<string, Array<{ hooks: Array<{ type: string; url: string }> }>> };
    expect(Object.keys(cfg.hooks).sort()).toEqual(["Notification", "PostToolUse", "Stop", "SubagentStart", "SubagentStop", "UserPromptSubmit"]);
    expect(cfg.hooks["SubagentStart"]![0]!.hooks[0]).toMatchObject({ type: "http", url: "http://127.0.0.1:1/atividade/sessao_a/tok" });
    expect(adaptadorClaude.ambienteDeObservacao).toBeUndefined();
  });
});
