import { describe, expect, it } from "vitest";
import { relogioFalso } from "../../../tests/fixtures/alertas/ajudas";
import { criarAutorizador, INATIVIDADE_MS } from "./autorizacao";
import { criarLimiteTaxa } from "./limite-taxa";
import { criarRepoTelegramMemoria, type AutorizadoRow } from "./repo";
import type { TgUpdate } from "./tipos";

const montar = () => {
  const relogio = relogioFalso();
  const repo = criarRepoTelegramMemoria();
  const avisos: Array<{ user_id: number; contagem: number }> = [];
  const aut: AutorizadoRow = { id: "a1", canal_id: "c1", user_id: 5, chat_id: 5, nome_exibicao: "Ana", modo_padrao: "aprovar", texto_livre: true, pin_hash: null, criado_em: new Date(relogio.agora()).toISOString(), ultimo_uso_em: new Date(relogio.agora()).toISOString(), expira_em: new Date(relogio.agora() + INATIVIDADE_MS).toISOString(), revogado_em: null };
  repo.gravarAutorizado(aut);
  const a = criarAutorizador({ repo, canal_id: "c1", relogio, aoDesconhecido: (i) => avisos.push(i) });
  return { relogio, repo, a, avisos };
};
const msg = (p: Record<string, unknown> = {}, from: Record<string, unknown> = {}, chat: Record<string, unknown> = {}): TgUpdate => ({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 5, type: "private", ...chat }, from: { id: 5, is_bot: false, first_name: "Ana", ...from }, text: "oi", ...p } as never });
const cb = (p: Record<string, unknown> = {}): TgUpdate => ({ update_id: 1, callback_query: { id: "x", from: { id: 5, is_bot: false }, message: { message_id: 1, date: 1, chat: { id: 5, type: "private" } }, data: "a:x", ...p } as never });

describe("autorização (T-20.25): tabela de updates", () => {
  it.each([
    ["autorizado, chat privado", msg(), true, null],
    ["autorizado muda username e nome (só o id vale)", msg({}, { first_name: "Outro Nome", username: "novo_nome" }), true, null],
    ["usuário diferente com o MESMO username", msg({}, { id: 6, username: "ana" }), false, "nao_autorizado"],
    ["mensagem encaminhada (forward_origin)", msg({ forward_origin: { type: "user" } }), false, "encaminhada"],
    ["encaminhada (forward_date legado)", msg({ forward_date: 1 }), false, "encaminhada"],
    ["via_bot", msg({ via_bot: { id: 9 } }), false, "via_bot"],
    ["sender_chat", msg({ sender_chat: { id: -1, type: "channel" } }), false, "sender_chat"],
    ["mesma user_id em GRUPO", msg({}, {}, { id: -100, type: "group" }), false, "grupo_ou_canal"],
    ["mesma user_id em supergrupo", msg({}, {}, { id: -100, type: "supergroup" }), false, "grupo_ou_canal"],
    ["mesma user_id em canal", msg({}, {}, { id: -100, type: "channel" }), false, "grupo_ou_canal"],
    ["mesma user_id em OUTRO chat privado", msg({}, {}, { id: 99 }), false, "chat_diferente"],
    ["remetente é bot", msg({}, { is_bot: true }), false, "remetente_bot"],
    ["sem remetente", msg({ from: undefined }), false, "sem_remetente"],
    ["mensagem editada", { update_id: 1, edited_message: msg().message } as TgUpdate, false, "editada"],
    ["channel_post / outros tipos", { update_id: 1, channel_post: {} } as TgUpdate, false, "tipo_nao_suportado"],
    ["callback do autorizado no chat privado", cb(), true, null],
    ["callback de outro usuário", cb({ from: { id: 6, is_bot: false } }), false, "nao_autorizado"],
    ["callback em grupo", cb({ message: { message_id: 1, date: 1, chat: { id: -100, type: "group" } } }), false, "grupo_ou_canal"],
    ["callback sem mensagem", cb({ message: undefined }), false, "sem_remetente"],
    ["callback em outro chat privado", cb({ message: { message_id: 1, date: 1, chat: { id: 99, type: "private" } } }), false, "chat_diferente"],
  ])("%s", (_n, u, ok, motivo) => {
    const { a } = montar();
    const r = a.autorizar(u);
    expect(r.ok).toBe(ok);
    if (!r.ok) expect(r.motivo).toBe(motivo);
  });
  it("revogado, expirado e bloqueado nunca autenticam", () => {
    const { a, repo, relogio } = montar();
    expect(a.autorizar(msg()).ok).toBe(true);
    repo.revogarAutorizado("a1", new Date(relogio.agora()).toISOString());
    expect(a.autorizar(msg())).toMatchObject({ ok: false, motivo: "revogado" });
    const m2 = montar();
    m2.relogio.avancar(INATIVIDADE_MS + 1);
    expect(m2.a.autorizar(msg())).toMatchObject({ ok: false, motivo: "expirado" });
    const m3 = montar();
    m3.a.bloquear(5);
    expect(m3.a.autorizar(msg())).toMatchObject({ ok: false, motivo: "bloqueado" });
    m3.a.desbloquear(5);
    expect(m3.a.autorizar(msg()).ok).toBe(true);
  });
  it("AB-30: validade DESLIZANTE: cada uso estende 30 dias; 29 dias de inatividade ainda vale; 31 não", () => {
    const { a, relogio, repo } = montar();
    relogio.avancar(29 * 86_400_000);
    expect(a.autorizar(msg()).ok).toBe(true);
    expect(Date.parse(repo.autorizadoPorId("a1")?.expira_em as string) - relogio.agora()).toBe(INATIVIDADE_MS);
    relogio.avancar(29 * 86_400_000);
    expect(a.autorizar(msg()).ok).toBe(true);
    relogio.avancar(31 * 86_400_000);
    expect(a.autorizar(msg()).ok).toBe(false);
  });
  it("desconhecido: contador SEM texto, aviso ao desktop no máx. 1 por hora, bloqueio descarta antes de tudo", () => {
    const { a, repo, relogio, avisos } = montar();
    for (let i = 0; i < 50; i++) a.autorizar(msg({ text: "segredo-que-nao-pode-ser-gravado" }, { id: 77 }));
    expect(avisos).toHaveLength(1);
    a.descarregar();
    expect(repo.naoAutorizado(77)).toMatchObject({ contagem: 50, bloqueado: false });
    expect(JSON.stringify(repo.listarNaoAutorizados())).not.toContain("segredo");
    relogio.avancar(3_600_001);
    a.autorizar(msg({}, { id: 77 }));
    expect(avisos).toHaveLength(2);
    a.bloquear(77);
    expect(a.autorizar(msg({}, { id: 77 })).ok).toBe(false);
    expect(repo.naoAutorizado(77)?.bloqueado).toBe(true);
  });
  it("flood: 20 000 mensagens de desconhecidos não gravam no banco por mensagem e custam < 0,05 ms cada", () => {
    const { a, repo } = montar();
    let escritas = 0;
    const orig = repo.gravarNaoAutorizado.bind(repo);
    repo.gravarNaoAutorizado = (r) => (escritas++, orig(r));
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) a.autorizar(msg({}, { id: 1000 + (i % 50) }));
    expect((performance.now() - t0) / 20_000).toBeLessThan(0.05);
    expect(escritas).toBe(0);
    a.descarregar();
    expect(escritas).toBe(50);
  });
});

describe("limite de taxa (T-20.25)", () => {
  it("token bucket: rajada de 5, 20/min; UMA mensagem 'devagar' por minuto; refil com o tempo", () => {
    const relogio = relogioFalso();
    const l = criarLimiteTaxa({ relogio });
    const r = Array.from({ length: 8 }, () => l.mensagem(5));
    expect(r.filter((x) => x.ok)).toHaveLength(5);
    expect(r.filter((x) => x.avisar)).toHaveLength(1);
    relogio.avancar(3000);
    expect(l.mensagem(5).ok).toBe(true);
    expect(l.mensagem(5).ok).toBe(false);
    relogio.avancar(61_000);
    expect(l.mensagem(5).ok).toBe(true);
    expect(l.mensagem(6).ok).toBe(true); // outro usuário tem balde próprio
  });
  it("/pedir: 3 por 10 min", () => {
    const relogio = relogioFalso();
    const l = criarLimiteTaxa({ relogio });
    expect([l.pedido(5), l.pedido(5), l.pedido(5), l.pedido(5)]).toEqual([true, true, true, false]);
    relogio.avancar(600_001);
    expect(l.pedido(5)).toBe(true);
    l.esquecer(5);
  });
});
