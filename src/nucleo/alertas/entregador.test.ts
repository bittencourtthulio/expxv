import { describe, expect, it } from "vitest";
import { barramentoFalso, idSeq, relogioFalso, timersFalsos } from "../../../tests/fixtures/alertas/ajudas";
import { suiteCanal } from "../../../tests/fixtures/alertas/suite-canal";
import type { AlertaVisao, CanalRegistro, Regra } from "../../compartilhado/alertas";
import type { CanalComunicacao, MensagemSaida, ResultadoEnvio } from "./canal";
import { criarEntregador } from "./entregador";
import { criarRepoAlertasMemoria, criarRepoCanaisMemoria, criarRepoEntregasMemoria, criarRepoRegrasMemoria } from "./memoria";
import { criarServicoAlertas } from "./servico";

const consent = { versao_texto: "v1", hash_texto: "h", aceito_em: "2026-09-30T00:00:00Z", host: "api.telegram.org", itens_enviados: [] };
const canalReg = (p: Partial<CanalRegistro> = {}): CanalRegistro => ({ id: "c1", tipo: "telegram", nome: "tg", estado: "ativo", saida_ligada: true, entrada_ligada: false, consentimento: consent, silenciado_ate: null, erro_codigo: null, ...p });
const regra = (p: Partial<Regra> = {}): Regra => ({ id: "r1", nome: "r", ativa: true, tipos: ["*"], canal_id: "c1", filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "minimo", efemera_ate: null, origem: "usuario", ...p });

interface Falso extends CanalComunicacao {
  enviadas: MensagemSaida[];
  respostas: ResultadoEnvio[];
  emVoo: number;
  maxEmVoo: number;
  atraso: number;
  tempos: number[];
}
function canalFalso(relogio: { agora(): number }, cap: Partial<CanalComunicacao["capacidades"]> = {}): Falso {
  const f: Falso = {
    tipo: "telegram",
    capacidades: { entrada: false, botoes: false, formato: "html", limite_visivel: 3500, edita_mensagem: false, precisa_consentimento: true, min_intervalo_ms: 1100, max_por_min: 20, ...cap },
    estado: () => "ativo",
    enviadas: [],
    respostas: [],
    emVoo: 0,
    maxEmVoo: 0,
    atraso: 0,
    tempos: [],
    async enviar(msg, sinal) {
      f.emVoo++;
      f.maxEmVoo = Math.max(f.maxEmVoo, f.emVoo);
      f.enviadas.push(msg);
      f.tempos.push(relogio.agora());
      await new Promise((r) => setImmediate(r));
      f.emVoo--;
      if (sinal.aborted) return { ok: false, permanente: false, erro: "rede" };
      return f.respostas.shift() ?? { ok: true, mensagem_externa_id: `m${f.enviadas.length}` };
    },
    testar: async () => ({ ok: true, detalhe: "ok" }),
  };
  return f;
}

function montar(o: { canal?: Partial<CanalRegistro>; regras?: Regra[]; cap?: Partial<CanalComunicacao["capacidades"]>; auto?: boolean } = {}) {
  const relogio = relogioFalso();
  const timers = timersFalsos(relogio);
  const barramento = barramentoFalso();
  const repo = criarRepoAlertasMemoria();
  const entregas = criarRepoEntregasMemoria();
  const canais = criarRepoCanaisMemoria([canalReg(o.canal)]);
  const regras = criarRepoRegrasMemoria(o.regras ?? [regra()]);
  const falso = canalFalso(relogio, o.cap);
  const erros: string[] = [];
  const entregador = criarEntregador({ entregas, alertas: repo, canais, obterAdaptador: async () => falso, versaoConsentimento: () => "v1", barramento, relogio, timers, aoErroPermanente: (_c, e) => erros.push(e) });
  const servico = criarServicoAlertas({ repo, entregas, regras, canais, barramento, ...(o.auto === true ? { entregador } : {}), relogio, novoId: idSeq("x") });
  return { relogio, timers, barramento, repo, entregas, canais, regras, falso, entregador, servico, erros };
}
const ev = (n: number, extra: Partial<Parameters<ReturnType<typeof criarServicoAlertas>["emitir"]>[0]> = {}) => ({ tipo: "tarefa_concluida" as const, entidade_tipo: "task", entidade_id: `T-${n}`, titulo: `Tarefa ${n}`, estado: "concluida", dados: { task_id: `T-${n}`, tempo_trabalho_ms: 600_000, tokens: 5000, story_points: 3 }, ...extra });

/** avança o relógio com os timers falsos, drenando entre os passos (o envio do falso usa setImmediate). */
async function rodar(m: ReturnType<typeof montar>, ms: number, passo = 1000): Promise<void> {
  const fim = m.relogio.agora() + ms;
  while (m.relogio.agora() < fim) {
    m.timers.avancarAte(Math.min(fim, m.relogio.agora() + passo));
    await new Promise((r) => setTimeout(r, 0));
    await m.entregador.drenar();
  }
}

describe("serviço + entregador (T-20.14)", () => {
  it("alerta -> regra -> entrega -> canal, com tempo, tokens e SP na mensagem", async () => {
    const m = montar();
    m.servico.emitir(ev(1));
    await m.entregador.drenar();
    expect(m.falso.enviadas).toHaveLength(1);
    expect(m.falso.enviadas[0]?.html).toContain("Tempo de trabalho: 10 min");
    expect(m.falso.enviadas[0]?.html).toContain("Tokens: 5.000");
    expect(m.falso.enviadas[0]?.html).toContain("Pontos: 3");
    expect(m.barramento.eventos.some((e) => e.tipo === "alert.delivery_succeeded")).toBe(true);
    expect(m.entregas.porEstado("enviado", 10)).toHaveLength(1);
  });
  it("sem regra => nada sai; sem consentimento => 0 chamadas ao adaptador (descartado)", async () => {
    const a = montar({ regras: [] });
    a.servico.emitir(ev(1));
    await a.entregador.drenar();
    expect(a.falso.enviadas).toHaveLength(0);
    const b = montar({ canal: { consentimento: null } });
    b.servico.emitir(ev(1));
    await b.entregador.drenar();
    expect(b.falso.enviadas).toHaveLength(0);
    expect(b.entregas.porEstado("pendente", 10)).toHaveLength(0);
  });
  it("consentimento revogado/obsoleto entre avaliar e enviar: o entregador recusa antes do adaptador", async () => {
    const m = montar();
    m.servico.emitir(ev(1));
    m.canais.gravar(canalReg({ consentimento: { ...consent, versao_texto: "v0" } }));
    await m.entregador.drenar();
    expect(m.falso.enviadas).toHaveLength(0);
    expect(m.entregas.porEstado("descartado", 10)[0]?.erro_codigo).toBe("consentimento_ausente");
  });
  it("com `auto`, emitir acorda o entregador sozinho", async () => {
    const m = montar({ auto: true });
    m.servico.emitir(ev(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(m.falso.enviadas).toHaveLength(1);
  });
  it("uma entrega por vez por canal; espaçamento >= 1 100 ms", async () => {
    const m = montar();
    for (let i = 0; i < 3; i++) m.servico.emitir(ev(i));
    await rodar(m, 10_000, 100);
    expect(m.falso.enviadas).toHaveLength(3);
    expect(m.falso.maxEmVoo).toBe(1);
    for (let i = 1; i < m.falso.tempos.length; i++) expect((m.falso.tempos[i] as number) - (m.falso.tempos[i - 1] as number)).toBeGreaterThanOrEqual(1100);
  });
  it("P-144: 100 alertas em rajada => <= 20 mensagens no 1º minuto e 0 alertas perdidos", async () => {
    const m = montar();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const a = m.servico.emitir(ev(i, { tipo: i % 2 === 0 ? "tarefa_concluida" : "tarefa_iniciada" }));
      if (a !== null) ids.add(a.id);
    }
    // o flood do emissor cria no máximo 31 alertas por tipo; nada some: o resumo conta o resto
    await rodar(m, 60_000, 500);
    expect(m.falso.enviadas.length).toBeLessThanOrEqual(20);
    const cobertos = new Set(m.falso.enviadas.flatMap((x) => x.alerta_ids));
    for (const id of ids) expect(cobertos.has(id), id).toBe(true);
    expect(m.entregas.porEstado("pendente", 500)).toHaveLength(0);
  });
  it("rajada NÃO mistura destinos: o acompanhamento efêmero de um chat não vaza para o resumo dos outros, e nenhum alerta se perde (auditoria M6)", async () => {
    const reg = [
      regra({ id: "r_geral", nome: "geral", tipos: ["tarefa_concluida"], nivel: "minimo" }),
      regra({ id: "r_chat5", nome: "acompanhamento", tipos: ["tarefa_concluida"], nivel: "padrao", chat_ref: "chat:5", origem: "pedido_remoto", efemera_ate: "2099-01-01T00:00:00.000Z" }),
    ];
    const m = montar({ regras: reg });
    const ids = new Set<string>();
    for (let i = 0; i < 8; i++) ids.add(m.servico.emitir(ev(i, { tipo: "tarefa_concluida" }))?.id as string);
    await rodar(m, 60_000, 500);
    const porDestino = (chat: string | null) => m.falso.enviadas.filter((x) => (x.destino?.chat_ref ?? null) === chat);
    // dois grupos (geral, chat:5): cada resumo só carrega as entregas do seu grupo e leva o seu destino
    expect(porDestino("chat:5").length).toBeGreaterThan(0);
    expect(porDestino(null).length).toBeGreaterThan(0);
    for (const msg of m.falso.enviadas) expect(msg.destino === undefined || msg.destino.chat_ref === "chat:5").toBe(true);
    const cobertosDoChat = new Set(porDestino("chat:5").flatMap((x) => x.alerta_ids));
    const cobertosGerais = new Set(porDestino(null).flatMap((x) => x.alerta_ids));
    for (const id of ids) {
      expect(cobertosDoChat.has(id), `chat:5 ${id}`).toBe(true);
      expect(cobertosGerais.has(id), `geral ${id}`).toBe(true);
    }
    expect(m.entregas.porEstado("pendente", 500)).toHaveLength(0);
  });
  it("retry com backoff 5 s, 15 s...; 5 falhas => falhou; sucesso no meio zera o ciclo", async () => {
    const m = montar();
    m.falso.respostas.push({ ok: false, permanente: false, erro: "rede" }, { ok: false, permanente: false, erro: "rede" });
    m.servico.emitir(ev(1));
    await rodar(m, 30_000, 500);
    expect(m.falso.enviadas).toHaveLength(3);
    expect(m.entregas.porEstado("enviado", 5)).toHaveLength(1);
    const f = montar();
    for (let i = 0; i < 5; i++) f.falso.respostas.push({ ok: false, permanente: false, erro: "rede" });
    f.servico.emitir(ev(1));
    await rodar(f, 600_000, 1000);
    expect(f.falso.enviadas).toHaveLength(5);
    expect(f.entregas.porEstado("falhou", 5)).toHaveLength(1);
    expect(f.barramento.eventos.filter((e) => e.tipo === "alert.delivery_failed")).toHaveLength(1);
  });
  it("429 respeita tentar_em_ms e bloqueia o canal inteiro até lá", async () => {
    const m = montar();
    m.falso.respostas.push({ ok: false, permanente: false, erro: "rate_limited", tentar_em_ms: 31_000 });
    m.servico.emitir(ev(1));
    await m.entregador.drenar();
    m.servico.emitir(ev(2));
    await rodar(m, 30_000, 500);
    expect(m.falso.enviadas).toHaveLength(1);
    await rodar(m, 5_000, 500);
    expect(m.falso.enviadas.length).toBeGreaterThanOrEqual(2);
  });
  it("erro permanente (token inválido): falhou, canal avisado e a fila do canal para (sem laço)", async () => {
    const m = montar();
    m.falso.respostas.push({ ok: false, permanente: true, erro: "token_invalido" });
    m.servico.emitir(ev(1));
    m.servico.emitir(ev(2));
    await rodar(m, 60_000, 1000);
    expect(m.falso.enviadas).toHaveLength(1);
    expect(m.erros).toEqual(["token_invalido"]);
    expect(m.entregas.porEstado("pendente", 10)).toHaveLength(0);
  });
  it("reinício no meio: entregas pendentes persistidas são retomadas sem duplicar nem perder", async () => {
    const m = montar();
    m.servico.emitir(ev(1));
    m.servico.emitir(ev(2));
    m.entregador.parar(); // "processo morreu" antes de enviar
    expect(m.falso.enviadas).toHaveLength(0);
    const novo = criarEntregador({ entregas: m.entregas, alertas: m.repo, canais: m.canais, obterAdaptador: async () => m.falso, versaoConsentimento: () => "v1", barramento: m.barramento, relogio: m.relogio, timers: m.timers });
    await novo.drenar();
    m.relogio.avancar(2000);
    await novo.drenar();
    expect(m.falso.enviadas.flatMap((x) => x.alerta_ids).sort()).toHaveLength(2);
    expect(new Set(m.falso.enviadas.flatMap((x) => x.alerta_ids)).size).toBe(2);
    // reavaliar o MESMO alerta não duplica a entrega (UNIQUE alerta,canal,regra)
    const a = m.repo.listar({}).itens[0] as AlertaVisao;
    expect(m.entregas.inserir({ id: "dup", alerta_id: a.id, canal_id: "c1", regra_id: "r1", estado: "pendente", tentativas: 0, proxima_tentativa_em: null, erro_codigo: null, lote_id: null, mensagem_externa_id: null, enviado_em: null, criado_em: "x", nivel: "minimo", chat_ref: null })).toBe(false);
  });
  it("cancelar (pânico) aborta o envio em voo, descarta a fila e para em < 1 s", async () => {
    const m = montar();
    for (let i = 0; i < 5; i++) m.servico.emitir(ev(i));
    const p = m.entregador.drenar();
    m.entregador.cancelar("c1");
    await p;
    expect(m.entregador.pendentes()).toBe(0);
    expect(m.entregador.timersVivos()).toBe(0);
    m.servico.emitir(ev(99));
    // nova entrega depois do pânico: o canal precisa estar ligado de novo (aqui continua ligado, então sai)
    await m.entregador.drenar();
  });
  it("silêncio agrupa e libera UM resumo no fim da janela; lote de 5 s por Missão", async () => {
    const m = montar({ regras: [regra({ agrupamento: { modo: "lote", janela_s: 5 } })] });
    for (let i = 0; i < 3; i++) m.servico.emitir(ev(i, { mission_id: "m1" }));
    await m.entregador.drenar();
    expect(m.falso.enviadas).toHaveLength(0);
    await rodar(m, 6_000, 500);
    expect(m.falso.enviadas).toHaveLength(1);
    expect(m.falso.enviadas[0]?.alerta_ids).toHaveLength(3);
    expect(m.falso.enviadas[0]?.texto).toContain("3 alertas");
  });
  it("crítico não espera lote nem fila de resumo", async () => {
    const m = montar({ regras: [regra({ agrupamento: { modo: "digest", hora_digest: "18:00" } })] });
    m.servico.emitir(ev(1, { severidade: "critico" }));
    await m.entregador.drenar();
    expect(m.falso.enviadas).toHaveLength(1);
  });
});

suiteCanal("falso (referência)", async () => ({ canal: canalFalso({ agora: () => 0 }) }));
