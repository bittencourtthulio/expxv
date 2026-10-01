import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptadorCodex } from "./codex";

const fx = (nome: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/atividade", nome), "utf8")) as Record<string, unknown>;
const AG = "01a0ea72-ae1c-7971-8919-b25c89266184";

describe("adaptador do Codex: payloads reais de hook", () => {
  it("atividade: prompt/ferramenta = trabalhando; PermissionRequest = aguardando; Stop da conversa principal = pronto, de subagente não", () => {
    const a = (n: string) => adaptadorCodex.interpretarAtividade!(fx(n));
    expect(a("codex-UserPromptSubmit.json")).toBe("trabalhando");
    expect(a("codex-PreToolUse.json")).toBe("trabalhando");
    expect(a("codex-PermissionRequest.json")).toBe("aguardando");
    expect(a("codex-Stop.json")).toBe("pronto");
    expect(a("codex-subagente-Stop.json")).toBeNull();
    expect(adaptadorCodex.interpretarAtividade!({ hook_event_name: "SubagentStart", agent_id: "abc" })).toBeNull();
    expect(adaptadorCodex.interpretarAtividade!(null)).toBeNull();
  });
  it("conversa: session_id válido; inválido, longo ou de subagente é ignorado", () => {
    expect(adaptadorCodex.conversaDoHook!(fx("codex-UserPromptSubmit.json"))).toBe("019a3c5e-7d21-7f00-9c4b-0a1b2c3d4e5f");
    expect(adaptadorCodex.conversaDoHook!(fx("codex-subagente-Stop.json"))).toBeNull();
    expect(adaptadorCodex.conversaDoHook!({ session_id: "a b; rm" })).toBeNull();
    expect(adaptadorCodex.conversaDoHook!({ session_id: "x".repeat(129) })).toBeNull();
    expect(adaptadorCodex.conversaDoHook!({})).toBeNull();
  });
  it("subagente: início, atividade e fim; a conversa principal (sem agent_id) não é subagente", () => {
    expect(adaptadorCodex.interpretar({ hook_event_name: "SubagentStart", agent_id: AG, agent_type: "default" })).toEqual({ tipo: "iniciado", subagente_id: AG, rotulo: "subagente 6184", descricao: null, arquivo: null });
    expect(adaptadorCodex.interpretar({ hook_event_name: "SubagentStart", agent_id: AG, agent_type: "explorer" })).toMatchObject({ rotulo: "explorer" });
    expect(adaptadorCodex.interpretar(fx("codex-subagente-PreToolUse.json"))).toEqual({ tipo: "atividade", subagente_id: AG, rotulo: "subagente 6184", linhas: [{ papel: "ferramenta", texto: "Bash: cat /tmp/a.txt" }] });
    expect(adaptadorCodex.interpretar({ hook_event_name: "PostToolUse", agent_id: AG, tool_response: "a\n" })).toMatchObject({ tipo: "atividade", linhas: [{ papel: "resultado", texto: "a" }] });
    expect(adaptadorCodex.interpretar({ hook_event_name: "PostToolUse", agent_id: AG, tool_response: "" })).toMatchObject({ linhas: [] });
    expect(adaptadorCodex.interpretar({ hook_event_name: "SubagentStop", agent_id: AG, last_assistant_message: "feito" })).toEqual({ tipo: "concluido", subagente_id: AG, arquivo: null, resumo: "feito" });
    expect(adaptadorCodex.interpretar(fx("codex-PreToolUse.json"))).toBeNull();
    expect(adaptadorCodex.interpretar(fx("codex-Stop.json"))).toBeNull();
    expect(adaptadorCodex.interpretar({ hook_event_name: "PreToolUse", agent_id: "../x" })).toBeNull();
  });
  it("configuração: 7 hooks assíncronos por -c apontando para a URL da sessão, sem gravar arquivo nem tocar o config do usuário", () => {
    const args = adaptadorCodex.argumentosDeObservacao({ permissao: "automatico", url: "http://127.0.0.1:9/atividade/sessao_a/tok", sessao_id: "sessao_a", gravarArquivo: () => { throw new Error("não grava arquivo"); } });
    expect(args[0]).toBe("--dangerously-bypass-hook-trust");
    const pares = args.slice(1);
    expect(pares.filter((_, i) => i % 2 === 0)).toEqual(Array(7).fill("-c"));
    const configs = pares.filter((_, i) => i % 2 === 1);
    expect(configs.map((c) => c.split("=")[0])).toEqual(["hooks.SubagentStart", "hooks.SubagentStop", "hooks.PreToolUse", "hooks.PostToolUse", "hooks.UserPromptSubmit", "hooks.PermissionRequest", "hooks.Stop"]);
    for (const c of configs) {
      expect(c).toContain("async=true");
      expect(c).toContain('"http://127.0.0.1:9/atividade/sessao_a/tok"');
      expect(c).toContain("--data-binary @-");
    }
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });
  it("AUD-02: em workspace seguro o Codex NUNCA recebe o flag nem hooks por -c", () => {
    const alvo = { url: "http://127.0.0.1:9/atividade/s/t", sessao_id: "s", gravarArquivo: () => "" };
    expect(adaptadorCodex.argumentosDeObservacao({ ...alvo, permissao: "seguro" })).toEqual([]);
    expect(adaptadorCodex.argumentosDeObservacao({ ...alvo, permissao: "automatico" })).toContain("--dangerously-bypass-hook-trust");
  });
});
