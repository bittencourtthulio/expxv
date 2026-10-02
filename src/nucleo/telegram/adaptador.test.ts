import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dormirFalso, relogioFalso } from "../../../tests/fixtures/alertas/ajudas";
import { criarRedeDeTeste } from "../../../tests/fixtures/alertas/rede-teste";
import { mensagemExemplo, suiteCanal } from "../../../tests/fixtures/alertas/suite-canal";
import { subirTelegramFalso, type TelegramFalso } from "../../../tests/fixtures/alertas/telegram-falso";
import { criarCanalTelegram } from "./adaptador";
import { criarClienteBotApi } from "./api";
import { montarCallback, novoNonce } from "./formato";
import { criarRepoTelegramMemoria, type RepoTelegram } from "./repo";

let falso: TelegramFalso;
let repo: RepoTelegram;
let consentimento = true;
const relogio = relogioFalso();
const sinal = (): AbortSignal => new AbortController().signal;

const autorizar = (user: number, extra: { revogado?: boolean } = {}): void => {
  repo.gravarAutorizado({ id: `a${user}`, canal_id: "c1", user_id: user, chat_id: user, nome_exibicao: "x", modo_padrao: "aprovar", texto_livre: true, pin_hash: null, criado_em: "x", ultimo_uso_em: "x", expira_em: new Date(relogio.agora() + 1e9).toISOString(), revogado_em: extra.revogado === true ? "x" : null });
  falso.usuario(user).enviar("oi"); // o usuário falou com o bot (condição da API para o bot responder)
};
const montar = () => {
  const dormir = dormirFalso();
  const api = criarClienteBotApi({ rede: criarRedeDeTeste(), token: () => falso.token, consentimentoValido: () => consentimento, host: "127.0.0.1", porta: falso.porta });
  return { canal: criarCanalTelegram({ api, repo, canal_id: "c1", relogio, consentimentoValido: () => consentimento, estadoCanal: () => "ativo", dormir }), dormir };
};

beforeEach(async () => {
  falso = await subirTelegramFalso({ escalaTempo: 100 });
  repo = criarRepoTelegramMemoria();
  consentimento = true;
});
afterEach(async () => {
  await falso.fechar();
});

suiteCanal("telegram", async () => {
  const f = await subirTelegramFalso();
  const r = criarRepoTelegramMemoria();
  const api = criarClienteBotApi({ rede: criarRedeDeTeste(), token: () => f.token, consentimentoValido: () => true, host: "127.0.0.1", porta: f.porta });
  return { canal: criarCanalTelegram({ api, repo: r, canal_id: "c1", relogio, consentimentoValido: () => true, estadoCanal: () => "ativo" }), limpar: () => f.fechar() };
});

describe("adaptador Telegram (T-20.22)", () => {
  it("envia HTML com preview desligado e silencioso por severidade; devolve o id da mensagem", async () => {
    autorizar(5);
    const { canal } = montar();
    const r = await canal.enviar(mensagemExemplo({ html: "<b>[Concluída]</b> T-1 &amp; ok", silenciosa: true }), sinal());
    expect(r).toMatchObject({ ok: true });
    const m = falso.mensagens.at(-1);
    expect(m?.html).toBe("<b>[Concluída]</b> T-1 &amp; ok");
    expect(m?.silenciosa).toBe(true);
    expect(falso.chamadasDe("sendMessage").at(-1)?.corpo.link_preview_options).toEqual({ is_disabled: true });
    expect(falso.chamadasDe("sendMessage").at(-1)?.corpo.parse_mode).toBe("HTML");
  });
  it("sem html usa o texto ESCAPADO; teclado com nonce vai só na última parte", async () => {
    autorizar(5);
    const { canal } = montar();
    const n = novoNonce();
    await canal.enviar(mensagemExemplo({ texto: "a <b> & c", botoes: [[{ rotulo: "Aprovar", dado: montarCallback("a", n) }]] }), sinal());
    expect(falso.mensagens.at(-1)?.texto).toBe("a <b> & c");
    expect(falso.mensagens.at(-1)?.teclado?.[0]?.[0]?.callback_data).toBe(`a:${n}`);
    // callback_data fora do formato é recusado antes do envio
    const antes = falso.chamadasDe("sendMessage").length;
    const r = await canal.enviar(mensagemExemplo({ botoes: [[{ rotulo: "x", dado: "x".repeat(65) }]] }), sinal());
    expect(r.ok).toBe(false);
    expect(falso.chamadasDe("sendMessage").length).toBe(antes);
  });
  it("mensagem > 3 500 visíveis é dividida em linhas inteiras (espaçadas) e NUNCA passa de 4 096 (o falso responderia 400)", async () => {
    autorizar(5);
    const { canal, dormir } = montar();
    const linhas = Array.from({ length: 300 }, (_, i) => `<b>[${i}]</b> linha de texto com bastante conteúdo para encher`);
    const r = await canal.enviar(mensagemExemplo({ html: linhas.join("\n") }), sinal());
    expect(r.ok).toBe(true);
    const enviadas = falso.mensagens.filter((m) => m.chat_id === 5 && m.html !== null);
    expect(enviadas.length).toBeGreaterThan(1);
    for (const m of enviadas) expect(Array.from(m.texto).length).toBeLessThanOrEqual(4096);
    expect(dormir.pedidos.filter((x) => x === 1100)).toHaveLength(enviadas.length - 1);
  });
  it("429 => tentar_em_ms = retry_after*1000 + 1000, sem laço", async () => {
    autorizar(5);
    const { canal } = montar();
    falso.falhar("sendMessage", { status: 429, corpo: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } } });
    expect(await canal.enviar(mensagemExemplo(), sinal())).toEqual({ ok: false, permanente: false, erro: "rate_limited", tentar_em_ms: 8000 });
    expect(falso.chamadasDe("sendMessage")).toHaveLength(1);
  });
  it("erro de parse no HTML => reenvia texto PURO uma vez; falhando de novo, desiste (sem laço)", async () => {
    autorizar(5);
    const { canal } = montar();
    falso.falhar("sendMessage", { status: 400, corpo: { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" } });
    const r = await canal.enviar(mensagemExemplo({ html: "<b>ok</b> texto" }), sinal());
    expect(r.ok).toBe(true);
    expect(falso.chamadasDe("sendMessage")).toHaveLength(2);
    expect(falso.chamadasDe("sendMessage")[1]?.corpo.parse_mode).toBeUndefined();
    expect(falso.mensagens.at(-1)?.texto).toBe("ok texto");
    falso.falhar("sendMessage", { status: 400, vezes: 2, corpo: { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } });
    const antes = falso.chamadasDe("sendMessage").length;
    expect(await canal.enviar(mensagemExemplo(), sinal())).toMatchObject({ ok: false, erro: "conteudo_invalido" });
    expect(falso.chamadasDe("sendMessage").length - antes).toBe(2);
  });
  it("401 e 403 são permanentes; 5xx e rede são tentáveis; abort não vaza", async () => {
    autorizar(5);
    const { canal } = montar();
    falso.falhar("sendMessage", { status: 401 });
    expect(await canal.enviar(mensagemExemplo(), sinal())).toEqual({ ok: false, permanente: true, erro: "token_invalido" });
    falso.falhar("sendMessage", { status: 403, corpo: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } });
    expect(await canal.enviar(mensagemExemplo(), sinal())).toEqual({ ok: false, permanente: true, erro: "chat_inalcancavel" });
    falso.falhar("sendMessage", { status: 502 });
    expect(await canal.enviar(mensagemExemplo(), sinal())).toEqual({ ok: false, permanente: false, erro: "rede" });
    falso.falhar("sendMessage", { cortar: true });
    expect(await canal.enviar(mensagemExemplo(), sinal())).toMatchObject({ ok: false, permanente: false, erro: "rede" });
    const ac = new AbortController();
    ac.abort();
    expect(await canal.enviar(mensagemExemplo(), ac.signal)).toMatchObject({ ok: false, permanente: false });
  });
  it("sem consentimento => 0 conexões; sem autorizado => chat_inalcançável permanente; revogado nunca recebe", async () => {
    autorizar(5);
    const { canal } = montar();
    consentimento = false;
    expect(await canal.enviar(mensagemExemplo(), sinal())).toEqual({ ok: false, permanente: true, erro: "consentimento_ausente" });
    expect(falso.conexoesTotais()).toBe(0);
    consentimento = true;
    repo.revogarTodos("c1", new Date().toISOString());
    expect(await canal.enviar(mensagemExemplo(), sinal())).toMatchObject({ ok: false, permanente: true, erro: "chat_inalcancavel" });
    expect(falso.chamadasDe("sendMessage")).toHaveLength(0);
  });
  it("destino de pedido remoto vai SÓ ao chat indicado; sem destino vai a todos os ativos; chat_ref inválido não envia", async () => {
    autorizar(5);
    autorizar(6);
    autorizar(7, { revogado: true });
    const { canal } = montar();
    await canal.enviar(mensagemExemplo({ destino: { chat_ref: "chat:6" } }), sinal());
    expect(falso.mensagens.map((m) => m.chat_id)).toEqual([6]);
    await canal.enviar(mensagemExemplo(), sinal());
    expect(falso.mensagens.map((m) => m.chat_id).sort()).toEqual([5, 6, 6]);
    expect((await canal.enviar(mensagemExemplo({ destino: { chat_ref: "chat:999" } }), sinal())).ok).toBe(false);
    expect((await canal.enviar(mensagemExemplo({ destino: { chat_ref: "x:1" } }), sinal())).ok).toBe(false);
  });
  it("testar(): getMe + mensagem de teste sem segredo no detalhe", async () => {
    autorizar(5);
    const { canal } = montar();
    const t = await canal.testar(sinal());
    expect(t.ok).toBe(true);
    expect(t.detalhe).toContain("@expx_teste_bot");
    expect(t.detalhe).not.toContain(falso.token);
    consentimento = false;
    expect(await canal.testar(sinal())).toEqual({ ok: false, detalhe: "consentimento ausente" });
  });
});
