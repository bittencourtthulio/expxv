import { afterEach, describe, expect, it } from "vitest";
import { subirTelegramFalso, type TelegramFalso } from "../../tests/fixtures/alertas/telegram-falso";
import { criarClienteBotApi } from "../nucleo/telegram/api";
import { baseDeTeste, criarRedeTelegram, HOST_API_TELEGRAM, type RedeTelegram } from "./alertas-rede";
import { variavelDeAmbiente } from "../nucleo/produto";

let falso: TelegramFalso | null = null;
afterEach(async () => {
  await falso?.fechar();
  falso = null;
});

const envPara = (porta: number, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ NODE_ENV: "test", [variavelDeAmbiente("TELEGRAM_BASE")]: `http://127.0.0.1:${porta}`, ...extra });

async function montar(autorizado = true): Promise<{ f: TelegramFalso; rede: RedeTelegram; logs: string[] }> {
  const f = await subirTelegramFalso({ escalaTempo: 100 });
  falso = f;
  const logs: string[] = [];
  const rede = criarRedeTelegram({ autorizado: () => autorizado, env: envPara(f.porta) });
  return { f, rede, logs };
}
const api = (m: { f: TelegramFalso; rede: RedeTelegram }, autorizado = true) =>
  criarClienteBotApi({ rede: m.rede, token: () => m.f.token, consentimentoValido: () => autorizado, host: m.rede.baseTeste?.host ?? HOST_API_TELEGRAM, ...(m.rede.baseTeste === null ? {} : { porta: m.rede.baseTeste.porta }) });

describe("base de teste", () => {
  it("só existe com NODE_ENV=test e em loopback", () => {
    const v = variavelDeAmbiente("TELEGRAM_BASE");
    expect(baseDeTeste({ NODE_ENV: "test", [v]: "http://127.0.0.1:4321" })).toEqual({ host: "127.0.0.1", porta: 4321 });
    expect(baseDeTeste({ NODE_ENV: "production", [v]: "http://127.0.0.1:4321" })).toBeNull();
    expect(baseDeTeste({ [v]: "http://127.0.0.1:4321" })).toBeNull();
    expect(baseDeTeste({ NODE_ENV: "test", [v]: "http://evil.example:80" })).toBeNull();
    expect(baseDeTeste({ NODE_ENV: "test", [v]: "https://127.0.0.1:4321" })).toBeNull();
    expect(baseDeTeste({ NODE_ENV: "test", [v]: "http://10.0.0.5:4321" })).toBeNull();
  });
});

describe("PortaRedeSegredo do Telegram (T-20.18)", () => {
  it("getMe e sendMessage funcionam; o token só aparece no CAMINHO do servidor", async () => {
    const m = await montar();
    const a = api(m);
    expect((await a.getMe()).username).toBeTruthy();
    const u = m.f.usuario(7);
    u.enviar("/start");
    const r = await a.sendMessage({ chat_id: u.chat_id, text: "oi" });
    expect(typeof r.message_id).toBe("number");
    expect(m.f.ondeTokenApareceu()).toMatchObject({ corpo: 0, cabecalhos: 0 });
    expect(m.f.ondeTokenApareceu().caminho).toBeGreaterThan(0);
  });

  it("sem autorização (sem consentimento nem clique): consent_required e ZERO conexões", async () => {
    const m = await montar(false);
    await expect(api(m, true).getMe()).rejects.toMatchObject({ codigo: "rede" });
    expect(m.f.conexoesTotais()).toBe(0);
  });

  it("host diferente do fixo é recusado antes de abrir socket", async () => {
    const m = await montar();
    await expect(m.rede.requisitar({ host: "evil.example", metodo: "POST", caminho_template: "/bot{token}/getMe", segredos: { token: m.f.token }, timeout_ms: 1000, max_bytes: 1000 })).rejects.toThrow(/host_nao_permitido/);
    expect(m.f.conexoesTotais()).toBe(0);
  });

  it("template fora de /bot{token}/<método> e segredo malformado são recusados (sem socket)", async () => {
    const m = await montar();
    const base = { host: m.rede.baseTeste?.host ?? "", porta: m.rede.baseTeste?.porta ?? 0, metodo: "POST" as const, timeout_ms: 1000, max_bytes: 1000 };
    for (const caminho_template of ["/x/{token}", "/bot{token}/../getMe", "/bot{token}/getMe?x=1", "//bot{token}/getMe"]) {
      await expect(m.rede.requisitar({ ...base, caminho_template, segredos: { token: m.f.token } })).rejects.toThrow();
    }
    await expect(m.rede.requisitar({ ...base, caminho_template: "/bot{token}/getMe", segredos: { token: "a/b?c" } })).rejects.toThrow();
    expect(m.f.conexoesTotais()).toBe(0);
  });

  it("erro de rede nunca carrega o caminho nem o token", async () => {
    const m = await montar();
    m.f.falhar("getMe", { cortar: true });
    let msg = "";
    try {
      await m.rede.requisitar({ host: m.rede.baseTeste?.host ?? "", porta: m.rede.baseTeste?.porta ?? 0, metodo: "POST", caminho_template: "/bot{token}/getMe", segredos: { token: m.f.token }, timeout_ms: 2000, max_bytes: 1000 });
    } catch (e) {
      msg = `${(e as Error).message} ${(e as Error).stack ?? ""}`;
    }
    expect(msg).toContain("rede:");
    expect(msg).not.toContain(m.f.token);
    expect(msg).not.toContain("/bot");
  });

  it("aborto REAL: o long poll aberto vai a 0 sockets em menos de 1 s", async () => {
    const m = await montar();
    const ctl = new AbortController();
    const p = api(m).getUpdates({ timeout: 30 }, ctl.signal);
    const t0 = Date.now();
    while (m.f.getUpdatesAbertos() === 0 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 5));
    expect(m.f.getUpdatesAbertos()).toBe(1);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ codigo: "abortado" });
    const t1 = Date.now();
    while (m.f.socketsAbertos() > 0 && Date.now() - t1 < 1000) await new Promise((r) => setTimeout(r, 5));
    expect(m.f.socketsAbertos()).toBe(0);
    expect(m.rede.emVoo()).toBe(0);
  });

  it("resposta acima do teto é abortada", async () => {
    const m = await montar();
    m.f.falhar("getMe", { status: 200, corpo: { ok: true, result: "x".repeat(2000) } });
    await expect(m.rede.requisitar({ host: m.rede.baseTeste?.host ?? "", porta: m.rede.baseTeste?.porta ?? 0, metodo: "POST", caminho_template: "/bot{token}/getMe", segredos: { token: m.f.token }, timeout_ms: 2000, max_bytes: 100 })).rejects.toThrow(/resposta_grande_demais/);
  });
});
