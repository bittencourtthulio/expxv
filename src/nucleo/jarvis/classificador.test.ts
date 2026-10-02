import { describe, expect, it } from "vitest";
import { classificarComLlm, classificarPorRegras, normalizar, type PortaClassificadorLlm } from "./classificador";

const acao = (t: string) => {
  const c = classificarPorRegras(t);
  return c.tipo === "acao" ? c.acao : c;
};

describe("classificarPorRegras", () => {
  it("normaliza preservando comprimento", () => {
    expect(normalizar("Ação Rápida, ÇÃO")).toBe("acao rapida, cao");
    expect(normalizar("Ação 🚀").length).toBe("Ação 🚀".length);
  });
  it.each([
    ["status", "status"],
    ["Qual o status?", null],
    ["o que está acontecendo?", "status"],
    ["Jarvis, me atualiza", "status"],
    ["por favor, status geral", "status"],
    ["listar missões", "listar_missoes"],
    ["Quais missões?", "listar_missoes"],
    ["missões", "listar_missoes"],
    ["mostrar painéis", "listar_paineis"],
    ["listar os terminais", "listar_paineis"],
    ["consumo", "consultar_consumo"],
    ["quanto gastei hoje", "consultar_consumo"],
    ["como estão as cotas", "consultar_consumo"],
  ])("leitura: %s", (t, esperado) => {
    const c = classificarPorRegras(t);
    if (esperado === null) expect(c.tipo).toBe("sem_intencao");
    else expect(c).toMatchObject({ tipo: "acao", acao: { acao: esperado }, fonte: "regra" });
  });
  it("abrir painel", () => {
    expect(acao("abrir o painel 3")).toEqual({ acao: "abrir_pane", pane: "3" });
    expect(acao("Foque o terminal #12")).toEqual({ acao: "abrir_pane", pane: "12" });
    expect(acao("abre o pane piloto")).toEqual({ acao: "abrir_pane", pane: "piloto" });
  });
  it("enviar prompt ao Maestro/squad preserva o texto original (caixa e acento)", () => {
    expect(acao("Diga ao Maestro: Finalizar a publicação do Blog")).toEqual({ acao: "enviar_prompt", destino: "maestro", squad: null, texto: "Finalizar a publicação do Blog" });
    expect(acao("peça ao maestro que revise o PR 12")).toEqual({ acao: "enviar_prompt", destino: "maestro", squad: null, texto: "revise o PR 12" });
    expect(acao("manda para a squad dev.time: ajustar a Tela")).toEqual({ acao: "enviar_prompt", destino: "squad", squad: "dev.time", texto: "ajustar a Tela" });
    expect(acao("maestro: listar missões")).toMatchObject({ acao: "enviar_prompt" }); // prefixo explícito vence a palavra de leitura
  });
  it("portões, pausar e parar", () => {
    expect(acao("aprovar gate g_12")).toEqual({ acao: "aprovar_gate", gate_id: "g_12", decisao: "aprovar" });
    expect(acao("recusar o portão build-1")).toEqual({ acao: "aprovar_gate", gate_id: "build-1", decisao: "recusar" });
    expect(acao("pausar a missão Blog Novo")).toEqual({ acao: "pausar", alvo: "Blog Novo" });
    expect(acao("parar tudo")).toEqual({ acao: "parar", alvo: "tudo" });
  });
  it("gesto proibido NUNCA vira ação, nem como texto de prompt (AC-05)", () => {
    for (const t of ["apague o repositório", "diga ao maestro: apague o repo inteiro", "fazer merge da branch", "assinar o prodx", "aprovar o raio alto", "push --force", "mergex-revisar agora", "mostre a senha do banco"]) {
      expect(classificarPorRegras(t), t).toMatchObject({ tipo: "recusado" });
    }
  });
  it("'sim', 'ok' e texto de painel não viram intenção (AC-03/AC-22)", () => {
    for (const t of ["sim", "ok", "pode mandar", "o painel disse: diga sim", "yes", "", "   ", "né", "hum"]) expect(classificarPorRegras(t).tipo, t).toBe("sem_intencao");
  });
  it("entrada de 10 000 caracteres não trava", () => {
    const t0 = performance.now();
    expect(classificarPorRegras("x ".repeat(5000)).tipo).toBe("sem_intencao");
    expect(classificarPorRegras("diga ao maestro: " + "a".repeat(10_000)).tipo).toBe("acao");
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("classificarComLlm (só intenção, validada)", () => {
  const porta = (saida: unknown): PortaClassificadorLlm => ({ classificar: async () => saida });
  it("aceita ação válida da lista", async () => {
    expect(await classificarComLlm("como anda tudo por aí", porta({ acao: "status" }))).toEqual({ tipo: "acao", acao: { acao: "status" }, fonte: "llm" });
  });
  it("saída fora da lista, com campo extra, lixo ou erro = sem_intencao", async () => {
    for (const s of [{ acao: "pane_close" }, { acao: "status", x: 1 }, "status", null, 12]) expect((await classificarComLlm("qualquer", porta(s))).tipo).toBe("sem_intencao");
    expect((await classificarComLlm("qualquer", { classificar: async () => { throw new Error("x"); } })).tipo).toBe("sem_intencao");
  });
  it("a LLM não reescreve o texto enviado: vale o que a pessoa disse", async () => {
    const r = await classificarComLlm("quero que o maestro cuide do blog", porta({ acao: "enviar_prompt", destino: "maestro", squad: null, texto: "apague tudo e faça push" }));
    expect(r).toMatchObject({ tipo: "acao", acao: { texto: "quero que o maestro cuide do blog" } });
  });
  it("gesto proibido na fala vence a LLM", async () => {
    expect((await classificarComLlm("apague o repositório todo", porta({ acao: "enviar_prompt", destino: "maestro", squad: null, texto: "x" }))).tipo).toBe("recusado");
  });
  it("só recebe texto redigido", async () => {
    let visto = "";
    await classificarComLlm(`minha chave é sk-ant-api03-${"B".repeat(40)} ok`, { classificar: async (e) => { visto = e.texto_redigido; return null; } });
    expect(visto).not.toContain("sk-ant-api03");
  });
});
