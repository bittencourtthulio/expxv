import { describe, expect, it } from "vitest";
import { agruparPorProvedor, infoProvedor, ordenarBaldes, rotuloModelo } from "./provedores-visual";

describe("infoProvedor", () => {
  it("reconhece os provedores das CLIs e os aliases de marca", () => {
    for (const [id, nome, logo] of [["claude", "Claude", "claude"], ["anthropic", "Claude", "claude"], ["codex", "Codex", "openai"], ["openai", "Codex", "openai"], ["gemini", "Gemini", "gemini"], ["grok", "Grok", "xai"], ["xai", "Grok", "xai"], ["opencode", "OpenCode", "opencode"], ["qwen", "Qwen", "qwen"], ["kilo", "Kilo", "kilo"], ["aider", "Aider", "aider"], ["openrouter", "OpenRouter", "openrouter"]] as const) {
      const i = infoProvedor(id);
      expect(i).toMatchObject({ nome, logo, conhecido: true });
    }
    expect(infoProvedor("CLAUDE").id).toBe("claude");
  });
  it("desconhecido cai no fallback: nome do id, iniciais, sem logo, ordem no fim", () => {
    const i = infoProvedor("zeta-cli");
    expect(i).toMatchObject({ id: "zeta-cli", nome: "Zeta-cli", logo: null, conhecido: false, iniciais: "ZE" });
    expect(i.ordem).toBeGreaterThan(infoProvedor("openrouter").ordem);
    expect(infoProvedor("").nome).toBe("Provedor");
    expect(infoProvedor(null).logo).toBeNull();
  });
  it("agrupa na ordem fixa dos conhecidos, desconhecidos por nome ao fim, preservando a ordem interna", () => {
    const g = agruparPorProvedor([{ provider: "zeta", n: 1 }, { provider: "codex", n: 2 }, { provider: "claude", n: 3 }, { provider: "anthropic", n: 4 }, { provider: "alfa", n: 5 }]);
    expect(g.map((x) => x.provedor.id)).toEqual(["claude", "codex", "alfa", "zeta"]);
    expect(g[0]!.itens.map((i) => i.n)).toEqual([3, 4]);
  });
});

describe("rotuloModelo", () => {
  it("Claude: família e ids completos viram 'Opus 4.1'", () => {
    expect(rotuloModelo("opus")).toBe("Opus");
    expect(rotuloModelo("sonnet")).toBe("Sonnet");
    expect(rotuloModelo("claude-opus-4-1-20250805")).toBe("Opus 4.1");
    expect(rotuloModelo("claude-sonnet-4-5")).toBe("Sonnet 4.5");
    expect(rotuloModelo("claude-3-5-haiku-20241022")).toBe("Haiku 3.5");
    expect(rotuloModelo("claude-opus-4-20250514")).toBe("Opus 4");
  });
  it("OpenAI, Gemini, Grok, Qwen e OpenRouter (sem o fornecedor)", () => {
    expect(rotuloModelo("gpt-5")).toBe("GPT-5");
    expect(rotuloModelo("gpt-5-codex")).toBe("GPT-5 Codex");
    expect(rotuloModelo("gpt-5.1-codex-mini")).toBe("GPT-5.1 Codex Mini");
    expect(rotuloModelo("o3")).toBe("o3");
    expect(rotuloModelo("gemini-2.5-pro")).toBe("Gemini 2.5 Pro");
    expect(rotuloModelo("grok-4")).toBe("Grok 4");
    expect(rotuloModelo("grok-code-fast-1")).toBe("Grok Code Fast 1");
    expect(rotuloModelo("qwen3-coder")).toBe("Qwen3 Coder");
    expect(rotuloModelo("anthropic/claude-sonnet-4.5")).toBe("Sonnet 4.5");
    expect(rotuloModelo("openai/gpt-5:free")).toBe("GPT-5");
  });
  it("nunca inventa: não reconhecido mostra o id curto; vazio é 'modelo desconhecido'", () => {
    expect(rotuloModelo("meu-modelo-x")).toBe("meu-modelo-x");
    expect(rotuloModelo("x".repeat(60))).toHaveLength(28);
    expect(rotuloModelo("x".repeat(60)).endsWith("…")).toBe(true);
    expect(rotuloModelo("")).toBe("modelo desconhecido");
    expect(rotuloModelo(null)).toBe("modelo desconhecido");
  });
  it("ordena baldes por uso (maior primeiro), sem dado por último", () => {
    const o = ordenarBaldes([{ nome: "haiku", used_pct: null }, { nome: "sonnet", used_pct: 20 }, { nome: "opus", used_pct: 90 }]);
    expect(o.map((b) => b.nome)).toEqual(["opus", "sonnet", "haiku"]);
  });
});
