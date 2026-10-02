// Alerta -> regra -> entregador -> canal Telegram -> servidor FALSO (T-20.14/22 + P-144 + AB-12): ponta a ponta do núcleo, sem Electron.
import { afterEach, describe, expect, it } from "vitest";
import { barramentoFalso, idSeq, relogioFalso, timersFalsos } from "../../../tests/fixtures/alertas/ajudas";
import { criarRedeDeTeste } from "../../../tests/fixtures/alertas/rede-teste";
import { SK_ANT, TODAS_SENTINELAS } from "../../../tests/fixtures/alertas/sentinelas";
import { subirTelegramFalso, type TelegramFalso } from "../../../tests/fixtures/alertas/telegram-falso";
import type { CanalRegistro, Regra } from "../../compartilhado/alertas";
import { criarEntregador } from "../alertas/entregador";
import { criarRepoAlertasMemoria, criarRepoCanaisMemoria, criarRepoEntregasMemoria, criarRepoRegrasMemoria } from "../alertas/memoria";
import { criarServicoAlertas } from "../alertas/servico";
import { criarCanalTelegram } from "./adaptador";
import { criarClienteBotApi } from "./api";
import { criarRepoTelegramMemoria } from "./repo";

const consent = { versao_texto: "tg-1", hash_texto: "h", aceito_em: "2026-09-30T00:00:00Z", host: "api.telegram.org", itens_enviados: [] };
let falso: TelegramFalso;
afterEach(async () => {
  await falso?.fechar();
});

async function montar(o: { consentimento?: boolean; regras?: Regra[]; canal?: Partial<CanalRegistro> } = {}) {
  falso = await subirTelegramFalso({ escalaTempo: 100, limitePorSegundo: 0 });
  const relogio = relogioFalso();
  const timers = timersFalsos(relogio);
  const barramento = barramentoFalso();
  const repo = criarRepoAlertasMemoria();
  const entregas = criarRepoEntregasMemoria();
  const canal: CanalRegistro = { id: "c1", tipo: "telegram", nome: "tg", estado: "ativo", saida_ligada: true, entrada_ligada: false, consentimento: o.consentimento === false ? null : consent, silenciado_ate: null, erro_codigo: null, ...o.canal };
  const canais = criarRepoCanaisMemoria([canal]);
  const regra: Regra = { id: "r1", nome: "tudo", ativa: true, tipos: ["*"], canal_id: "c1", filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "minimo", efemera_ate: null, origem: "usuario" };
  const regras = criarRepoRegrasMemoria(o.regras ?? [regra]);
  const tg = criarRepoTelegramMemoria();
  tg.gravarAutorizado({ id: "a5", canal_id: "c1", user_id: 5, chat_id: 5, nome_exibicao: "x", modo_padrao: "aprovar", texto_livre: true, pin_hash: null, criado_em: "x", ultimo_uso_em: "x", expira_em: new Date(relogio.agora() + 1e10).toISOString(), revogado_em: null });
  falso.usuario(5).enviar("oi");
  const api = criarClienteBotApi({ rede: criarRedeDeTeste(), token: () => falso.token, consentimentoValido: () => canal.consentimento !== null, host: "127.0.0.1", porta: falso.porta });
  const adaptador = criarCanalTelegram({ api, repo: tg, canal_id: "c1", relogio, consentimentoValido: () => (canais.obter("c1")?.consentimento ?? null) !== null, estadoCanal: () => "ativo", dormir: { dormir: async () => undefined } });
  const entregador = criarEntregador({ entregas, alertas: repo, canais, obterAdaptador: async () => adaptador, versaoConsentimento: () => "tg-1", barramento, relogio, timers });
  const servico = criarServicoAlertas({ repo, entregas, regras, canais, barramento, relogio, novoId: idSeq("s") });
  const rodar = async (ms: number, passo = 1000): Promise<void> => {
    const fim = relogio.agora() + ms;
    while (relogio.agora() < fim) {
      timers.avancarAte(Math.min(fim, relogio.agora() + passo));
      await new Promise((r) => setTimeout(r, 15)); // deixa terminar o envio HTTP iniciado pelo timer
      await entregador.drenar();
    }
  };
  return { relogio, timers, repo, entregas, canais, regras, servico, entregador, rodar, barramento };
}
const ev = (n: number, extra: Record<string, unknown> = {}) => ({ tipo: "tarefa_concluida" as const, entidade_tipo: "task", entidade_id: `T-${n}`, titulo: `Tarefa ${n}`, estado: "concluida", dados: { task_id: `T-${n}`, tempo_trabalho_ms: 4_320_000, tokens: 182_340, story_points: 3, missao: "Login" }, ...extra });

describe("alerta de tarefa concluída chega ao chat falso (caso 1 do plano)", () => {
  it("com tempo de trabalho, tokens e story points, em HTML escapado; sem segredo; token só no caminho", async () => {
    const m = await montar();
    m.servico.emitir(ev(1, { titulo: "<b>x</b> & <script>" }));
    await m.entregador.drenar();
    const msg = falso.mensagens.at(-1);
    expect(msg?.html).toContain("<b>[Concluída]</b> <code>T-1</code> &lt;b&gt;x&lt;/b&gt; &amp; &lt;script&gt;");
    expect(msg?.html).toContain("Tempo de trabalho: 1 h 12 · Tokens: 182.340 · Pontos: 3");
    expect(msg?.texto).toContain("<b>x</b> & <script>"); // texto VISÍVEL: o que foi digitado, sem virar marca
    expect(falso.ondeTokenApareceu()).toMatchObject({ corpo: 0, cabecalhos: 0 });
    expect(falso.chamadasDe("sendMessage")[0]?.corpo.link_preview_options).toEqual({ is_disabled: true });
  });
  it("tokens sem fonte => 'sem fonte' e sem story points => 'sem estimativa' (nunca zero)", async () => {
    const m = await montar();
    m.servico.emitir(ev(2, { dados: { task_id: "T-2", tempo_trabalho_ms: 60_000, tokens: null, story_points: null } }));
    await m.entregador.drenar();
    expect(falso.mensagens.at(-1)?.html).toContain("Tokens: sem fonte · Pontos: sem estimativa");
  });
  it("AB-12: segredo plantado em título, dados e pergunta NÃO chega ao servidor (sentinelas)", async () => {
    const m = await montar({ regras: [{ id: "r1", nome: "t", ativa: true, tipos: ["*"], canal_id: "c1", filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "completo", efemera_ate: null, origem: "usuario" }] });
    let i = 0;
    for (const s of TODAS_SENTINELAS) {
      m.servico.emitir({ tipo: "pane_aguardando", entidade_tipo: "pane", entidade_id: `p${i++}`, titulo: `falha ${s} no deploy`, dados: { pergunta: `use ${s}`, cli: s, missao: s, espera_ms: 600_000 }, estado: `s${i}` });
      await m.rodar(1500, 500);
    }
    const tudo = JSON.stringify(falso.mensagens) + JSON.stringify(falso.chamadas.map((c) => c.corpo));
    for (const s of TODAS_SENTINELAS) expect(tudo, s.slice(0, 12)).not.toContain(s);
    expect(tudo).not.toContain(SK_ANT.slice(0, 20));
    expect(falso.mensagens.length).toBe(TODAS_SENTINELAS.length);
  });
});

describe("rajada e taxa (P-144, caso 6)", () => {
  it("100 alertas em rajada => <= 20 mensagens no 1º minuto e 0 alertas perdidos (viram resumo)", async () => {
    const m = await montar();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const a = m.servico.emitir(ev(i, { tipo: i % 3 === 0 ? "tarefa_iniciada" : i % 3 === 1 ? "tarefa_concluida" : "tarefa_bloqueada" }));
      if (a !== null) ids.add(a.id);
    }
    await m.rodar(60_000, 500);
    expect(falso.mensagens.length).toBeLessThanOrEqual(20);
    expect(falso.mensagens.length).toBeGreaterThan(0);
    const cobertos = new Set(m.entregas.porEstado("enviado", 500).map((e) => e.alerta_id));
    for (const id of ids) expect(cobertos.has(id), id).toBe(true);
    expect(m.entregas.porEstado("pendente", 500)).toHaveLength(0);
    expect(falso.mensagens.some((x) => /\d+ alertas:/.test(x.texto))).toBe(true);
    for (let i = 1; i < falso.chamadasDe("sendMessage").length; i++) expect(falso.chamadasDe("sendMessage")[i]!.em - falso.chamadasDe("sendMessage")[i - 1]!.em).toBeGreaterThanOrEqual(0);
  });
  it("espaçamento >= 1 100 ms entre mensagens para o mesmo chat (relógio injetado)", async () => {
    const m = await montar();
    for (let i = 0; i < 3; i++) m.servico.emitir(ev(i));
    const marcas: number[] = [];
    const original = falso.chamadasDe;
    void original;
    for (let t = 0; t < 8; t++) {
      const antes = falso.chamadasDe("sendMessage").length;
      await m.rodar(400, 400);
      if (falso.chamadasDe("sendMessage").length > antes) marcas.push(m.relogio.agora());
    }
    expect(falso.mensagens).toHaveLength(3);
    for (let i = 1; i < marcas.length; i++) expect(marcas[i]! - marcas[i - 1]!).toBeGreaterThanOrEqual(1100 - 400);
  });
  it("429 do servidor é respeitado sem laço e a mensagem sai depois", async () => {
    const m = await montar();
    falso.falhar("sendMessage", { status: 429, corpo: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 5 } } });
    m.servico.emitir(ev(1));
    await m.entregador.drenar();
    expect(falso.chamadasDe("sendMessage")).toHaveLength(1);
    await m.rodar(3000, 500);
    expect(falso.chamadasDe("sendMessage")).toHaveLength(1); // ainda dentro do retry_after + 1 s
    await m.rodar(4000, 500);
    expect(falso.mensagens).toHaveLength(1);
  });
});

describe("consentimento, silêncio e canal (casos 7, 14)", () => {
  it("sem consentimento => 0 conexões para o falso, nada enviado; mudar a versão do texto invalida", async () => {
    const m = await montar({ consentimento: false });
    m.servico.emitir(ev(1));
    await m.entregador.drenar();
    expect(falso.conexoesTotais()).toBe(0);
    expect(m.entregas.porEstado("pendente", 10)).toHaveLength(0); // nem entrega foi criada: regra de canal sem consentimento não casa
    const n = await montar();
    n.canais.gravar({ ...(n.canais.obter("c1") as CanalRegistro), consentimento: { ...consent, versao_texto: "tg-0" } });
    n.servico.emitir(ev(1));
    await n.entregador.drenar();
    expect(falso.conexoesTotais()).toBe(0);
  });
  it("silêncio 22:00-07:00: nada vai ao Telegram; ao fim UM resumo; crítico atravessa", async () => {
    const m = await montar({ regras: [{ id: "r1", nome: "t", ativa: true, tipos: ["*"], canal_id: "c1", filtros: {}, silencio: { inicio: "00:00", fim: "23:59", dias: [0, 1, 2, 3, 4, 5, 6] }, agrupamento: { modo: "imediato" }, nivel: "minimo", efemera_ate: null, origem: "usuario" }] });
    // janela cobrindo quase todo o dia: o relógio falso (12:00 UTC) cai dentro em qualquer fuso razoável
    for (let i = 0; i < 4; i++) m.servico.emitir(ev(i));
    await m.rodar(30_000, 1000);
    expect(falso.mensagens).toHaveLength(0);
    m.servico.emitir(ev(99, { severidade: "critico", tipo: "missao_falhou", dados: { missao: "Login", motivo: "x" }, estado: "falhou" }));
    await m.rodar(3000, 500);
    expect(falso.mensagens).toHaveLength(1);
    expect(falso.mensagens[0]?.texto).toContain("Missão falhou");
    // o fim da janela libera UM resumo (as 4 entregas agrupadas viram uma mensagem)
    await m.rodar(25 * 3_600_000, 3_600_000);
    expect(falso.mensagens.length).toBe(2);
    expect(falso.mensagens[1]?.texto).toContain("4 alertas");
  });
  it("401 do servidor (token rotacionado): entrega falha, canal avisado, sem laço", async () => {
    const m = await montar();
    falso.invalidarToken();
    m.servico.emitir(ev(1));
    m.servico.emitir(ev(2));
    await m.rodar(120_000, 2000);
    expect(falso.chamadasDe("sendMessage").length).toBeLessThanOrEqual(2);
    expect(m.entregas.porEstado("pendente", 10)).toHaveLength(0);
    expect(m.entregas.porEstado("falhou", 10).length + m.entregas.porEstado("descartado", 10).length).toBe(2);
  });
});
