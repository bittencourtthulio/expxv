import { describe, expect, it } from "vitest";
import { criarLeitorTokensGrok, pastaSessoesGrok, tokensDaSessao, type PortasGrok } from "./tokens-grok";

// fixtures SINTÉTICAS (formato observado em usage.json; valores inventados; nenhum conteúdo de conversa)
const usage = (entrada: number, saida: number): string => JSON.stringify({ sessionId: "x", updatedAt: "2026-10-01T00:00:00Z", session: { inputTokens: entrada, outputTokens: saida, cachedReadTokens: 9_999, totalTokens: entrada + saida + 9_999, modelUsage: {} }, turns: [] });
const ID1 = "01a0f4fa-504c-7070-bb0c-ef784ffb4ac0";
const ID2 = "01a0f4fd-b17f-7330-8fa4-be888fd35148";

function discoFalso() {
  const arqs = new Map<string, { mtime: number; texto: string }>();
  const lidos: string[] = [];
  const portas: PortasGrok = {
    listar: async (dir) => [...new Set([...arqs.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1).split("/")[0]!)), "prompt_history.jsonl", "session_search.sqlite"],
    mtime: async (c) => arqs.get(c)?.mtime ?? null,
    ler: async (c) => { lidos.push(c); return arqs.get(c)?.texto ?? null; },
  };
  const pasta = pastaSessoesGrok("/h", "/p/meu app");
  const gravar = (id: string, mtime: number, texto: string): void => void arqs.set(`${pasta}/${id}/usage.json`, { mtime, texto });
  return { portas, gravar, lidos };
}

describe("leitor de tokens do Grok (só contagens)", () => {
  it("o cwd é codificado como componente de URL, como a CLI grava", () => {
    expect(pastaSessoesGrok("/h", "/Users/x/meu projeto")).toBe("/h/sessions/%2FUsers%2Fx%2Fmeu%20projeto");
  });
  it("tokens = entrada + saída da sessão (sem o cache); formato estranho = null", () => {
    expect(tokensDaSessao(usage(31_179, 47))).toBe(31_226);
    for (const ruim of ["", "[]", "{}", '{"session":{}}', '{"session":{"inputTokens":"1","outputTokens":2}}', '{"session":{"inputTokens":-1,"outputTokens":2}}', "x".repeat(70_000)]) expect(tokensDaSessao(ruim)).toBeNull();
  });
  it("a primeira pergunta é só linha de base; depois só o crescimento conta; sessão nova conta inteira", async () => {
    const d = discoFalso();
    d.gravar(ID1, 1, usage(1_000, 100));
    const l = criarLeitorTokensGrok({ home: "/h", portas: d.portas });
    expect(await l.delta("/p/meu app")).toBe(0);
    expect(await l.delta("/p/meu app")).toBe(0);
    d.gravar(ID1, 2, usage(4_000, 300));
    expect(await l.delta("/p/meu app")).toBe(3_200);
    d.gravar(ID2, 3, usage(500, 50));
    expect(await l.delta("/p/meu app")).toBe(550);
    expect(await l.delta("/p/meu app")).toBe(0);
  });
  it("não relê arquivo com mtime igual e nunca abre nada além de usage.json", async () => {
    const d = discoFalso();
    d.gravar(ID1, 1, usage(10, 1));
    const l = criarLeitorTokensGrok({ home: "/h", portas: d.portas });
    await l.delta("/p/meu app");
    await l.delta("/p/meu app");
    expect(d.lidos).toHaveLength(1);
    expect(d.lidos.every((c) => c.endsWith("/usage.json"))).toBe(true);
  });
  it("contador que diminui (sessão reescrita) nunca gera delta negativo; arquivo inválido é ignorado", async () => {
    const d = discoFalso();
    d.gravar(ID1, 1, usage(5_000, 500));
    const l = criarLeitorTokensGrok({ home: "/h", portas: d.portas });
    await l.delta("/p/meu app");
    d.gravar(ID1, 2, usage(100, 10));
    expect(await l.delta("/p/meu app")).toBe(0);
    d.gravar(ID1, 3, "{lixo");
    expect(await l.delta("/p/meu app")).toBe(0);
  });
  it("observa só as sessões mais recentes", async () => {
    const d = discoFalso();
    for (let i = 0; i < 20; i++) d.gravar(`01a0f4fa-0000-7000-8000-${String(i).padStart(12, "0")}`, 1, usage(1, 1));
    const l = criarLeitorTokensGrok({ home: "/h", portas: d.portas, maxSessoes: 3 });
    await l.delta("/p/meu app");
    expect(d.lidos).toHaveLength(3);
  });
  it("pasta inexistente = 0, sem lançar", async () => {
    const l = criarLeitorTokensGrok({ home: "/h", portas: discoFalso().portas });
    expect(await l.delta("/nao/existe")).toBe(0);
  });
});
