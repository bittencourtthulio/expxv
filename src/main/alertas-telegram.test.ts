// Ligação do Telegram no main contra o servidor FALSO (sem rede externa, sem bot real): carregamento lazy, assistente (token -> cofre), consentimento, pareamento pelo poller REAL,
// alerta de saída, pedido -> plano com botões -> aprovação -> Maestro (falso), pânico (0 sockets), retomada no reinício e varredura de sentinelas.
import { afterEach, describe, expect, it } from "vitest";
import { esperarAte } from "../../tests/fixtures/alertas/ajudas";
import { maestroFalso, type MaestroFalso } from "../../tests/fixtures/alertas/maestro-falso";
import { criarCard, montarMain, type MundoMain } from "../../tests/fixtures/alertas/mundo-main";
import { SK_ANT } from "../../tests/fixtures/alertas/sentinelas";
import { subirTelegramFalso, type TelegramFalso, type UsuarioFalso } from "../../tests/fixtures/alertas/telegram-falso";
import { limpar } from "../../tests/fixtures/dominio/ambiente";
import { ID_CANAL_TELEGRAM, nomeSegredoTokenTelegram } from "../compartilhado/alertas";
import { dormirReal } from "../nucleo/telegram/portas";

let f: TelegramFalso | null = null;
let m: MundoMain | null = null;
let maestro: MaestroFalso;
afterEach(async () => {
  m?.l.encerrar();
  await new Promise((r) => setTimeout(r, 20));
  await f?.fechar();
  f = null;
  m = null;
  limpar();
});

async function montar(rapido = false): Promise<{ f: TelegramFalso; m: MundoMain }> {
  f = await subirTelegramFalso({ escalaTempo: 100 });
  maestro = maestroFalso();
  m = montarMain({ telegramPorta: f.porta, maestro: () => maestro, vivo: true, ...(rapido ? { dormirTelegram: { dormir: (ms: number, sinal?: AbortSignal) => dormirReal.dormir(Math.min(ms, 5), sinal) } } : {}) });
  await m.l.iniciar();
  return { f, m };
}
/** consentimento como a UI faz: lê o texto vigente do ESTADO (versão + hash) e aceita. */
async function consentir(mm: MundoMain): Promise<void> {
  const est = await (await mm.l.telegram()).estado();
  await mm.l.canalConsentir(ID_CANAL_TELEGRAM, est.texto_consentimento.versao_texto, est.texto_consentimento.hash_texto);
}
async function parear(mm: MundoMain, ff: TelegramFalso, user_id = 5): Promise<UsuarioFalso> {
  const tg = await mm.l.telegram();
  const usuario = ff.usuario(user_id, { nome: `Pessoa ${user_id}`, username: `u${user_id}` });
  const r = tg.parearIniciar();
  expect(r.link).toMatch(/^https:\/\/t\.me\/.+\?start=[A-Z2-9]{10}$/);
  // o descarte inicial do poller (nada anterior ao pareamento é executado) termina antes de o usuário mandar o /start
  await esperarAte(() => ff.getUpdatesAbertos() === 1, 3000);
  usuario.enviar(`/start ${r.codigo.replace("-", "")}`);
  await esperarAte(() => mm.renderer.some((e) => e.canal === "telegram:pareamento" && (e.payload as { pedido?: unknown }).pedido !== undefined), 3000);
  const pedido = (mm.renderer.filter((e) => e.canal === "telegram:pareamento").map((e) => e.payload as { pedido?: { pedido_id: string } }).find((p) => p.pedido !== undefined) as { pedido: { pedido_id: string } }).pedido;
  const aut = await tg.parearDecidir(pedido.pedido_id, true);
  expect(aut).not.toBeNull();
  const cfg = await tg.autorizadoConfig({ id: (aut as { id: string }).id, patch: { workspaces: [{ workspace_id: mm.ws.id, modo: "aprovar", padrao: true }] } });
  expect(cfg.ok).toBe(true);
  return usuario;
}

describe("carregamento lazy e assistente (token só no cofre)", () => {
  it("nada de Telegram até o assistente: abrir o estado carrega o módulo mas NÃO abre socket nem poller", async () => {
    const { f: ff, m: mm } = await montar();
    expect(mm.l.telegramCarregado()).toBe(false);
    const est = await mm.l.telegramEstado();
    expect(mm.l.telegramCarregado()).toBe(true);
    expect(est).toMatchObject({ bot: null, token_mascarado: null, cofre_disponivel: true, poller: { estado: "parado", conflito: false }, pareamento: { estado: "inativo" } });
    expect(est.passos_botfather.length).toBeGreaterThan(4);
    expect(ff.conexoesTotais()).toBe(0);
  });
  it("token de formato errado NEM chega à rede; token válido: getMe por clique (sem consentimento prévio) e depois só mascarado", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    expect(await tg.tokenTestar("lixo")).toMatchObject({ ok: false, erro: "formato" });
    expect(ff.conexoesTotais()).toBe(0);
    const t = await tg.tokenTestar(ff.token);
    expect(t.ok).toBe(true);
    expect(t.bot?.username).toBeTruthy();
    expect(mm.cofre.valores.size).toBe(0); // testar NÃO salva
    const s = await tg.tokenSalvar(ff.token);
    expect(s).toMatchObject({ ok: true });
    expect(s.token_mascarado).not.toContain(ff.token);
    expect(mm.cofre.valores.get(nomeSegredoTokenTelegram(ID_CANAL_TELEGRAM))).toBe(ff.token);
    const est = await tg.estado();
    expect(est.token_mascarado).toBe(s.token_mascarado);
    expect(est.bot?.username).toBe(t.bot?.username);
    // sentinela: o token NÃO está em nenhuma tabela do banco nem em nenhum evento do renderer
    const tudo = JSON.stringify(mm.banco.consultar("SELECT name FROM sqlite_master WHERE type='table'").map((x) => mm.banco.consultar(`SELECT * FROM ${(x as { name: string }).name}`)));
    expect(tudo).not.toContain(ff.token);
    expect(JSON.stringify(mm.renderer)).not.toContain(ff.token);
    expect(mm.avisos.join(" ")).not.toContain(ff.token);
  });
  it("token inválido (401): erro nominal, nada salvo", async () => {
    const { f: ff, m: mm } = await montar();
    ff.invalidarToken();
    const tg = await mm.l.telegram();
    expect(await tg.tokenSalvar(ff.token)).toMatchObject({ ok: false, erro: "nao_autorizado" });
    expect(mm.cofre.valores.size).toBe(0);
  });
  it("webhook ativo: o token válido é guardado mesmo assim (para o passo 'Limpar webhook') e a UI recebe o aviso", async () => {
    const { f: ff, m: mm } = await montar();
    ff.definirWebhook("https://alguem.example/hook");
    const tg = await mm.l.telegram();
    const r = await tg.tokenSalvar(ff.token);
    expect(r).toMatchObject({ ok: false, erro: "webhook_ativo" });
    expect(r.token_mascarado).toBeTruthy();
    expect(mm.cofre.valores.has(nomeSegredoTokenTelegram(ID_CANAL_TELEGRAM))).toBe(true);
    expect((await tg.webhookLimpar()).ok).toBe(true);
    expect(ff.chamadasDe("deleteWebhook")).toHaveLength(1);
  });
  it("cofre indisponível: recusa com instrução e nada vai a arquivo", async () => {
    const { f: ff, m: mm } = await montar();
    mm.cofre.disponivel = false;
    const tg = await mm.l.telegram();
    expect(await tg.tokenSalvar(ff.token)).toMatchObject({ ok: false, erro: "cofre_indisponivel" });
    expect(ff.conexoesTotais()).toBe(0);
  });
});

describe("consentimento e saída", () => {
  it("sem consentimento: ligar saída recusa e nenhum socket abre; texto desatualizado é recusado; com consentimento e token liga", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await expect(mm.l.canalLigarSaida(ID_CANAL_TELEGRAM)).rejects.toThrow(/consentimento_ausente/);
    await tg.tokenSalvar(ff.token);
    await expect(mm.l.canalLigarSaida(ID_CANAL_TELEGRAM)).rejects.toThrow(/consentimento_ausente/);
    await expect(mm.l.canalConsentir(ID_CANAL_TELEGRAM, "tg-0", "0".repeat(64))).rejects.toThrow(/consent_texto_desatualizado/);
    await consentir(mm);
    const c = await mm.l.canalLigarSaida(ID_CANAL_TELEGRAM);
    expect(c).toMatchObject({ estado: "ativo", saida_ligada: true, consentimento: { versao_texto: "tg-1", host: "api.telegram.org" } });
    expect(ff.chamadasDe("sendMessage")).toHaveLength(0);
  });
  it("alerta -> regra do Telegram -> mensagem no chat do usuário pareado, com tempo/tokens/pontos; segredo plantado NÃO sai (sentinela)", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    mm.l.regraPreset("tarefas_do_telegram", ID_CANAL_TELEGRAM);
    await consentir(mm);
    await mm.l.canalLigarSaida(ID_CANAL_TELEGRAM);
    const usuario = await parear(mm, ff);
    ff.mensagens.length = 0;
    const c = criarCard(mm, { titulo: `Corrigir ${SK_ANT}` });
    mm.barramento.emitir("task.updated", { task_id: c.task_id, task_ref: c.task_ref, mission_id: c.mission_id, workspace_id: mm.ws.id, estado: "reivindicada", pane_id: c.pane_id });
    mm.barramento.emitir("pane.state_changed", { pane_id: c.pane_id, estado: "trabalhando" });
    mm.relogio.avancar(90_000);
    mm.barramento.emitir("task.updated", { task_id: c.task_id, task_ref: c.task_ref, mission_id: c.mission_id, workspace_id: mm.ws.id, estado: "entregue", pane_id: c.pane_id });
    await esperarAte(() => ff.mensagens.some((x) => x.chat_id === usuario.chat_id && /Concluída/.test(x.texto)), 4000);
    const msg = ff.mensagens.find((x) => /Concluída/.test(x.texto));
    expect(msg?.texto).toMatch(/T-1\.1/);
    expect(msg?.texto).toMatch(/Tempo de trabalho: 2 min/);
    expect(msg?.texto).toMatch(/Tokens: sem fonte/);
    expect(ff.mensagens.map((x) => x.texto).join("\n")).not.toContain("sk-ant");
    // `tarefa_iniciada` não está na regra "Tarefas, Missões e erros": só a conclusão saiu
    expect(ff.mensagens.some((x) => /Iniciada/.test(x.texto))).toBe(false);
  });
  it("teste de envio e desligar a saída cancela a fila", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    await mm.l.canalLigarSaida(ID_CANAL_TELEGRAM);
    const usuario = await parear(mm, ff);
    ff.mensagens.length = 0;
    const r = await mm.l.canalTesteEnvio(ID_CANAL_TELEGRAM);
    expect(r.ok).toBe(true);
    expect(ff.mensagens.some((x) => x.chat_id === usuario.chat_id)).toBe(true);
    expect(mm.l.canalDesligarSaida(ID_CANAL_TELEGRAM)).toMatchObject({ saida_ligada: false, estado: "desligado" });
  });
});

describe("envio avulso para a divulgação da Fase 19 (canalEnviarTexto)", () => {
  it("sem consentimento/saída desligada: recusa sem I/O; pronto: o mesmo adaptador entrega ao chat pareado", async () => {
    const { f: ff, m: mm } = await montar();
    expect(mm.l.canalSaidaPronta(ID_CANAL_TELEGRAM)).toBe(false);
    expect(await mm.l.canalEnviarTexto(ID_CANAL_TELEGRAM, "t", "x")).toEqual({ ok: false, erro: "desligado" });
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    expect(await mm.l.canalEnviarTexto(ID_CANAL_TELEGRAM, "t", "x")).toEqual({ ok: false, erro: "desligado" }); // consentiu, mas a saída continua desligada
    await mm.l.canalLigarSaida(ID_CANAL_TELEGRAM);
    const usuario = await parear(mm, ff);
    expect(mm.l.canalSaidaPronta(ID_CANAL_TELEGRAM)).toBe(true);
    ff.mensagens.length = 0;
    const r = await mm.l.canalEnviarTexto(ID_CANAL_TELEGRAM, "Sprint 3", "Entregamos 8 itens na versão 1.2.");
    expect(r).toEqual({ ok: true, erro: null });
    expect(ff.mensagens.some((x) => x.chat_id === usuario.chat_id && /Entregamos 8 itens/.test(x.texto))).toBe(true);
    expect(await mm.l.canalEnviarTexto("canal_inexistente", "t", "x")).toEqual({ ok: false, erro: "canal inexistente" });
    mm.l.canalDesligarSaida(ID_CANAL_TELEGRAM);
    expect(mm.l.canalSaidaPronta(ID_CANAL_TELEGRAM)).toBe(false);
    ff.mensagens.length = 0;
    expect((await mm.l.canalEnviarTexto(ID_CANAL_TELEGRAM, "t", "não deve sair")).ok).toBe(false);
    expect(ff.mensagens).toHaveLength(0);
  });
});

describe("pareamento (poller real só durante a janela), entrada e aprovação", () => {
  it("o poller liga SÓ para receber o /start e para depois de pareado (sem entrada ligada não há polling)", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await expect(Promise.resolve().then(() => tg.parearIniciar())).rejects.toThrow(/consentimento_ausente/);
    await consentir(mm);
    await parear(mm, ff);
    await esperarAte(() => ff.getUpdatesAbertos() === 0 && ff.socketsAbertos() === 0, 2000);
    expect(tg.servico.poller.ativo()).toBe(false);
    const est = await tg.estado();
    expect(est.autorizados).toHaveLength(1);
    expect(est.autorizados[0]?.workspaces).toEqual([{ workspace_id: mm.ws.id, modo: "aprovar", padrao: true }]);
  });
  it("/pedir -> plano com [Aprovar][Editar][Cancelar] -> Aprovar -> Maestro confirma UMA vez, a Missão volta no chat; duplo toque não duplica", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    const usuario = await parear(mm, ff);
    expect((await tg.entradaLigar(true)).ok).toBe(true);
    await esperarAte(() => ff.getUpdatesAbertos() === 1, 2000);
    ff.mensagens.length = 0;
    usuario.enviar("/pedir corrige o bug do login no app");
    await esperarAte(() => ff.mensagens.some((x) => x.teclado !== null), 4000);
    const plano = ff.mensagens.find((x) => x.teclado !== null)!;
    expect(plano.texto).toMatch(/Plano proposto/);
    expect(plano.teclado?.flat().map((b) => b.text)).toEqual(["Aprovar", "Editar", "Cancelar"]);
    expect(maestro.pedidos[0]).toMatchObject({ via: "telegram", workspace_id: mm.ws.id });
    expect(maestro.confirmados).toEqual([]); // nada executa antes do toque
    usuario.tocar(plano, "Aprovar");
    usuario.tocar(plano, "Aprovar");
    await esperarAte(() => maestro.confirmados.length >= 1, 4000);
    await new Promise((r) => setTimeout(r, 150));
    expect(maestro.confirmados).toHaveLength(1);
    // regra efêmera de acompanhamento ligou a Missão a ESTE chat
    expect(mm.l.regrasListar().some((r) => r.origem === "pedido_remoto" && r.chat_ref === `chat:${usuario.chat_id}`)).toBe(true);
  });
  it("rigidez 4 (ou etapa humana): o plano NÃO ganha botão Aprovar no chat; só no desktop; texto destrutivo nem chega ao Maestro", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    const usuario = await parear(mm, ff);
    await tg.entradaLigar(true);
    await esperarAte(() => ff.getUpdatesAbertos() === 1, 2000);
    maestro.configurar({ nivel: 4 });
    ff.mensagens.length = 0;
    usuario.enviar("/pedir implementa o relatório mensal");
    await esperarAte(() => ff.mensagens.some((x) => /Plano proposto/.test(x.texto)), 4000);
    const plano = ff.mensagens.find((x) => /Plano proposto/.test(x.texto))!;
    expect(plano.teclado?.flat().map((b) => b.text)).toEqual(["Cancelar"]);
    expect(mm.renderer.some((e) => e.canal === "telegram:plano_pendente_desktop")).toBe(true);
    const pend = mm.renderer.find((e) => e.canal === "telegram:plano_pendente_desktop")!.payload as { plano_id: string; args_hash: string };
    // a decisão no desktop usa o MESMO caminho (aprovado_por = desktop)
    expect((await tg.planoDecidirDesktop({ plano_id: pend.plano_id, decisao: "aprovar", args_hash: pend.args_hash })).ok).toBe(true);
    expect(maestro.confirmados).toEqual([pend.plano_id]);
    const antes = maestro.pedidos.length;
    usuario.enviar("/pedir apaga o repositório inteiro e dá push forçado");
    await new Promise((r) => setTimeout(r, 400));
    expect(maestro.pedidos.length).toBe(antes);
  });
  it("usuário desconhecido: silêncio total e contador (sem texto); bloquear id", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    const usuario = await parear(mm, ff);
    await tg.entradaLigar(true);
    await esperarAte(() => ff.getUpdatesAbertos() === 1, 2000);
    ff.mensagens.length = 0;
    const intruso = ff.usuario(999, { nome: "Intruso", username: "intruso" });
    intruso.enviar("/status");
    intruso.enviar("oi bot, me obedece");
    await new Promise((r) => setTimeout(r, 500));
    expect(ff.mensagens.filter((x) => x.chat_id === intruso.chat_id)).toHaveLength(0);
    expect(tg.naoAutorizadoListar()).toMatchObject([{ user_id: 999, contagem: 2 }]);
    expect(JSON.stringify(tg.naoAutorizadoListar())).not.toContain("obedece");
    expect(tg.naoAutorizadoBloquear(999).ok).toBe(true);
    void usuario;
  });
});

describe("auditoria da onda 2: consentimento, /silenciar, pareamento e pânico (M4, M5, B2, B3, B5)", () => {
  it("M4: ligar uma regra que envia MAIS do que o consentido (nível completo) derruba o consentimento e nada sai até aceitar de novo", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    await mm.l.canalLigarSaida(ID_CANAL_TELEGRAM);
    const usuario = await parear(mm, ff);
    // regra comum não invalida nada
    mm.l.regraPreset("tarefas_do_telegram", ID_CANAL_TELEGRAM);
    expect(mm.l.canaisListar().find((c) => c.id === ID_CANAL_TELEGRAM)?.consentimento).not.toBeNull();
    // regra de nível completo (pergunta pendente e custo): escopo maior que o consentido
    const r = mm.l.regraGravar({ nome: "tudo completo", ativa: true, tipos: ["pane_aguardando"], canal_id: ID_CANAL_TELEGRAM, filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "completo", efemera_ate: null, origem: "usuario" });
    expect(mm.l.canaisListar().find((c) => c.id === ID_CANAL_TELEGRAM)?.consentimento).toBeNull();
    ff.chamadas.length = 0;
    mm.l.emitir({ tipo: "pane_aguardando", titulo: "x", dados: { cli: "claude", pergunta: "posso apagar?" }, estado: "a1" });
    await new Promise((res) => setTimeout(res, 300));
    expect(ff.chamadasDe("sendMessage")).toHaveLength(0);
    // aceitar de novo (texto novo = hash novo) volta a entregar
    const est = await tg.estado();
    expect(est.texto_consentimento.itens.some((i) => /nível completo/.test(i))).toBe(true);
    await mm.l.canalConsentir(ID_CANAL_TELEGRAM, est.texto_consentimento.versao_texto, est.texto_consentimento.hash_texto);
    mm.l.emitir({ tipo: "pane_aguardando", titulo: "y", dados: { cli: "claude", pergunta: "posso apagar?" }, estado: "a2" });
    await esperarAte(() => ff.mensagens.some((x) => x.chat_id === usuario.chat_id && /Aguardando você/.test(x.texto)), 4000);
    // apagar a regra completa NÃO exige novo consentimento para voltar ao padrão
    expect(mm.l.regraApagar(r.id).ok).toBe(true);
  });
  it("B5: `/silenciar tudo 2h` silencia INCLUSIVE os críticos neste chat; `/silenciar off` volta", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    mm.l.regraPreset("tarefas_do_telegram", ID_CANAL_TELEGRAM);
    await consentir(mm);
    await mm.l.canalLigarSaida(ID_CANAL_TELEGRAM);
    const usuario = await parear(mm, ff);
    await tg.entradaLigar(true);
    await esperarAte(() => ff.getUpdatesAbertos() === 1, 2000);
    usuario.enviar("/silenciar tudo 2h");
    await esperarAte(() => ff.mensagens.some((x) => /silenci/i.test(x.texto)), 4000);
    ff.chamadas.length = 0;
    mm.l.emitir({ tipo: "erro_sistema", titulo: "crítico durante o silêncio", dados: { componente: "x", codigo: "y" }, estado: "s1" });
    await new Promise((res) => setTimeout(res, 300));
    expect(ff.chamadasDe("sendMessage")).toHaveLength(0);
    usuario.enviar("/silenciar off");
    await esperarAte(() => ff.chamadasDe("sendMessage").length >= 1, 4000);
  });
  it("B2: com a janela de pareamento aberta o poller SÓ aceita /start <código>: /pedir e consultas de um autorizado antigo são ignorados", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    const dono = await parear(mm, ff, 5);
    await esperarAte(() => ff.getUpdatesAbertos() === 0, 3000);
    const antes = maestro.pedidos.length;
    tg.parearIniciar(); // 2ª janela (novo pareamento) com o poller só por ela
    await esperarAte(() => ff.getUpdatesAbertos() === 1, 3000);
    ff.chamadas.length = 0;
    dono.enviar("/pedir corrige o bug do login");
    dono.enviar("/status");
    await new Promise((res) => setTimeout(res, 400));
    expect(maestro.pedidos.length).toBe(antes);
    expect(ff.chamadasDe("sendMessage")).toHaveLength(0);
    tg.parearCancelar();
    await esperarAte(() => ff.getUpdatesAbertos() === 0 && ff.socketsAbertos() === 0, 3000);
  });
  it("B3: se o pânico completo falhar (módulo do Telegram não carrega), a bandeja AINDA desliga entrada e saída direto no banco", async () => {
    f = await subirTelegramFalso({ escalaTempo: 100 });
    m = montarMain({ telegramPorta: f.porta, vivo: true, carregarTelegram: async () => { throw new Error("falha ao carregar"); } });
    await m.l.iniciar();
    m.banco.executar("UPDATE canal SET estado = 'ativo', saida_ligada = 1, entrada_ligada = 1 WHERE id = ?", [ID_CANAL_TELEGRAM]);
    const r = await m.l.panicoTelegram(true);
    expect(r).toEqual({ ok: true, completo: false });
    expect(m.l.canaisListar().find((c) => c.id === ID_CANAL_TELEGRAM)).toMatchObject({ estado: "desligado", saida_ligada: false, entrada_ligada: false });
    expect(m.avisos.join(" ")).toContain("pânico completo falhou");
  });
});

describe("pânico, conflito e reinício", () => {
  it("pânico: 0 sockets em <= 1 s, canal desligado, todos revogados, host fora da allowlist, e a saída para de enviar", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    mm.l.regraPreset("tarefas_do_telegram", ID_CANAL_TELEGRAM);
    await consentir(mm);
    await mm.l.canalLigarSaida(ID_CANAL_TELEGRAM);
    await parear(mm, ff);
    await tg.entradaLigar(true);
    await esperarAte(() => ff.getUpdatesAbertos() === 1, 2000);
    const t0 = Date.now();
    const r = await tg.panico(true);
    expect(r).toMatchObject({ ok: true, revogados: 1 });
    await esperarAte(() => ff.socketsAbertos() === 0 && ff.getUpdatesAbertos() === 0, 1000);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(mm.l.canaisListar().find((c) => c.id === ID_CANAL_TELEGRAM)).toMatchObject({ estado: "desligado", saida_ligada: false, entrada_ligada: false });
    expect(mm.consentimento.hostPermitido("api.telegram.org")).toBe(false);
    expect((await tg.estado()).autorizados).toEqual([]);
    ff.mensagens.length = 0;
    ff.chamadas.length = 0;
    mm.l.emitir({ tipo: "erro_sistema", titulo: "falha", dados: { componente: "x", codigo: "y" }, estado: "pos-panico" });
    await new Promise((r2) => setTimeout(r2, 300));
    expect(ff.chamadasDe("sendMessage")).toHaveLength(0);
  });
  it("409 (outro poller): para, estado conflito + alerta crítico no app, não retoma sozinho; [Retomar] volta", async () => {
    const { f: ff, m: mm } = await montar(true);
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    await parear(mm, ff);
    ff.falhar("getUpdates", { status: 409, corpo: { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" }, vezes: 40 });
    await tg.entradaLigar(true);
    await esperarAte(() => tg.servico.poller.estado() === "conflito", 15_000);
    expect(mm.l.canaisListar().find((c) => c.id === ID_CANAL_TELEGRAM)?.estado).toBe("conflito");
    expect(mm.l.listar({ depois_id: null, limite: 20 }).itens.some((a) => a.tipo === "canal_erro" && a.severidade === "critico")).toBe(true);
  }, 20_000);
  it("reinício: entrada ligada + consentimento + token + autorizado retomam o poller na onda 2; sem consentimento não retoma", async () => {
    const { f: ff, m: mm } = await montar();
    const tg = await mm.l.telegram();
    await tg.tokenSalvar(ff.token);
    await consentir(mm);
    await parear(mm, ff);
    await tg.entradaLigar(true);
    await esperarAte(() => ff.getUpdatesAbertos() === 1, 2000);
    mm.l.encerrar();
    await esperarAte(() => ff.getUpdatesAbertos() === 0, 2000);
    // "reabre o app": mesmo banco e cofre, serviço novo
    const m2 = montarMain({ vivo: true, banco: mm.banco, config: mm.repos.config, telegramPorta: ff.porta, maestro: () => maestro, cofre: async () => mm.cofre });
    await m2.l.iniciar();
    await esperarAte(() => ff.getUpdatesAbertos() === 1, 3000);
    m2.l.encerrar();
    await esperarAte(() => ff.getUpdatesAbertos() === 0, 2000);
    // M5: estado `conflito` persistido => o reinício NÃO religa sozinho (exige [Retomar])
    mm.banco.executar("UPDATE canal SET estado = 'conflito' WHERE id = ?", [ID_CANAL_TELEGRAM]);
    const m2b = montarMain({ vivo: true, banco: mm.banco, config: mm.repos.config, telegramPorta: ff.porta, maestro: () => maestro, cofre: async () => mm.cofre });
    await m2b.l.iniciar();
    await new Promise((r) => setTimeout(r, 400));
    expect(ff.getUpdatesAbertos()).toBe(0);
    m2b.l.encerrar();
    mm.banco.executar("UPDATE canal SET estado = 'ativo' WHERE id = ?", [ID_CANAL_TELEGRAM]);
    // sem consentimento vigente: não retoma
    mm.banco.executar("UPDATE canal SET consentimento_json = NULL WHERE id = ?", [ID_CANAL_TELEGRAM]);
    const m3 = montarMain({ vivo: true, banco: mm.banco, config: mm.repos.config, telegramPorta: ff.porta, maestro: () => maestro, cofre: async () => mm.cofre });
    await m3.l.iniciar();
    await new Promise((r) => setTimeout(r, 300));
    expect(ff.getUpdatesAbertos()).toBe(0);
    expect(m3.l.telegramCarregado()).toBe(false);
    m3.l.encerrar();
  }, 20_000);
});
