import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarRedeDeTeste, type RedeTeste } from "../../../tests/fixtures/alertas/rede-teste";
import { subirTelegramFalso, type TelegramFalso } from "../../../tests/fixtures/alertas/telegram-falso";
import { criarClienteBotApi } from "./api";
import { COMANDOS_DO_BOT, criarAssistente, FORMATO_TOKEN, mascararToken, nomeSegredoToken, PASSOS_BOTFATHER, textoConsentimento, type PortaCofreToken } from "./assistente";

let falso: TelegramFalso;
let rede: RedeTeste;
let cofre: { itens: Map<string, string>; ok: boolean } & PortaCofreToken;
let apiCriadas = 0;

beforeEach(async () => {
  falso = await subirTelegramFalso({ escalaTempo: 100 });
  rede = criarRedeDeTeste();
  apiCriadas = 0;
  const itens = new Map<string, string>();
  cofre = { itens, ok: true, disponivel: () => cofre.ok, guardar: async (n, v) => void itens.set(n, v), remover: async (n) => void itens.delete(n), existe: async (n) => itens.has(n) };
});
afterEach(async () => {
  await falso.fechar();
});
const montar = () =>
  criarAssistente({
    canal_id: "c1",
    cofre,
    apiPara: (token) => (apiCriadas++, criarClienteBotApi({ rede, token: () => token, consentimentoValido: () => true, host: "127.0.0.1", porta: falso.porta })),
    apiSalva: () => criarClienteBotApi({ rede, token: () => cofre.itens.get(nomeSegredoToken("c1")) ?? null, consentimentoValido: () => true, host: "127.0.0.1", porta: falso.porta }),
  });

describe("assistente (T-20.23)", () => {
  it("token de formato errado NEM chega à rede", async () => {
    const a = montar();
    for (const t of ["", "abc", "123:curto", "123456789:" + "A".repeat(60), "12345:AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s", "nao-eh-token"]) {
      expect(await a.testar(t)).toEqual({ ok: false, erro: "formato" });
      expect(await a.salvar(t)).toEqual({ ok: false, erro: "formato" });
    }
    expect(apiCriadas).toBe(0);
    expect(rede.chamadas).toBe(0);
    expect(falso.conexoesTotais()).toBe(0);
    expect(FORMATO_TOKEN.test(falso.token)).toBe(true);
  });
  it("testar = getMe (nenhum envio de mensagem) e mostra @username e nome", async () => {
    const r = await montar().testar(falso.token);
    expect(r).toEqual({ ok: true, bot: { id: 777000111, username: "expx_teste_bot", nome: "Bot de Teste" } });
    expect(falso.chamadasDe("sendMessage")).toHaveLength(0);
  });
  it("salvar: getMe ok -> SÓ no cofre; devolve apenas o mascarado; token nunca no retorno", async () => {
    const r = await montar().salvar(falso.token);
    expect(r.ok).toBe(true);
    expect(r.token_mascarado).toBe(mascararToken(falso.token));
    expect(r.token_mascarado).toMatch(/^1234….:AA…s$|^1234…:AA…_s$|…/);
    expect(JSON.stringify(r)).not.toContain(falso.token);
    expect(JSON.stringify(r)).not.toContain(falso.token.split(":")[1] as string);
    expect(cofre.itens.get("TELEGRAM_BOT_TOKEN_C1")).toBe(falso.token);
    expect([...cofre.itens.keys()]).toEqual(["TELEGRAM_BOT_TOKEN_C1"]);
  });
  it("getMe 401 => erro claro e NADA salvo; cofre indisponível => recusa com instrução e nada vai à rede", async () => {
    const a = montar();
    falso.invalidarToken();
    expect(await a.salvar(falso.token)).toMatchObject({ ok: false, erro: "nao_autorizado" });
    expect(cofre.itens.size).toBe(0);
    const antes = rede.chamadas;
    cofre.ok = false;
    const r = await a.salvar(falso.token);
    expect(r).toMatchObject({ ok: false, erro: "cofre_indisponivel" });
    expect(r.instrucao).toContain("cofre");
    expect(rede.chamadas).toBe(antes);
    expect(cofre.itens.size).toBe(0);
  });
  it("webhook ativo é detectado com instrução; deleteWebhook SÓ pelo passo explícito", async () => {
    const a = montar();
    falso.definirWebhook("https://alheio.example/h");
    const r = await a.testar(falso.token);
    expect(r).toMatchObject({ ok: false, erro: "webhook_ativo" });
    expect(r.instrucao).toContain("Limpar webhook");
    expect(falso.chamadasDe("deleteWebhook")).toHaveLength(0);
    await a.salvar(falso.token).catch(() => undefined);
    expect(falso.chamadasDe("deleteWebhook")).toHaveLength(0);
    cofre.itens.set("TELEGRAM_BOT_TOKEN_C1", falso.token);
    expect(await a.limparWebhook()).toEqual({ ok: true });
    expect(falso.chamadasDe("deleteWebhook")).toHaveLength(1);
    expect(falso.chamadasDe("deleteWebhook")[0]?.corpo).toEqual({ drop_pending_updates: false });
  });
  it("setMyCommands com a lista do bot; remover apaga do cofre; testar(null) usa o do cofre", async () => {
    const a = montar();
    cofre.itens.set("TELEGRAM_BOT_TOKEN_C1", falso.token);
    expect(await a.testar(null)).toMatchObject({ ok: true });
    expect(await a.configurarComandos()).toEqual({ ok: true });
    expect(falso.comandos.map((c) => c.command)).toEqual(COMANDOS_DO_BOT.map((c) => c.command));
    await a.remover();
    expect(cofre.itens.size).toBe(0);
    expect(await a.testar(null)).toMatchObject({ ok: false });
  });
  it("máscara, nome do segredo e passos do BotFather (texto fixo)", () => {
    expect(mascararToken("123456789:AAEhBP0av28CtQsZ2uWlFaKq7Jy0pLmN4_s")).toBe("1234…:AA…4_s");
    expect(nomeSegredoToken("can-1")).toBe("TELEGRAM_BOT_TOKEN_CAN_1");
    expect(PASSOS_BOTFATHER.join(" ")).toContain("/newbot");
    expect(PASSOS_BOTFATHER.join(" ")).toContain("/setjoingroups");
    expect(PASSOS_BOTFATHER.join(" ")).toContain("não foi confirmado");
  });
  it("consentimento: texto versionado com host e itens; hash muda se o texto mudar", () => {
    const a = textoConsentimento(["tarefa_concluida", "tarefa_atrasada"]);
    expect(a.host).toBe("api.telegram.org");
    expect(a.texto).toContain("não são ponta a ponta");
    expect(a.texto).toContain("tarefa_concluida, tarefa_atrasada");
    expect(a.hash_texto).toMatch(/^[0-9a-f]{64}$/);
    expect(textoConsentimento(["x"]).hash_texto).not.toBe(a.hash_texto);
    expect(textoConsentimento([]).texto).toContain("nenhum tipo ligado");
  });
});
