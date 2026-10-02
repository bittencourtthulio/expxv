// T-16.28 · Decisão do `UserPromptSubmit` do Maestro sobre o ServicoMaestro REAL (mundo falso): bloqueio, ignorados, modo notificar, falha aberta.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarMundo, WS } from "../../../../tests/fixtures/maestro/mundo";
import { criarGanchoMaestroPrompt, promptDoPayload, skillDoSlash, type ContextoDoGancho, type PortaDoGanchoMaestro } from "./prompt";

const FIXTURE = JSON.parse(readFileSync(join(__dirname, "../../../../tests/fixtures/maestro/claude-UserPromptSubmit.json"), "utf8")) as Record<string, unknown>;
const ctx = (extra: Partial<ContextoDoGancho> = {}): ContextoDoGancho => ({ workspace_id: WS, mission_id: null, pane_id: "paneLivre", ...extra });
const payload = (prompt: string): Record<string, unknown> => ({ ...FIXTURE, prompt });
function montar(o: Parameters<typeof criarMundo>[0] = {}) {
  const m = criarMundo(o);
  const eventos: Array<{ tipo: string; detalhe?: string | undefined }> = [];
  const porta: PortaDoGanchoMaestro = {
    classificar: (t, c) => m.servico.classificar(t, c),
    pedir: (p) => m.servico.pedir(p),
    ehPaneDoMaestro: (id) => m.servico.ehPaneDoMaestro(id),
    config: () => m.config,
    evento: (e) => void eventos.push(e),
  };
  return { m, eventos, gancho: criarGanchoMaestroPrompt(porta) };
}

describe("hook UserPromptSubmit do Maestro", () => {
  it("fixture de payload do Claude: bug de alta confiança => {decision:block, reason} e plano PROPOSTO via hook", async () => {
    const { m, gancho, eventos } = montar();
    const r = await gancho(ctx(), FIXTURE);
    expect(r.saida).toMatchObject({ decision: "block" });
    expect(String(r.saida?.["reason"])).toMatch(/^Maestro: encaminhado como bug \(confiança (?:0,\d\d|1,00)\) → runx\./);
    expect(String(r.saida?.["reason"])).toContain("@direto");
    expect(m.persistencia.todos()).toHaveLength(1);
    expect(m.persistencia.todos()[0]).toMatchObject({ via: "hook", estado: "proposto", origem_pane_id: "paneLivre" });
    expect(m.vivos()).toHaveLength(0);
    expect(eventos).toContainEqual(expect.objectContaining({ tipo: "maestro.hook_intercepted", detalhe: "encaminhado" }));
  });
  it.each([
    ["slash command", "/expx:runx-causa corrige o erro 500 no cadastro"],
    ["@direto", "corrige o erro 500 no cadastro, estou com um problema @direto"],
    ["marcador do Maestro", "[maestro] corrige o erro 500 no cadastro de clientes"],
    ["pergunta (dúvida)", "como funciona o login do sistema?"],
    ["histórico", "o que já fizemos sobre exportação?"],
    ["controle", "como está o pipeline do maestro?"],
    ["texto neutro", "ok, obrigado"],
    ["baixa confiança", "talvez ajeitar umas coisas"],
  ])("ignora %s: saída vazia e nenhum plano", async (_n, texto) => {
    const { m, gancho } = montar();
    expect((await gancho(ctx(), payload(texto))).saida).toBeNull();
    expect(m.persistencia.todos()).toHaveLength(0);
  });
  it("eco do ADE (o que o ADE mesmo digitou, TTL 30 s) é ignorado", async () => {
    const { m, gancho } = montar();
    m.servico.registrarEco("paneLivre", String(FIXTURE["prompt"]));
    expect((await gancho(ctx(), FIXTURE)).saida).toBeNull();
    expect(m.persistencia.todos()).toHaveLength(0);
  });
  it("NUNCA em Pane de etapa do Maestro nem em Missão do Maestro", async () => {
    const { m, gancho } = montar();
    m.servico.registrarPaneDoMaestro("paneEtapa");
    expect((await gancho(ctx({ pane_id: "paneEtapa" }), FIXTURE)).saida).toBeNull();
    const naMissao = criarGanchoMaestroPrompt({ classificar: (t, c) => m.servico.classificar(t, c), pedir: (p) => m.servico.pedir(p), ehPaneDoMaestro: () => false, missaoDoMaestro: (id) => id === "mis_maestro", config: () => m.config });
    expect((await naMissao(ctx({ mission_id: "mis_maestro" }), FIXTURE)).saida).toBeNull();
    expect(m.persistencia.todos()).toHaveLength(0);
    // painel livre numa Missão de modo livre (que não é do Maestro) continua elegível
    expect((await naMissao(ctx({ mission_id: "mis_livre" }), FIXTURE)).saida).toMatchObject({ decision: "block" });
    expect(m.persistencia.todos()[0]).toMatchObject({ mission_id: "mis_livre" });
  });
  it("modo `desligado`: nada; modo `notificar`: grava o plano (banner) mas NÃO bloqueia", async () => {
    const off = montar({ config: { hook_modo: "desligado" } });
    expect((await off.gancho(ctx(), FIXTURE)).saida).toBeNull();
    expect(off.m.persistencia.todos()).toHaveLength(0);
    const nt = montar({ config: { hook_modo: "notificar" } });
    expect((await nt.gancho(ctx(), FIXTURE)).saida).toBeNull();
    expect(nt.m.persistencia.todos()).toHaveLength(1);
    expect(nt.eventos).toContainEqual(expect.objectContaining({ detalhe: "notificado" }));
  });
  it("confiança abaixo de hook_confianca_min (ou só média) não encaminha", async () => {
    const m = criarMundo({ config: { hook_confianca_min: 0.9 } });
    const com = (conf: number) => criarGanchoMaestroPrompt({ classificar: async (t, c) => ({ ...(await m.servico.classificar(t, c)), confianca: conf }), pedir: (p) => m.servico.pedir(p), ehPaneDoMaestro: () => false, config: () => m.config });
    expect((await com(0.8)(ctx(), FIXTURE)).saida).toBeNull();
    expect((await com(0.6)(ctx(), FIXTURE)).saida).toBeNull();
    expect(m.persistencia.todos()).toHaveLength(0);
    expect((await com(0.95)(ctx(), FIXTURE)).saida).toMatchObject({ decision: "block" });
  });
  it("o decisor externo NÃO é consultado no hook (usar_no_hook=false é imposto pelo serviço: via hook)", async () => {
    let consultas = 0;
    const decisor = { habilitadoEfetivo: () => false, consultar: async (_t: string, via: string) => { consultas += via === "hook" ? 0 : 0; return { ok: false as const, motivo: "uso_no_hook_desligado" as const, tentado: false }; } };
    const { gancho } = montar({ decisor });
    expect((await gancho(ctx(), FIXTURE)).saida).toMatchObject({ decision: "block" });
    expect(consultas).toBe(0);
  });
  it("falha aberta: qualquer erro (config, serviço) => prompt segue (saída vazia)", async () => {
    const { m } = montar();
    const quebrada = criarGanchoMaestroPrompt({ classificar: m.servico.classificar.bind(m.servico), pedir: async () => { throw new Error("boom"); }, ehPaneDoMaestro: () => false, config: () => { throw new Error("cfg"); } });
    expect((await quebrada(ctx(), FIXTURE)).saida).toBeNull();
    const pedirQuebra = criarGanchoMaestroPrompt({ classificar: m.servico.classificar.bind(m.servico), pedir: async () => { throw new Error("boom"); }, ehPaneDoMaestro: () => false, config: () => m.config });
    expect((await pedirQuebra(ctx(), FIXTURE)).saida).toBeNull();
  });
  it("payload sem prompt textual, vazio ou enorme: sem ação", async () => {
    const { gancho } = montar();
    for (const corpo of [null, [], {}, { prompt: 3 }, { prompt: "   " }, { prompt: "x".repeat(4001) }, "texto"]) expect((await gancho(ctx(), corpo)).saida).toBeNull();
    expect(promptDoPayload(FIXTURE)).toBe(FIXTURE["prompt"]);
  });
  it("o mesmo prompt reenviado (idempotência) devolve o mesmo plano: 1 só pipeline", async () => {
    const { m, gancho } = montar();
    await gancho(ctx(), FIXTURE);
    await gancho(ctx(), FIXTURE);
    expect(m.persistencia.todos()).toHaveLength(1);
  });
});

describe("D-662: `/expx:<skill>` digitado num painel livre vira um sinal para o painel de progresso", () => {
  function comSinal(ehMaestro = false) {
    const sinais: Array<{ workspace_id: string; pane_id: string; skill: string }> = [];
    const gancho = criarGanchoMaestroPrompt({
      classificar: async () => { throw new Error("slash command não classifica"); },
      pedir: async () => { throw new Error("slash command não pede plano"); },
      ehPaneDoMaestro: () => ehMaestro,
      config: () => ({ hook_modo: "encaminhar", hook_confianca_min: 0.5 }) as never,
      skillDetectada: (e) => void sinais.push(e),
    });
    return { sinais, gancho };
  }
  it.each([["/expx:runx corrige o cadastro", "runx"], ["/expx:sprintx-executar", "sprintx-executar"], ["  /expx:PRODX  pedido", "prodx"]])("%s", async (texto, skill) => {
    const { sinais, gancho } = comSinal();
    const r = await gancho(ctx(), payload(texto));
    expect(r.saida).toBeNull(); // o prompt SEGUE: o painel só observa
    expect(sinais).toEqual([{ workspace_id: WS, pane_id: "paneLivre", skill }]);
  });
  it.each([["/clear"], ["/help"], ["/expx:"], ["/expx:../../x"], ["/outro:runx"], ["texto /expx:runx no meio"]])("não sinaliza %s", async (texto) => {
    const { sinais, gancho } = comSinal();
    await gancho(ctx(), payload(texto));
    expect(sinais).toEqual([]);
  });
  it("Pane de etapa do Maestro nunca sinaliza (a pipeline já é o progresso)", async () => {
    const { sinais, gancho } = comSinal(true);
    await gancho(ctx(), payload("/expx:runx x"));
    expect(sinais).toEqual([]);
  });
  it("erro no painel nunca derruba o prompt (falha aberta)", async () => {
    const gancho = criarGanchoMaestroPrompt({
      classificar: async () => { throw new Error("x"); }, pedir: async () => { throw new Error("x"); }, ehPaneDoMaestro: () => false, config: () => ({ hook_modo: "encaminhar", hook_confianca_min: 0.5 }) as never,
      skillDetectada: () => { throw new Error("painel quebrou"); },
    });
    expect((await gancho(ctx(), payload("/expx:runx x"))).saida).toBeNull();
  });
  it("skillDoSlash só reconhece o prefixo expx", () => {
    expect(skillDoSlash("/expx:runx-causa algo")).toBe("runx-causa");
    expect(skillDoSlash("/runx")).toBeNull();
  });
});
