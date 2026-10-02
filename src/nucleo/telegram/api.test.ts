import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarRedeDeTeste, type RedeTeste } from "../../../tests/fixtures/alertas/rede-teste";
import { subirTelegramFalso, type TelegramFalso } from "../../../tests/fixtures/alertas/telegram-falso";
import { criarClienteBotApi, type ClienteBotApi } from "./api";
import { ErroTelegram, LimiteDeTaxa, sanitizarTexto } from "./erros";
import type { PortaRedeSegredo } from "./portas";

let falso: TelegramFalso;
let rede: RedeTeste;
let api: ClienteBotApi;
let consentimento = true;
let tokenAtual: string | null;

beforeEach(async () => {
  falso = await subirTelegramFalso({ escalaTempo: 100 });
  rede = criarRedeDeTeste();
  consentimento = true;
  tokenAtual = falso.token;
  api = criarClienteBotApi({ rede, token: () => tokenAtual, consentimentoValido: () => consentimento, host: "127.0.0.1", porta: falso.porta });
});
afterEach(async () => {
  await falso.fechar();
});

describe("cliente da Bot API (T-20.20)", () => {
  it("getMe, sendMessage, edit, answerCallbackQuery, setMyCommands, webhook funcionam contra o falso", async () => {
    expect(await api.getMe()).toEqual({ id: 777000111, username: "expx_teste_bot", nome: "Bot de Teste" });
    const u = falso.usuario(5);
    u.enviar("oi");
    const r = await api.sendMessage({ chat_id: 5, text: "<b>olá</b>", parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Ok", callback_data: "a:" + "x".repeat(22) }]] } });
    expect(falso.mensagens[0]?.html).toBe("<b>olá</b>");
    await api.editMessageText({ chat_id: 5, message_id: r.message_id, text: "novo", parse_mode: "HTML" });
    expect(falso.mensagens[0]?.texto).toBe("novo");
    await api.editMessageReplyMarkup({ chat_id: 5, message_id: r.message_id });
    expect(falso.mensagens[0]?.teclado).toBeNull();
    await api.answerCallbackQuery({ callback_query_id: "c1", text: "ok" });
    await api.setMyCommands([{ command: "status", description: "estado" }]);
    expect(falso.comandos).toHaveLength(1);
    falso.definirWebhook("https://alheio.example/h");
    expect((await api.getWebhookInfo()).url).toBe("https://alheio.example/h");
    await api.deleteWebhook();
    expect((await api.getWebhookInfo()).url).toBe("");
  });
  it("getUpdates: long polling real, offset confirma e descarta, limit, allowed_updates", async () => {
    const u = falso.usuario(5);
    const vazio = await api.getUpdates({ timeout: 1 });
    expect(vazio).toEqual([]);
    u.enviar("a");
    u.enviar("b");
    const lote = await api.getUpdates({ limit: 1 });
    expect(lote).toHaveLength(1);
    const prox = (lote[0] as { update_id: number }).update_id + 1;
    const lote2 = await api.getUpdates({ offset: prox });
    expect(lote2).toHaveLength(1);
    expect(falso.pendentes()).toBe(1);
    expect(await api.getUpdates({ offset: prox + 1 })).toEqual([]);
    expect(falso.pendentes()).toBe(0);
    // long poll acorda quando chega mensagem
    const p = api.getUpdates({ timeout: 30 });
    setTimeout(() => u.enviar("c"), 20);
    expect(await p).toHaveLength(1);
    expect(falso.chamadasDe("getUpdates").every((c) => JSON.stringify(c.corpo.allowed_updates) === '["message","callback_query"]')).toBe(true);
  });
  it("mapeia 401/409/429/5xx/400/403 e abort para o erro tipado; o código prevalece sobre o texto", async () => {
    falso.falhar("getMe", { status: 401 });
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "token_invalido", http: 401 });
    falso.falhar("getMe", { status: 409, corpo: { ok: false, error_code: 409, description: "texto totalmente diferente" } });
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "conflito" });
    falso.falhar("getMe", { status: 429, corpo: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } } });
    const e429 = await api.getMe().catch((e: unknown) => e);
    expect(e429).toBeInstanceOf(LimiteDeTaxa);
    expect((e429 as LimiteDeTaxa).retry_after_s).toBe(7);
    falso.falhar("getMe", { status: 502, corpo: "<html>bad gateway</html>" });
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "servidor" });
    falso.falhar("getMe", { status: 403, corpo: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } });
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "chat_inalcancavel" });
    falso.usuario(5);
    await expect(api.sendMessage({ chat_id: 5, text: "x".repeat(4097) })).rejects.toMatchObject({ codigo: "requisicao", http: 400 });
    falso.falhar("getMe", { cortar: true });
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "rede" });
    const ac = new AbortController();
    const p = api.getUpdates({ timeout: 30 }, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ codigo: "abortado" });
    expect(rede.emVoo()).toBe(0);
  });
  it("200 com corpo inválido => resposta_invalida; token inválido de verdade (401 do falso)", async () => {
    falso.falhar("getMe", { status: 200, corpo: "não é json" });
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "resposta_invalida" });
    tokenAtual = "999999999:" + "A".repeat(35);
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "token_invalido" });
    tokenAtual = null;
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "token_ausente" });
  });
  it("sem consentimento nenhuma chamada abre socket (0 conexões e 0 chamadas à rede)", async () => {
    consentimento = false;
    await expect(api.getMe()).rejects.toMatchObject({ codigo: "consentimento_ausente" });
    await expect(api.getUpdates({})).rejects.toMatchObject({ codigo: "consentimento_ausente" });
    expect(falso.conexoesTotais()).toBe(0);
    expect(rede.chamadas).toBe(0);
  });
  it("AB-20: o token aparece SÓ no caminho; nunca em corpo, cabeçalhos, erro, log nem stack (20 cenários de falha)", async () => {
    const cenarios: Array<() => Promise<unknown>> = [];
    for (const status of [401, 403, 409, 429, 500, 502, 503]) cenarios.push(async () => (falso.falhar("getMe", { status }), api.getMe()));
    cenarios.push(async () => (falso.falhar("getMe", { cortar: true }), api.getMe()));
    cenarios.push(async () => (falso.falhar("getMe", { status: 200, corpo: "x" }), api.getMe()));
    cenarios.push(async () => (falso.falhar("getMe", { status: 400, corpo: { ok: false, error_code: 400, description: `Bad Request: token ${falso.token} inválido em /bot${falso.token}/getMe` } }), api.getMe()));
    cenarios.push(async () => api.sendMessage({ chat_id: 404, text: "x" }));
    cenarios.push(async () => api.sendMessage({ chat_id: 5, text: "<" , parse_mode: "HTML" }));
    cenarios.push(async () => {
      const ac = new AbortController();
      ac.abort();
      return api.getMe(ac.signal);
    });
    for (let i = 0; i < 7; i++) cenarios.push(async () => api.getMe());
    falso.usuario(5);
    expect(cenarios.length).toBeGreaterThanOrEqual(20);
    for (const c of cenarios) {
      const r = await c().then(() => null, (e: unknown) => e);
      const texto = r instanceof Error ? `${r.name} ${r.message} ${r.stack ?? ""} ${(r as ErroTelegram).descricao ?? ""} ${JSON.stringify(r)}` : "";
      expect(texto).not.toContain(falso.token);
      expect(texto).not.toContain(falso.token.split(":")[1] as string);
    }
    expect(rede.logs.join("\n")).not.toContain(falso.token);
    const onde = falso.ondeTokenApareceu();
    expect(onde.corpo).toBe(0);
    expect(onde.cabecalhos).toBe(0);
    expect(onde.caminho).toBeGreaterThan(0);
  });
  it("sanitizarTexto troca /bot<token>/ e tokens literais", () => {
    expect(sanitizarTexto("falha em /bot123456789:AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s/getMe e 123456789:AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s")).toBe("falha em /bot***/getMe e ***");
    expect(sanitizarTexto("abc segredo-curto-12345 def", "segredo-curto-12345")).toBe("abc *** def");
  });
  it("porta de rede que lança com o caminho na mensagem NÃO vaza o token", async () => {
    const mau: PortaRedeSegredo = { requisitar: async (p) => { throw new Error(`ECONNRESET em https://api.telegram.org/bot${p.segredos.token}/getMe`); } };
    const a = criarClienteBotApi({ rede: mau, token: () => falso.token, consentimentoValido: () => true });
    const e = (await a.getMe().catch((x: unknown) => x)) as ErroTelegram;
    expect(`${e.message} ${e.stack}`).not.toContain(falso.token);
    expect(e.codigo).toBe("rede");
  });
});
