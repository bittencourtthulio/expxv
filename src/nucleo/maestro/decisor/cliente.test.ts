import { describe, expect, it, vi } from "vitest";
import { CONFIG_DECISOR_PADRAO, criarDecisorDeIntencao, validarResposta, type ConfigDecisorMaestro, type PedidoAsk, type PortaAsk, type RespostaAsk } from "./cliente";
import { OPCOES_DO_DECISOR } from "./prompt";

const LIGADO: ConfigDecisorMaestro = { ...CONFIG_DECISOR_PADRAO, habilitado: true, consentimento_em: "2026-10-01T00:00:00.000Z", fonte: "openrouter", modelo: "anthropic/claude-sonnet-4", endpoint_host: "openrouter.ai" };
const resposta = (choice = "bug", conf = 0.9): RespostaAsk => ({ probs: { [choice]: 1 }, choice, confidence: conf, latency_ms: 120, cost_usd: null });
const ids = OPCOES_DO_DECISOR.map((o) => o.id);

function montar(cfg: ConfigDecisorMaestro, ask: PortaAsk["ask"]) {
  const criar = vi.fn((): PortaAsk => ({ ask }));
  return { criar, d: criarDecisorDeIntencao({ config: () => cfg, criarAsk: criar }) };
}

describe("decisor de intenção: desligado por padrão e sem instanciar o cliente", () => {
  it("instalação nova: zero chamadas, zero instâncias do cliente", async () => {
    const ask = vi.fn();
    const { criar, d } = montar(CONFIG_DECISOR_PADRAO, ask);
    const r = await d.consultar("corrige o bug", "api");
    expect(r).toEqual({ ok: false, motivo: "desabilitado", tentado: false });
    expect(criar).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(d.habilitadoEfetivo()).toBe(false);
  });
  it("habilitado sem consentimento ⇒ bloqueado, sem instância", async () => {
    const ask = vi.fn();
    const { criar, d } = montar({ ...LIGADO, consentimento_em: null }, ask);
    expect(await d.consultar("x", "api")).toMatchObject({ ok: false, motivo: "sem_consentimento", tentado: false });
    expect(criar).not.toHaveBeenCalled();
  });
  it("sem fonte configurada ⇒ bloqueado", async () => {
    const { criar, d } = montar({ ...LIGADO, fonte: null }, vi.fn());
    expect(await d.consultar("x", "api")).toMatchObject({ ok: false, motivo: "sem_fonte" });
    expect(criar).not.toHaveBeenCalled();
  });
  it("no hook o decisor não é usado (usar_no_hook=false) e todo prompt fica na máquina", async () => {
    const ask = vi.fn();
    const { criar, d } = montar(LIGADO, ask);
    expect(await d.consultar("x", "hook")).toMatchObject({ ok: false, motivo: "uso_no_hook_desligado", tentado: false });
    expect(criar).not.toHaveBeenCalled();
    const ligado = montar({ ...LIGADO, usar_no_hook: true }, async () => resposta());
    expect((await ligado.d.consultar("corrige", "hook")).ok).toBe(true);
  });
});

describe("decisor de intenção: ligado", () => {
  it("só o RESUMO redigido sai; opções fechadas = as 12 intenções (sem desconhecida)", async () => {
    let visto: PedidoAsk | null = null;
    const { d } = montar(LIGADO, async (p) => {
      visto = p;
      return resposta("bug");
    });
    const segredo = "sk-or-v1-ABCDEFGHIJKLMNOPQRSTUV123456";
    const r = await d.consultar(`corrige o login, a chave é ${segredo} e o arquivo /Users/x/segredo/app.ts\n\`\`\`\nTOKEN=abc123\n\`\`\``, "api");
    expect(r.ok).toBe(true);
    const p = visto as unknown as PedidoAsk;
    expect(p.question).not.toContain("sk-or");
    expect(p.question).not.toContain("/Users/x");
    expect(p.question).not.toContain("TOKEN=abc123");
    expect(p.question.length).toBeLessThanOrEqual(500);
    expect(p.options.map((o) => o.id).sort()).toEqual([...ids].sort());
    expect(ids).not.toContain("desconhecida");
    expect(p.kind).toBe("choice");
    expect(p.purpose).toBe("intent");
    if (r.ok) {
      expect(r.decisao.resumo_enviado).toBe(p.question);
      expect(r.decisao.resumo_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.decisao).toMatchObject({ intencao: "bug", tipo: "openrouter", modelo: "anthropic/claude-sonnet-4", endpoint_host: "openrouter.ai", custo_usd: null });
    }
  });
  it("jev direto ⇒ tipo jev", async () => {
    const { d } = montar({ ...LIGADO, fonte: "jev_direto" }, async () => resposta());
    const r = await d.consultar("x y z", "api");
    expect(r.ok && r.decisao.tipo).toBe("jev");
  });
  it("cria o cliente uma única vez (lazy) e reaproveita", async () => {
    const { criar, d } = montar(LIGADO, async () => resposta());
    await d.consultar("a b", "api");
    await d.consultar("c d", "api");
    expect(criar).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["erro 402", () => Promise.reject(new Error("402 payment required")), "erro"],
    ["429", () => Promise.reject(new Error("429")), "erro"],
    ["timeout de rede", () => new Promise<RespostaAsk>(() => undefined), "timeout"],
    ["JSON lixo", () => Promise.resolve("lixo" as unknown as RespostaAsk), "resposta_invalida"],
    ["opção inventada", () => Promise.resolve({ probs: { teletransporte: 1 }, choice: "teletransporte", confidence: 0.99, latency_ms: 1, cost_usd: null }), "resposta_invalida"],
    ["probabilidades inconsistentes", () => Promise.resolve({ probs: { bug: 0.3, feature: 0.3 }, choice: "bug", confidence: 0.9, latency_ms: 1, cost_usd: null }), "resposta_invalida"],
    ["confiança fora de [0,1]", () => Promise.resolve({ probs: { bug: 1 }, choice: "bug", confidence: 7, latency_ms: 1, cost_usd: null }), "resposta_invalida"],
  ])("%s ⇒ sem decisão (a regra segue), sem lançar", async (_n, ask, motivo) => {
    const { d } = montar({ ...LIGADO, timeout_ms: 200 }, ask as PortaAsk["ask"]);
    const r = await d.consultar("corrige o login", "api");
    expect(r).toMatchObject({ ok: false, motivo, tentado: true });
  });
  it("a mensagem de erro da porta (que poderia ter segredo) nunca aparece no resultado", async () => {
    const { d } = montar(LIGADO, async () => {
      throw new Error("falhou com sk-SENTINELA-DA-CHAVE-123456789");
    });
    expect(JSON.stringify(await d.consultar("corrige o login", "api"))).not.toContain("SENTINELA");
  });
  it("texto vazio nunca chama a porta", async () => {
    const ask = vi.fn();
    const { d } = montar(LIGADO, ask);
    expect(await d.consultar("   ", "api")).toMatchObject({ ok: false });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("validarResposta", () => {
  it("aceita soma 0,99..1,01 e rejeita o resto", () => {
    expect(validarResposta({ probs: { bug: 0.5, feature: 0.5 }, choice: "bug", confidence: 0.5 })).not.toBeNull();
    expect(validarResposta({ probs: { bug: 0.99 }, choice: "bug", confidence: 0.5 })).not.toBeNull();
    expect(validarResposta({ probs: { bug: 0.9 }, choice: "bug", confidence: 0.5 })).toBeNull();
    expect(validarResposta(null)).toBeNull();
    expect(validarResposta({ probs: { bug: 1 }, choice: "desconhecida", confidence: 1 })).toBeNull();
    expect(validarResposta({ probs: { bug: 1.5, x: -0.5 }, choice: "bug", confidence: 1 })).toBeNull();
  });
});
