import { SK_ANT, TOKEN_BOT } from "../../../../tests/fixtures/alertas/sentinelas";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { suiteCanal, mensagemExemplo } from "../../../../tests/fixtures/alertas/suite-canal";
import { consentimentoValido, ConsentimentoAusente, criarRegistroDeCanais, exigirConsentimento, type CanalComunicacao } from "../canal";
import { CABECALHO_ASSINATURA, criarCanalWebhook } from "./webhook";
import { criarCanalSo, type NotificacaoSo } from "./so";
import { criarCanalToast } from "./toast";

const consent = (versao = "v1") => ({ versao_texto: versao, hash_texto: "h", aceito_em: "2026-09-30T00:00:00Z", host: "api.telegram.org", itens_enviados: [] });

describe("consentimento (T-20.16)", () => {
  it("canal externo sem consentimento válido recusa ANTES de qualquer I/O; mudar a versão do texto invalida", () => {
    expect(() => exigirConsentimento({ tipo: "telegram", consentimento: null }, "v1")).toThrow(ConsentimentoAusente);
    expect(() => exigirConsentimento({ tipo: "telegram", consentimento: consent("v1") }, "v2")).toThrow(ConsentimentoAusente);
    expect(() => exigirConsentimento({ tipo: "telegram", consentimento: consent("v1") }, "v1", "outro.host")).toThrow(ConsentimentoAusente);
    expect(() => exigirConsentimento({ tipo: "telegram", consentimento: consent("v1") }, "v1", "api.telegram.org")).not.toThrow();
    expect(() => exigirConsentimento({ tipo: "so", consentimento: null }, "v1")).not.toThrow();
    expect(consentimentoValido({ ...consent(), aceito_em: "lixo" }, "v1")).toBe(false);
  });
});

describe("registro de canais", () => {
  it("registra uma vez, instancia lazy e reusa; duplicado é erro; descartar chama parar()", async () => {
    const r = criarRegistroDeCanais();
    let criados = 0;
    let paradas = 0;
    const falso = (): CanalComunicacao => ({ tipo: "toast", capacidades: criarCanalToast({ mostrar() {} }).capacidades, estado: () => "ativo", enviar: async () => ({ ok: true }), testar: async () => ({ ok: true, detalhe: "" }), parar: async () => void paradas++ });
    r.registrar("toast", () => (criados++, falso()));
    expect(() => r.registrar("toast", falso)).toThrow(/já registrado/);
    expect(r.instanciados()).toEqual([]);
    const a = await r.obter("toast");
    expect(await r.obter("toast")).toBe(a);
    expect(criados).toBe(1);
    expect(await r.obter("webhook")).toBeNull();
    await r.descartar("toast");
    expect(paradas).toBe(1);
    expect(r.instanciados()).toEqual([]);
  });
});

describe("canal SO (T-20.17)", () => {
  const montar = (o: { foco?: boolean; pref?: boolean; apenasSemFoco?: boolean } = {}) => {
    const mostradas: NotificacaoSo[] = [];
    const canal = criarCanalSo({ mostrar: (n) => mostradas.push(n), emFoco: () => o.foco ?? false, preferenciaLigada: () => o.pref ?? true, ...(o.apenasSemFoco === undefined ? {} : { apenasSemFoco: () => o.apenasSemFoco as boolean }) });
    return { canal, mostradas };
  };
  const sinal = new AbortController().signal;
  it("sem foco => 1 notificação; com foco => nenhuma; preferência desligada => nenhuma; configurável", async () => {
    const a = montar();
    await a.canal.enviar(mensagemExemplo(), sinal);
    expect(a.mostradas).toHaveLength(1);
    const b = montar({ foco: true });
    await b.canal.enviar(mensagemExemplo(), sinal);
    expect(b.mostradas).toHaveLength(0);
    const c = montar({ pref: false });
    expect((await c.canal.enviar(mensagemExemplo(), sinal)).ok).toBe(true);
    expect(c.mostradas).toHaveLength(0);
    const d = montar({ foco: true, apenasSemFoco: false });
    await d.canal.enviar(mensagemExemplo(), sinal);
    expect(d.mostradas).toHaveLength(1);
  });
  it("nenhum texto de terminal, caminho ou segredo na notificação; silent por severidade", async () => {
    const { canal, mostradas } = montar();
    await canal.enviar(mensagemExemplo({ titulo: "ver /Users/x/proj/a.ts", texto: "token " + TOKEN_BOT + " em /home/a/b\n\u001b[31mvermelho", silenciosa: false, severidade: "critico" }), sinal);
    const n = mostradas[0];
    expect(`${n?.titulo} ${n?.corpo}`).not.toMatch(/\/Users|\/home|123456789:AAE|\u001b/);
    expect(n?.silenciosa).toBe(false);
  });
});

suiteCanal("so", async () => ({ canal: criarCanalSo({ mostrar() {}, emFoco: () => false, preferenciaLigada: () => true }) }));
suiteCanal("toast", async () => ({ canal: criarCanalToast({ mostrar() {} }) }));
suiteCanal("webhook", async () => ({ canal: criarCanalWebhook({ host: "hooks.exemplo.dev", caminho: "/x", segredo: async () => "segredo-de-teste", http: { postar: async () => ({ status: 204 }) } }) }));

describe("webhook (T-20.39)", () => {
  it("assinatura HMAC-SHA-256 verificável; segredo fora do corpo; host e caminho vão para a porta de rede", async () => {
    const vistos: Array<{ host: string; caminho: string; corpo: string; cab: Record<string, string> }> = [];
    const canal = criarCanalWebhook({ host: "hooks.exemplo.dev", caminho: "/entrada", segredo: async () => "segredo-de-teste", agora: () => 0, http: { postar: async (p) => (vistos.push({ host: p.host, caminho: p.caminho, corpo: p.corpo, cab: p.cabecalhos }), { status: 200 }) } });
    const r = await canal.enviar(mensagemExemplo({ texto: SK_ANT + " feito" }), new AbortController().signal);
    expect(r.ok).toBe(true);
    const v = vistos[0] as (typeof vistos)[number];
    expect(v.host).toBe("hooks.exemplo.dev");
    expect(v.cab[CABECALHO_ASSINATURA]).toBe(`sha256=${createHmac("sha256", "segredo-de-teste").update(v.corpo).digest("hex")}`);
    expect(v.corpo).not.toContain("segredo-de-teste");
    expect(v.corpo).not.toContain("sk-ant");
    expect(Object.keys(JSON.parse(v.corpo))).toEqual(["id", "tipo", "severidade", "titulo", "texto", "ts"]);
  });
  it("sem segredo no cofre não envia (permanente); 5xx e 429 são tentáveis; 4xx permanente; rede cai => tentável", async () => {
    const sinal = new AbortController().signal;
    const mk = (status: number | Error, segredo: string | null = "s") => criarCanalWebhook({ host: "h.dev", caminho: "/", segredo: async () => segredo, http: { postar: async () => { if (status instanceof Error) throw status; return { status }; } } });
    expect(await mk(200, null).enviar(mensagemExemplo(), sinal)).toMatchObject({ ok: false, permanente: true });
    expect(await mk(503).enviar(mensagemExemplo(), sinal)).toMatchObject({ ok: false, permanente: false, erro: "rede" });
    expect(await mk(429).enviar(mensagemExemplo(), sinal)).toMatchObject({ ok: false, erro: "rate_limited" });
    expect(await mk(404).enviar(mensagemExemplo(), sinal)).toMatchObject({ ok: false, permanente: true });
    expect(await mk(new Error("ECONNRESET")).enviar(mensagemExemplo(), sinal)).toMatchObject({ ok: false, permanente: false });
  });
});
