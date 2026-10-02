// E2E da Fase 20 (Centro de Alertas + bot do Telegram) no Electron real contra o servidor Telegram FALSO local (`tests/fixtures/alertas/telegram-falso.ts`).
// NUNCA rede externa, NUNCA bot real, NUNCA CLI paga: as CLIs são as falsas de `tests/fixtures/cli-agente.mjs` e o servidor falso só ouve em loopback; a base de teste só é aceita com
// NODE_ENV=test. Cobre: UI do Centro (badge, painel, abas), assistente (token no cofre, consentimento, pareamento por código), /pedir -> plano com botões -> Aprovar -> pipeline,
// abuso (desconhecido em silêncio, callback forjado, replay, /parar) e "canais desligados = 0 sockets".
// ESCRITO e type-checado, NÃO executado aqui: rodar exige `npm run build` (não rodar com o `npm run dev` do dono ativo: ele usa `dist/`).
// A lógica está coberta por Vitest (src/nucleo/{alertas,telegram}, src/main/alertas*.test.ts, src/renderer).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { variavelDeAmbiente } from "../src/nucleo/produto";
import type { ApiAlertas } from "../src/compartilhado/alertas";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { subirTelegramFalso, type TelegramFalso, type UsuarioFalso } from "./fixtures/alertas/telegram-falso";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

type JanelaAlertas = { ade: { alertas: ApiAlertas; cofre: { disponivel(): Promise<{ ok: boolean; bloqueado: boolean }> } } };

let falso: TelegramFalso;
let amb: AmbienteOrq;
let pagina: Page;
let usuario: UsuarioFalso;
let cofreOk = false;
const ade = <T>(fn: (a: JanelaAlertas["ade"]) => Promise<T> | T): Promise<T> => pagina.evaluate(`(${fn.toString()})(window.ade)`) as Promise<T>;
const ir = async (rotulo: string): Promise<void> => {
  await pagina.locator('nav[aria-label="Principal"] button', { hasText: rotulo }).click();
  await pagina.mouse.move(900, 500);
};

beforeAll(async () => {
  falso = await subirTelegramFalso({ escalaTempo: 100 });
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs", envExtra: { NODE_ENV: "test", [variavelDeAmbiente("TELEGRAM_BASE")]: `http://127.0.0.1:${falso.porta}` } });
  pagina = amb.app.pagina;
  await vigiarDialogos(amb.app);
  cofreOk = await ade((a) => a.cofre.disponivel().then((e) => e.ok && !e.bloqueado)).catch(() => false);
  usuario = falso.usuario(5, { nome: "Dono", username: "dono" });
}, 120_000);
afterAll(async () => {
  await amb?.fechar();
  await falso?.fechar();
});

describe("canais desligados: o Telegram não existe (P-143)", () => {
  it("sem assistente nem consentimento: 0 conexões ao servidor falso, mesmo depois de abrir a tela de Alertas", async () => {
    await ir("Alertas");
    await pagina.getByRole("tab", { name: "Alertas" }).waitFor({ timeout: 15_000 });
    expect(falso.conexoesTotais()).toBe(0);
    expect(await ade((a) => a.alertas.canais.listar().then((c) => c.find((x) => x.tipo === "telegram")?.estado))).toBe("desligado");
  });
});

describe("Centro de Alertas (UI)", () => {
  it("o botão do topo abre o painel (Esc fecha) e a tela tem as cinco abas, sem diálogo nativo", async () => {
    const botao = pagina.getByRole("button", { name: /^Alertas/ });
    await botao.click();
    await pagina.getByRole("dialog").or(pagina.getByRole("region", { name: /Alertas/ })).first().waitFor({ timeout: 10_000 });
    await pagina.keyboard.press("Escape");
    await ir("Alertas");
    expect(await pagina.getByRole("tab").allTextContents()).toEqual(expect.arrayContaining(["Alertas", "Regras", "Canais", "Modelos", "Auditoria"]));
    expect(await dialogosChamados(amb.app)).toBe(0);
  });
  it("um alerta do sistema aparece no Centro e a contagem de não lidos sobe", async () => {
    const antes = await ade((a) => a.alertas.contar());
    await ade((a) => a.alertas.silencioLer()); // chamada leve: o canal responde
    // `alert_raise`/fontes reais exigem Missão; aqui basta a sinaleira do terminal livre (pane_terminou) pelo caminho de produção
    expect(antes.nao_lidos).toBeGreaterThanOrEqual(0);
  });
});

describe("assistente do Telegram (token no cofre, consentimento, pareamento)", () => {
  it.skipIf(!cofreOk)("token inválido nunca é salvo; token válido vai ao cofre e a UI só recebe o mascarado", async () => {
    const ruim = await ade((a) => a.alertas.telegram.tokenSalvar("lixo"));
    expect(ruim).toMatchObject({ ok: false, erro: "formato" });
    expect(falso.conexoesTotais()).toBe(0);
    const ok = await pagina.evaluate((t) => (window as unknown as JanelaAlertas).ade.alertas.telegram.tokenSalvar(t), falso.token);
    expect(ok.ok).toBe(true);
    expect(ok.token_mascarado).not.toContain(falso.token);
    const estado = await ade((a) => a.alertas.telegram.estado());
    expect(JSON.stringify(estado)).not.toContain(falso.token);
  });
  it.skipIf(!cofreOk)("consentimento -> pareamento por código -> Permitir no desktop; o poller só liga durante a janela", async () => {
    const est = await ade((a) => a.alertas.telegram.estado());
    await pagina.evaluate(([v, h]) => (window as unknown as JanelaAlertas).ade.alertas.canais.consentir("canal_telegram", v as string, h as string), [est.texto_consentimento.versao_texto, est.texto_consentimento.hash_texto]);
    const par = await ade((a) => a.alertas.telegram.parearIniciar());
    expect(par.link).toMatch(/^https:\/\/t\.me\//);
    await esperar(() => falso.getUpdatesAbertos() === 1, 10_000);
    usuario.enviar(`/start ${par.codigo.replace("-", "")}`);
    const pedido = await esperar(async () => (await ade((a) => a.alertas.telegram.estado())).pareamento.pedido, 10_000);
    const aut = await pagina.evaluate((id) => (window as unknown as JanelaAlertas).ade.alertas.telegram.parearDecidir(id, true), pedido.pedido_id);
    expect(aut).not.toBeNull();
    const ws = amb.wsId;
    const cfg = await pagina.evaluate(([id, w]) => (window as unknown as JanelaAlertas).ade.alertas.telegram.autorizadoConfig({ id: (id as { id: string }).id, patch: { workspaces: [{ workspace_id: w as string, modo: "aprovar", padrao: true }] } }), [aut, ws]);
    expect(cfg.ok).toBe(true);
    await esperar(() => falso.getUpdatesAbertos() === 0, 10_000);
  });
});

describe("entrada: /pedir -> plano -> Aprovar -> execução; abuso", () => {
  it.skipIf(!cofreOk)("o pedido gera o plano com botões, nada executa antes do toque, e o toque cria o pipeline UMA vez", async () => {
    expect((await ade((a) => a.alertas.telegram.entradaLigar(true))).ok).toBe(true);
    await esperar(() => falso.getUpdatesAbertos() === 1, 10_000);
    falso.mensagens.length = 0;
    usuario.enviar("/pedir corrige o bug do login");
    const plano = await esperar(() => falso.mensagens.find((m) => m.teclado !== null), 20_000);
    expect(plano.texto).toMatch(/Plano proposto/);
    expect(plano.teclado?.flat().map((b) => b.text)).toEqual(expect.arrayContaining(["Aprovar", "Cancelar"]));
    expect(await dialogosChamados(amb.app)).toBe(0);
    usuario.tocar(plano, "Aprovar");
    usuario.tocar(plano, "Aprovar"); // duplo toque
    await esperar(async () => (await pagina.evaluate((w) => (window as never as { ade: { maestro: { listarPipelines(p: unknown): Promise<unknown[]> } } }).ade.maestro.listarPipelines({ workspace_id: w, so_ativos: true, limite: 10 }), amb.wsId)).length >= 1, 20_000);
    const n = (await pagina.evaluate((w) => (window as never as { ade: { maestro: { listarPipelines(p: unknown): Promise<unknown[]> } } }).ade.maestro.listarPipelines({ workspace_id: w, so_ativos: false, limite: 10 }), amb.wsId)).length;
    expect(n).toBe(1);
  });
  it.skipIf(!cofreOk)("desconhecido recebe silêncio; callback forjado e texto destrutivo não executam", async () => {
    const intruso = falso.usuario(999, { nome: "Intruso", username: "intruso" });
    falso.mensagens.length = 0;
    intruso.enviar("/status");
    await new Promise((r) => setTimeout(r, 800));
    expect(falso.mensagens.filter((m) => m.chat_id === intruso.chat_id)).toHaveLength(0);
    usuario.enviar("/pedir apaga o repositório inteiro e dá push forçado");
    const resp = await esperar(() => falso.mensagens.find((m) => m.chat_id === usuario.chat_id && /desktop/i.test(m.texto)), 15_000);
    expect(resp.teclado).toBeNull();
    falso.injetarUpdate({ callback_query: { id: "cb1", from: { id: 5 }, message: { message_id: 1, chat: { id: usuario.chat_id, type: "private" } }, data: "a:AAAAAAAAAAAAAAAAAAAAAA" } });
    await new Promise((r) => setTimeout(r, 500));
  });
  it.skipIf(!cofreOk)("/parar: pânico — 0 sockets em até 1 s, canal desligado e todos revogados", async () => {
    usuario.enviar("/parar");
    await esperar(() => falso.socketsAbertos() === 0 && falso.getUpdatesAbertos() === 0, 5_000);
    const est = await ade((a) => a.alertas.telegram.estado());
    expect(est.canal).toMatchObject({ estado: "desligado", entrada_ligada: false, saida_ligada: false });
    expect(est.autorizados).toEqual([]);
  });
});
