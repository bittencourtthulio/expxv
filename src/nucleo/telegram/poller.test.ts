import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dormirFalso, esperarAte, relogioFalso, type DormirFalso } from "../../../tests/fixtures/alertas/ajudas";
import { criarRedeDeTeste, type RedeTeste } from "../../../tests/fixtures/alertas/rede-teste";
import { subirTelegramFalso, type TelegramFalso } from "../../../tests/fixtures/alertas/telegram-falso";
import { criarClienteBotApi, type ClienteBotApi } from "./api";
import { criarPoller, type Poller } from "./poller";
import { criarRepoTelegramMemoria, type RepoTelegram } from "./repo";
import type { TgUpdate } from "./tipos";

let falso: TelegramFalso;
let rede: RedeTeste;
let api: ClienteBotApi;
let repo: RepoTelegram;
let dormir: DormirFalso;
let vistos: number[];
let estados: string[];
const pollers: Poller[] = [];
const travas = new Set<string>();
const relogio = relogioFalso();

function novo(o: { canal?: string; repo?: RepoTelegram; processar?: (u: TgUpdate) => Promise<void> } = {}): Poller {
  const p = criarPoller({
    api,
    repo: o.repo ?? repo,
    canal_id: o.canal ?? "c1",
    processar: o.processar ?? (async (u) => void vistos.push(u.update_id)),
    relogio,
    dormir,
    aleatorio: () => 0.5,
    aoEstado: (e) => estados.push(e),
    travas,
  });
  pollers.push(p);
  return p;
}

beforeEach(async () => {
  falso = await subirTelegramFalso({ escalaTempo: 100 });
  rede = criarRedeDeTeste();
  api = criarClienteBotApi({ rede, token: () => falso.token, consentimentoValido: () => true, host: "127.0.0.1", porta: falso.porta });
  repo = criarRepoTelegramMemoria();
  dormir = dormirFalso();
  vistos = [];
  estados = [];
  travas.clear();
});
afterEach(async () => {
  for (const p of pollers.splice(0)) await p.parar();
  await falso.fechar();
});

describe("poller (T-20.24)", () => {
  it("descarte inicial: updates ANTERIORES ao início não são executados; offset confirmado; depois passa a processar", async () => {
    const u = falso.usuario(5);
    u.enviar("/pedir apaga tudo");
    u.enviar("antigo 2");
    const p = novo();
    p.iniciar();
    await esperarAte(() => repo.estado("c1").descarte_inicial_feito && falso.getUpdatesAbertos() === 1);
    expect(vistos).toEqual([]);
    expect(falso.pendentes()).toBe(0);
    u.enviar("novo");
    await esperarAte(() => vistos.length === 1);
    await esperarAte(() => repo.estado("c1").proximo_offset !== null && (repo.estado("c1").proximo_offset as number) > vistos[0]!);
    expect(repo.estado("c1").proximo_offset).toBe((vistos[0] as number) + 1);
  });
  it("parâmetros do long poll: limit 20, timeout 30, allowed_updates [message, callback_query]", async () => {
    const p = novo();
    p.iniciar();
    await esperarAte(() => falso.chamadasDe("getUpdates").length >= 3);
    const c = falso.chamadasDe("getUpdates").at(-1)?.corpo;
    expect(c).toMatchObject({ limit: 20, timeout: 30, allowed_updates: ["message", "callback_query"] });
    expect(falso.chamadasDe("getUpdates")[0]?.corpo).toMatchObject({ limit: 100, timeout: 0 }); // descarte inicial
  });
  it("P-142 (ocioso): sem updates, cada requisição segura 30 s (<= 2/min) e o poller não faz outras chamadas", async () => {
    const p = novo();
    p.iniciar();
    await new Promise((r) => setTimeout(r, 1000)); // com escala 100 = ~100 s virtuais
    const n = falso.chamadasDe("getUpdates").filter((c) => (c.corpo.timeout as number) === 30).length;
    expect(n).toBeLessThanOrEqual(1000 / 300 + 2); // 30 s virtuais por requisição
    expect(falso.chamadas.every((c) => c.metodo === "getUpdates")).toBe(true);
    expect(falso.getUpdatesAbertos()).toBeLessThanOrEqual(1);
  });
  it("replay: queda ENTRE processar e gravar o offset => nenhum reprocessado e nenhum perdido (dedupe por update_id)", async () => {
    const u = falso.usuario(5);
    const p0 = novo();
    p0.iniciar();
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    await p0.parar();
    // 1º processo: processa o update 1, marca visto e MORRE antes de gravar o offset (a transação falha)
    const repo1: RepoTelegram = { ...repo, transacao: () => { throw new Error("morreu"); } };
    const efeitos: number[] = [];
    const p1 = novo({ repo: repo1, processar: async (x) => void efeitos.push(x.update_id) });
    u.enviar("primeiro");
    p1.iniciar();
    await esperarAte(() => efeitos.length === 1);
    await p1.parar();
    expect(repo.estado("c1").proximo_offset).not.toBe(efeitos[0]! + 1); // offset NÃO avançou
    // religa: o servidor reentrega o mesmo update; o dedupe impede o reprocessamento; o novo é processado
    u.enviar("segundo");
    const p2 = novo({ processar: async (x) => void efeitos.push(x.update_id) });
    p2.iniciar();
    await esperarAte(() => efeitos.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(efeitos).toHaveLength(2);
    expect(new Set(efeitos).size).toBe(2);
  });
  it("update_id repetido é ignorado", async () => {
    const p = novo();
    repo.marcarVisto(5000, new Date().toISOString());
    p.iniciar();
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    falso.injetarUpdate({ message: { message_id: 1, date: 1, chat: { id: 5, type: "private" }, from: { id: 5 }, text: "x" } });
    await esperarAte(() => vistos.length === 1);
    expect(vistos).toHaveLength(1);
  });
  it("401 (token inválido/rotacionado): estado erro, alerta ao main, SEM laço de retentativa", async () => {
    falso.invalidarToken();
    const p = novo();
    p.iniciar();
    await esperarAte(() => p.estado() === "erro");
    const n = falso.chamadasDe("getUpdates").length;
    await new Promise((r) => setTimeout(r, 100));
    expect(falso.chamadasDe("getUpdates").length).toBe(n);
    expect(p.ativo()).toBe(false);
    expect(repo.estado("c1").ultimo_erro_codigo).toBe("token_invalido");
  });
  it("409: espera 5 s e 15 s, no 3º vira conflito, NÃO retoma sozinho; [Retomar] volta", async () => {
    falso.falhar("getUpdates", { status: 409, vezes: 3 });
    const p = novo();
    p.iniciar();
    await esperarAte(() => p.estado() === "conflito");
    expect(dormir.pedidos.filter((x) => x === 5000 || x === 15000)).toEqual([5000, 15000]);
    expect(falso.chamadasDe("getWebhookInfo")).toHaveLength(1);
    const n = falso.chamadasDe("getUpdates").length;
    await new Promise((r) => setTimeout(r, 100));
    expect(falso.chamadasDe("getUpdates").length).toBe(n);
    expect(p.ativo()).toBe(false);
    p.retomarManual();
    await esperarAte(() => p.estado() === "ativo" && falso.chamadasDe("getUpdates").length > n);
    expect(repo.estado("c1").conflitos_seguidos).toBe(0);
  });
  it("409 por webhook plantado => token_possivelmente_comprometido; o app NUNCA chama deleteWebhook", async () => {
    falso.definirWebhook("https://atacante.example/hook");
    const p = novo();
    p.iniciar();
    await esperarAte(() => p.estado() === "token_possivelmente_comprometido");
    expect(falso.chamadasDe("deleteWebhook")).toHaveLength(0);
    expect(falso.chamadasDe("getWebhookInfo").length).toBeGreaterThanOrEqual(1);
  });
  it("dois pollers reais no mesmo token: o anterior recebe 409 do servidor", async () => {
    const p = novo();
    p.iniciar();
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    await api.getUpdates({ timeout: 0 }); // 2º leitor derruba o 1º
    await esperarAte(() => repo.estado("c1").ultimo_erro_codigo === "conflito" || dormir.pedidos.includes(5000));
    expect(dormir.pedidos).toContain(5000);
  });
  it("429 respeita retry_after + 1 s", async () => {
    falso.falhar("getUpdates", { status: 429, corpo: { ok: false, error_code: 429, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } } });
    const p = novo();
    p.iniciar();
    await esperarAte(() => dormir.pedidos.includes(4000));
    expect(dormir.pedidos).toContain(4000);
  });
  it("5xx e rede: backoff 1, 2, 4 s (jitter fixo em teste) e reset no sucesso", async () => {
    falso.falhar("getUpdates", { status: 502, vezes: 3 });
    const p = novo();
    p.iniciar();
    await esperarAte(() => dormir.pedidos.length >= 3);
    expect(dormir.pedidos.slice(0, 3)).toEqual([1000, 2000, 4000]);
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    falso.falhar("getUpdates", { cortar: true });
    falso.usuario(5).enviar("a");
    await esperarAte(() => dormir.pedidos.length >= 4);
    expect(dormir.pedidos[3]).toBe(1000); // resetou
  });
  it("suspender/retomar do sistema: aborta o voo, pausa sem requisições, espera 3 s, drena rápido e volta ao long poll (sem rajada)", async () => {
    const p = novo();
    p.iniciar();
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    p.suspender();
    await esperarAte(() => falso.getUpdatesAbertos() === 0);
    const antes = falso.chamadasDe("getUpdates").length;
    await new Promise((r) => setTimeout(r, 80));
    expect(falso.chamadasDe("getUpdates").length).toBe(antes);
    expect(p.estado()).toBe("pausado");
    falso.usuario(5).enviar("chegou dormindo");
    p.retomarSistema();
    await esperarAte(() => vistos.length === 1);
    expect(dormir.pedidos).toContain(3000);
    const tm = falso.chamadasDe("getUpdates").slice(antes).map((c) => c.corpo.timeout);
    expect(tm[0]).toBe(0);
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    expect(falso.chamadasDe("getUpdates").at(-1)?.corpo.timeout).toBe(30);
  });
  it("rede offline pausa e volta quando a rede volta", async () => {
    let on = false;
    const p = criarPoller({ api, repo, canal_id: "c1", processar: async () => {}, relogio, dormir, online: () => on, aoEstado: (e) => estados.push(e), travas });
    pollers.push(p);
    p.iniciar();
    await esperarAte(() => estados.includes("pausado"));
    expect(falso.chamadas).toHaveLength(0);
    on = true;
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    expect(p.estado()).toBe("ativo");
  });
  it("parar(): fecha o socket em <= 1 s, é idempotente e libera a trava; instância única por canal", async () => {
    const p = novo();
    p.iniciar();
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    expect(() => novo().iniciar()).toThrow("poller_ja_ativo");
    const t0 = Date.now();
    await p.parar();
    await p.parar();
    expect(Date.now() - t0).toBeLessThan(1000);
    await esperarAte(() => falso.socketsAbertos() === 0, 1000);
    expect(rede.emVoo()).toBe(0);
    expect(p.estado()).toBe("parado");
    const p2 = novo();
    p2.iniciar(); // trava liberada
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
  });
  it("pânico no MEIO do lote (auditoria M3): o resto do lote não é tratado nem marcado como visto", async () => {
    const tratados: number[] = [];
    let p: Poller | null = null;
    const proc = async (u: TgUpdate): Promise<void> => {
      tratados.push(u.update_id);
      if (tratados.length === 1) void p?.parar(); // `/parar` chega no primeiro update do lote (a entrada dispara o pânico sem aguardar, como no serviço)
    };
    p = novo({ processar: proc });
    p.iniciar();
    await esperarAte(() => falso.getUpdatesAbertos() === 1, 3000);
    // 3 updates ENFILEIRADOS enquanto o sistema dorme: voltam num ÚNICO lote (drenagem rápida)
    p.suspender();
    await esperarAte(() => falso.getUpdatesAbertos() === 0, 3000);
    const u = falso.usuario(7, { nome: "x" });
    u.enviar("/status");
    u.enviar("/status");
    u.enviar("/status");
    p.retomarSistema();
    await esperarAte(() => tratados.length >= 1, 3000);
    await new Promise((r) => setTimeout(r, 150));
    expect(tratados).toHaveLength(1);
    expect(vistos).toEqual([]);
    // o offset confirma SÓ o que foi tratado: os outros dois updates voltam no próximo poll (nada executa depois do pânico, nada se perde)
    expect(repo.estado("c1").proximo_offset).toBe((tratados[0] as number) + 1);
    expect(repo.updateVisto((tratados[0] as number) + 1)).toBe(false);
  });
  it("erro no handler de um update não trava a fila nem reprocessa em laço", async () => {
    const u = falso.usuario(5);
    let n = 0;
    const p = novo({ processar: async (x) => { n++; if (n === 1) throw new Error("boom"); vistos.push(x.update_id); } });
    p.iniciar();
    await esperarAte(() => falso.getUpdatesAbertos() === 1);
    u.enviar("a");
    u.enviar("b");
    await esperarAte(() => vistos.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(n).toBe(2);
  });
});
