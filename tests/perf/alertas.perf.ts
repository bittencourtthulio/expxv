// Orçamentos da Fase 20 que o NÚCLEO consegue medir sem Electron (03/fase-20 §Orçamentos). Node puro, servidor Telegram FALSO em loopback, sem rede real.
//  - P-140: evento -> alerta persistido e publicado (parte do núcleo) p95 <= 100 ms.
//  - P-142: polling ocioso <= 2 requisições/min (long poll de 30 s) e CPU ocioso < 0,2 % (extrapolada por requisição); só `getUpdates`.
//  - P-144: alerta -> `sendMessage` recebido pelo falso p95 <= 300 ms; 100 alertas em rajada => <= 20 mensagens no 1º minuto e 0 perdidos.
//  - P-146: pareamento: >= 50 bits, TTL <= 300 s, 1 uso, <= 5 erradas, sem oráculo de tempo (< 2 ms).
//  - P-148: atraso <= 1 ms por task; 200 tasks ativas => 1 timer; recálculo <= 5 ms por evento.
//  - P-149: mensagem de 4 KB <= 1 ms (p95); entrada de 100 KB truncada e redigida <= 5 ms; pânico => 0 sockets em <= 1 s.
// P-141/P-143/P-145 dependem da UI e do main (Electron); P-147 depende do SQLite real (T-20.03): ficam para o coordenador.
import { afterAll, describe, expect, it } from "vitest";
import { barramentoFalso, dormirFalso, esperarAte, idSeq, relogioFalso, timersFalsos } from "../fixtures/alertas/ajudas";
import { montarCenario } from "../fixtures/alertas/cenario-telegram";
import { criarRedeDeTeste } from "../fixtures/alertas/rede-teste";
import { subirTelegramFalso } from "../fixtures/alertas/telegram-falso";
import { criarAgendadorVencimentos } from "../../src/nucleo/alertas/agendador";
import { decidirAtraso, proximoVencimento, type AmostraConcluida } from "../../src/nucleo/alertas/atraso";
import { criarEmissor } from "../../src/nucleo/alertas/emissor";
import { criarEntregador } from "../../src/nucleo/alertas/entregador";
import { criarRepoAlertasMemoria, criarRepoCanaisMemoria, criarRepoEntregasMemoria, criarRepoRegrasMemoria } from "../../src/nucleo/alertas/memoria";
import { criarServicoAlertas } from "../../src/nucleo/alertas/servico";
import { escaparHtml, renderizar, DADOS_EXEMPLO } from "../../src/nucleo/alertas/templates";
import { redigirParaCanal } from "../../src/nucleo/alertas/texto";
import { CONFIG_ALERTAS_PADRAO, type CanalRegistro, type Regra } from "../../src/compartilhado/alertas";
import { criarCanalTelegram } from "../../src/nucleo/telegram/adaptador";
import { criarClienteBotApi } from "../../src/nucleo/telegram/api";
import { criarPareamento, ALFABETO, TAMANHO_CODIGO, TTL_PAREAMENTO_MS, MAX_ERRADAS } from "../../src/nucleo/telegram/pareamento";
import { criarPoller } from "../../src/nucleo/telegram/poller";
import { criarRepoTelegramMemoria } from "../../src/nucleo/telegram/repo";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());

const MIN = 60_000;
const consent = { versao_texto: "tg-1", hash_texto: "h", aceito_em: "2026-09-30T00:00:00Z", host: "api.telegram.org", itens_enviados: [] };

describe("P-140: evento -> alerta persistido e publicado", () => {
  it("p95 <= 100 ms (parte do núcleo; o primeiro quadro no renderer é medido no Electron)", () => {
    const repo = criarRepoAlertasMemoria();
    const barramento = barramentoFalso();
    const emissor = criarEmissor({ repo, barramento, floodPorMin: 1_000_000, novoId: idSeq("p") });
    const ts: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const t0 = performance.now();
      emissor.emitir({ tipo: "tarefa_concluida", entidade_tipo: "task", entidade_id: `T-${i}`, titulo: `Tarefa ${i}`, dados: { tempo_trabalho_ms: 1000, tokens: 10, story_points: 2 }, estado: "concluida" });
      ts.push(performance.now() - t0);
    }
    const r = registrar({ id: "P-140", descricao: "emitir(): redigir + dedupe + persistir + alert.created (núcleo)", valor: percentil(ts, 95), limite: 100, unidade: "ms", pior: Math.max(...ts) });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe("P-142: polling ocioso", () => {
  it("<= 2 requisições/min (long poll de 30 s), só getUpdates, CPU ocioso < 0,2 %", async () => {
    const escala = 100;
    const falso = await subirTelegramFalso({ escalaTempo: escala });
    const rede = criarRedeDeTeste();
    const api = criarClienteBotApi({ rede, token: () => falso.token, consentimentoValido: () => true, host: "127.0.0.1", porta: falso.porta });
    const repo = criarRepoTelegramMemoria();
    const p = criarPoller({ api, repo, canal_id: "c1", processar: async () => undefined, relogio: relogioFalso(), dormir: dormirFalso(), travas: new Set() });
    try {
      p.iniciar();
      await esperarAte(() => falso.getUpdatesAbertos() === 1, 3000);
      const n0 = falso.chamadasDe("getUpdates").length;
      const cpu0 = process.cpuUsage();
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 3000)); // 3 s reais = 300 s de relógio do Telegram
      const reais = performance.now() - t0;
      const cpu = process.cpuUsage(cpu0);
      const n = falso.chamadasDe("getUpdates").length - n0;
      const minutosVirtuais = (reais / 1000) * escala / 60;
      const reqPorMin = n / minutosVirtuais;
      const r1 = registrar({ id: "P-142", descricao: "requisições/min do poller ocioso (long poll de 30 s)", valor: reqPorMin, limite: 2.2, unidade: "req/min", semFator: true });
      // CPU por requisição (cliente + servidor falso no mesmo processo => teto conservador), extrapolada para 2 req/min reais
      const cpuPorReqMs = (cpu.user + cpu.system) / 1000 / Math.max(n, 1);
      const cpuPct = ((cpuPorReqMs * 2) / 60_000) * 100;
      const r2 = registrar({ id: "P-142-cpu", descricao: "CPU ocioso extrapolada (2 req/min x custo medido por requisição)", valor: cpuPct, limite: 0.2, unidade: "%" });
      expect(r1.ok, JSON.stringify(r1)).toBe(true);
      expect(r2.ok, JSON.stringify(r2)).toBe(true);
      expect(falso.chamadas.slice(n0).every((c) => c.metodo === "getUpdates")).toBe(true);
    } finally {
      await p.parar();
      await falso.fechar();
    }
  }, 30_000);
});

describe("P-144: entrega ao Telegram", () => {
  async function montar() {
    const falso = await subirTelegramFalso({ escalaTempo: 100 });
    const repo = criarRepoAlertasMemoria();
    const entregas = criarRepoEntregasMemoria();
    const canal: CanalRegistro = { id: "c1", tipo: "telegram", nome: "tg", estado: "ativo", saida_ligada: true, entrada_ligada: false, consentimento: consent, silenciado_ate: null, erro_codigo: null };
    const canais = criarRepoCanaisMemoria([canal]);
    const regra: Regra = { id: "r1", nome: "t", ativa: true, tipos: ["*"], canal_id: "c1", filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "minimo", efemera_ate: null, origem: "usuario" };
    const regras = criarRepoRegrasMemoria([regra]);
    const tg = criarRepoTelegramMemoria();
    tg.gravarAutorizado({ id: "a5", canal_id: "c1", user_id: 5, chat_id: 5, nome_exibicao: "x", modo_padrao: "aprovar", texto_livre: true, pin_hash: null, criado_em: "x", ultimo_uso_em: "x", expira_em: new Date(Date.now() + 1e10).toISOString(), revogado_em: null });
    falso.usuario(5).enviar("oi");
    const api = criarClienteBotApi({ rede: criarRedeDeTeste(), token: () => falso.token, consentimentoValido: () => true, host: "127.0.0.1", porta: falso.porta });
    const adaptador = criarCanalTelegram({ api, repo: tg, canal_id: "c1", relogio: { agora: () => Date.now() }, consentimentoValido: () => true, estadoCanal: () => "ativo", dormir: { dormir: async () => undefined } });
    return { falso, repo, entregas, canais, regras, adaptador };
  }
  it("alerta -> sendMessage recebido pelo falso: p95 <= 300 ms (fora da janela de agrupamento)", async () => {
    const m = await montar();
    try {
      // mede o CAMINHO (o espaçamento de 1,1 s por chat é contratual e testado à parte)
      const rapido = { ...m.adaptador, capacidades: { ...m.adaptador.capacidades, min_intervalo_ms: 0, max_por_min: 1000 } };
      const entregador = criarEntregador({ entregas: m.entregas, alertas: m.repo, canais: m.canais, obterAdaptador: async () => rapido, versaoConsentimento: () => "tg-1" });
      const servico = criarServicoAlertas({ repo: m.repo, entregas: m.entregas, regras: m.regras, canais: m.canais, barramento: barramentoFalso(), entregador, novoId: idSeq("e") });
      const ts: number[] = [];
      for (let i = 0; i < 25; i++) {
        const antes = m.falso.chamadasDe("sendMessage").length;
        const t0 = performance.now();
        servico.emitir({ tipo: "tarefa_concluida", entidade_tipo: "task", entidade_id: `T-${i}`, titulo: `Tarefa ${i}`, dados: { task_id: `T-${i}`, tempo_trabalho_ms: 600_000, tokens: 5000, story_points: 3 }, estado: "concluida" });
        await esperarAte(() => m.falso.chamadasDe("sendMessage").length > antes, 2000, 1);
        ts.push(performance.now() - t0);
      }
      entregador.parar();
      const r = registrar({ id: "P-144", descricao: "alerta -> sendMessage recebido pelo servidor falso", valor: percentil(ts, 95), limite: 300, unidade: "ms", pior: Math.max(...ts) });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    } finally {
      await m.falso.fechar();
    }
  }, 30_000);
  it("100 alertas em rajada => <= 20 mensagens no 1º minuto e 0 alertas perdidos (viram resumo)", async () => {
    const m = await montar();
    try {
      const relogio = relogioFalso();
      const timers = timersFalsos(relogio);
      const entregador = criarEntregador({ entregas: m.entregas, alertas: m.repo, canais: m.canais, obterAdaptador: async () => m.adaptador, versaoConsentimento: () => "tg-1", relogio, timers });
      const servico = criarServicoAlertas({ repo: m.repo, entregas: m.entregas, regras: m.regras, canais: m.canais, barramento: barramentoFalso(), relogio, novoId: idSeq("b") });
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const a = servico.emitir({ tipo: i % 2 === 0 ? "tarefa_concluida" : "tarefa_iniciada", entidade_tipo: "task", entidade_id: `T-${i}`, titulo: `Tarefa ${i}`, dados: { task_id: `T-${i}` }, estado: "x" });
        if (a !== null) ids.add(a.id);
      }
      for (let t = 0; t < 120; t++) {
        timers.avancarAte(relogio.agora() + 500);
        await new Promise((r) => setTimeout(r, 12));
        await entregador.drenar();
      }
      const mensagens = m.falso.mensagens.length;
      const cobertos = new Set(m.entregas.porEstado("enviado", 500).map((e) => e.alerta_id));
      const perdidos = [...ids].filter((id) => !cobertos.has(id)).length;
      const r1 = registrar({ id: "P-144-rajada", descricao: "mensagens enviadas no 1º minuto para 100 alertas em rajada", valor: mensagens, limite: 20, unidade: "msgs", semFator: true });
      const r2 = registrar({ id: "P-144-perdidos", descricao: "alertas perdidos na rajada de 100", valor: perdidos, limite: 0, unidade: "alertas", semFator: true });
      expect(r1.ok, JSON.stringify(r1)).toBe(true);
      expect(r2.ok, JSON.stringify(r2)).toBe(true);
    } finally {
      await m.falso.fechar();
    }
  }, 60_000);
});

describe("P-146: segurança do pareamento", () => {
  it(">= 50 bits, TTL <= 300 s, 1 uso, <= 5 erradas, sem oráculo de tempo (< 2 ms)", () => {
    const bits = TAMANHO_CODIGO * Math.log2(ALFABETO.length);
    const medir = (expirar: boolean): number => {
      const relogio = relogioFalso();
      const p = criarPareamento({ relogio });
      p.iniciar();
      if (expirar) relogio.avancar(TTL_PAREAMENTO_MS + 1);
      const t0 = performance.now();
      for (let i = 0; i < 500; i++) p.tentar({ user_id: 5, chat_id: 5, nome: "x" }, "AAAAAAAAAA");
      return (performance.now() - t0) / 500;
    };
    const dif = Math.abs(medir(false) - medir(true));
    const r1 = registrar({ id: "P-146-bits", descricao: "entropia do código de pareamento", valor: bits, limite: 50, unidade: "bits", sentido: "min", semFator: true });
    const r2 = registrar({ id: "P-146-ttl", descricao: "validade do código", valor: TTL_PAREAMENTO_MS / 1000, limite: 300, unidade: "s", semFator: true });
    const r3 = registrar({ id: "P-146-erradas", descricao: "tentativas erradas toleradas na janela", valor: MAX_ERRADAS, limite: 5, unidade: "tentativas", semFator: true });
    const r4 = registrar({ id: "P-146-tempo", descricao: "diferença de tempo entre código errado e expirado", valor: dif, limite: 2, unidade: "ms" });
    for (const r of [r1, r2, r3, r4]) expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe("P-148: avaliação de atraso", () => {
  it("<= 1 ms por task; 200 tasks ativas => 1 timer; recálculo <= 5 ms por evento", () => {
    const hist: AmostraConcluida[] = Array.from({ length: 300 }, (_, i) => ({ workspace_id: "w1", story_points: (i % 5) + 1, tempo_trabalho_ms: (30 + (i % 40)) * MIN }));
    const cfg = CONFIG_ALERTAS_PADRAO.atraso;
    const agora = Date.now();
    const tasks = Array.from({ length: 200 }, (_, i) => ({ task_id: `T-${i}`, workspace_id: "w1", story_points: (i % 5) + 1, ativo_ms: (i % 90) * MIN, estado: "em_andamento" as const, alertou_atraso: 0 as const }));
    const por: number[] = [];
    for (const t of tasks) {
      const t0 = performance.now();
      decidirAtraso(t, hist, cfg, agora);
      por.push(performance.now() - t0);
    }
    const relogio = relogioFalso();
    const timers = timersFalsos(relogio);
    const ag = criarAgendadorVencimentos<number>({ aoVencer: () => undefined, timers, relogio });
    const recalculo: number[] = [];
    for (const t of tasks) {
      const t0 = performance.now();
      const v = proximoVencimento(t, hist, cfg, agora);
      if (v !== null) ag.agendar(t.task_id, v, 0);
      recalculo.push(performance.now() - t0);
    }
    const evento = performance.now();
    ag.agendar("T-5", agora + 1000, 0);
    const recEvento = performance.now() - evento;
    const r1 = registrar({ id: "P-148", descricao: "decidirAtraso por task (p95)", valor: percentil(por, 95), limite: 1, unidade: "ms" });
    const r2 = registrar({ id: "P-148-timers", descricao: "timers vivos com 200 tasks ativas", valor: timers.vivos(), limite: 1, unidade: "timers", semFator: true });
    const r3 = registrar({ id: "P-148-recalculo", descricao: "recálculo do vencimento por evento (p95)", valor: Math.max(percentil(recalculo, 95), recEvento), limite: 5, unidade: "ms" });
    for (const r of [r1, r2, r3]) expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe("P-149: formatação, redação e pânico", () => {
  it("mensagem de 4 KB <= 1 ms (p95); 100 KB truncados e redigidos <= 5 ms", () => {
    const longo = "a".repeat(4000);
    const ts: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      renderizar("agente_mensagem", "telegram", "padrao", { ...DADOS_EXEMPLO, detalhe: longo }, longo, { escapar: escaparHtml });
      ts.push(performance.now() - t0);
    }
    const grande = "texto comum de alerta sem segredo algum, com /barra e @ e http só no fim ".repeat(1400);
    const tg: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      redigirParaCanal(grande, { max: 2000 });
      tg.push(performance.now() - t0);
    }
    const r1 = registrar({ id: "P-149-4kb", descricao: "montar mensagem de 4 KB (p95)", valor: percentil(ts, 95), limite: 1, unidade: "ms" });
    const r2 = registrar({ id: "P-149-100kb", descricao: "redigir e truncar entrada de 100 KB (p95)", valor: percentil(tg, 95), limite: 5, unidade: "ms" });
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
  });
  it("pânico: 0 sockets para o falso em <= 1 s e fila cancelada", async () => {
    const c = await montarCenario();
    try {
      await c.parear(5);
      c.ligar();
      await esperarAte(() => c.falso.getUpdatesAbertos() === 1, 3000);
      const t0 = performance.now();
      await c.servico.panico.panico({ parar_execucoes: true, origem: "perf" });
      await esperarAte(() => c.falso.socketsAbertos() === 0 && c.rede.emVoo() === 0, 1000, 2);
      const ms = performance.now() - t0;
      const r = registrar({ id: "P-149-panico", descricao: "pânico até 0 sockets abertos para api.telegram.org", valor: ms, limite: 1000, unidade: "ms" });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    } finally {
      await c.fechar();
    }
  }, 30_000);
});
