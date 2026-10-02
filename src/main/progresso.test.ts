// Serviço do painel de progresso (D-660…): coalescência ≥ 250 ms, sem polling, integração com um dublê do Maestro (pipeline de 5 etapas avançando), sprintx,
// skill detectada pelo hook e retenção do fim. Relógio e timers são injetados: nenhum teste espera tempo real.
import { describe, expect, it } from "vitest";
import type { EstadoEtapa, EstadoPipeline } from "../compartilhado/maestro";
import type { EstadoProgresso, Progresso } from "../compartilhado/progresso";
import type { PipelineParaProgresso } from "../nucleo/progresso";
import { criarServicoProgresso, type SinalSessao, type TrabalhoLido } from "./progresso";

const ETAPAS = ["sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f4", "sprintx.f5"] as const;

class Relogio {
  t = Date.parse("2026-10-01T12:00:00.000Z");
  fila: Array<{ id: number; em: number; fn: () => void }> = [];
  seq = 0;
  agora = (): number => this.t;
  agendar = (fn: () => void, ms: number): number => { const id = ++this.seq; this.fila.push({ id, em: this.t + ms, fn }); return id; };
  cancelar = (id: unknown): void => { this.fila = this.fila.filter((x) => x.id !== id); };
  /** avança o relógio e dispara o que venceu (e as promessas pendentes). */
  async avancar(ms: number): Promise<void> {
    const fim = this.t + ms;
    for (;;) {
      const prox = this.fila.filter((x) => x.em <= fim).sort((a, b) => a.em - b.em)[0];
      if (prox === undefined) break;
      this.fila = this.fila.filter((x) => x !== prox);
      this.t = Math.max(this.t, prox.em);
      prox.fn();
      await sorteio();
    }
    this.t = fim;
    await sorteio();
  }
}
const sorteio = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function pipeline(estado: EstadoPipeline, estados: EstadoEtapa[], extra: Partial<PipelineParaProgresso> = {}): PipelineParaProgresso {
  return {
    id: "mpl_AAAA1111", workspace_id: "ws_1", trabalho_id: null, pipeline_id: "sprintx", estado, texto_resumo: "Adicionar frete", motivo_fim: null, criado_em: "2026-10-01T11:59:00.000Z", concluido_em: null,
    plano: { etapas: ETAPAS.map((e, i) => ({ etapa_id: e, ordem: i + 1, estado_inicial: "pendente" as const, tipo: "planejador" as const })) },
    execs: estados.map((s, i) => ({ etapa_id: ETAPAS[i]!, ordem: i + 1, tentativa: 1, rodada: 1, estado: s, pane_id: `pane_${i}`, inicio_em: "2026-10-01T11:59:30.000Z", fim_em: null, detalhe: null })),
    ...extra,
  };
}

function montar(opcoes: { trabalhos?: () => TrabalhoLido[] | null } = {}) {
  const rel = new Relogio();
  const publicados: EstadoProgresso[] = [];
  const barramento = new Map<string, Array<(p: unknown) => void>>();
  const maestro = { ativos: [] as PipelineParaProgresso[], finais: new Map<string, PipelineParaProgresso>(), leituras: 0 };
  let sinais: ((s: SinalSessao) => void) | null = null;
  let inscritosSessao = 0;
  const servico = criarServicoProgresso({
    barramento: { assinar: <T>(tipo: string, fn: (p: T) => void) => { const l = barramento.get(tipo) ?? []; l.push(fn as (p: unknown) => void); barramento.set(tipo, l); return () => { barramento.set(tipo, (barramento.get(tipo) ?? []).filter((x) => x !== fn)); }; } },
    workspaces: () => ["ws_1", "ws_2"],
    pipelinesAtivos: async (ws) => { maestro.leituras++; return maestro.ativos.filter((p) => p.workspace_id === ws); },
    pipeline: async (id) => maestro.finais.get(id) ?? null,
    trabalhos: (ws) => (ws === "ws_1" ? (opcoes.trabalhos?.() ?? null) : null),
    sessaoDoPane: (pane) => `sess_${pane}`,
    escutarSessoes: (fn) => { sinais = fn; inscritosSessao++; return () => { sinais = null; inscritosSessao--; }; },
    publicar: (e) => void publicados.push(e),
    agora: rel.agora, agendar: rel.agendar, cancelar: rel.cancelar,
  });
  const emitir = (tipo: string, p: unknown): void => (barramento.get(tipo) ?? []).forEach((f) => f(p));
  const ultimo = (): Progresso[] => publicados.at(-1)?.progressos ?? [];
  return { rel, servico, maestro, publicados, emitir, ultimo, sinal: (s: SinalSessao) => sinais?.(s), inscritosSessao: () => inscritosSessao, barramento };
}

describe("serviço de progresso: pipeline do Maestro", () => {
  it("nada acontece (nenhum timer, nenhuma leitura) até alguém pedir o estado ou um evento chegar", async () => {
    const m = montar();
    expect(m.rel.fila).toHaveLength(0);
    expect(m.maestro.leituras).toBe(0);
    expect(m.barramento.size).toBe(0);
    expect(m.servico.ativo()).toBe(false);
  });

  it("pipeline de 5 etapas avançando: itens viram ✓ um a um e, ao concluir, o fim é publicado e depois retirado", async () => {
    const m = montar();
    m.maestro.ativos = [pipeline("executando", ["executando"])];
    expect((await m.servico.estado()).progressos).toHaveLength(1); // liga as assinaturas
    expect(m.barramento.has("maestro:evento")).toBe(true);
    const sequencia: Array<[EstadoPipeline, EstadoEtapa[]]> = [
      ["executando", ["concluida", "executando"]],
      ["executando", ["concluida", "concluida", "executando"]],
      ["aguardando_humano", ["concluida", "concluida", "concluida", "aguardando_humano"]],
      ["executando", ["concluida", "concluida", "concluida", "concluida", "executando"]],
    ];
    const vistos: string[][] = [];
    for (const [estado, etapas] of sequencia) {
      m.maestro.ativos = [pipeline(estado, etapas)];
      m.emitir("maestro:evento", { workspace_id: "ws_1", pipeline_id: "mpl_AAAA1111" });
      await m.rel.avancar(300);
      vistos.push(m.ultimo()[0]!.itens.map((i) => i.estado[0]!));
    }
    expect(vistos).toEqual([["c", "e", "p", "p", "p"], ["c", "c", "e", "p", "p"], ["c", "c", "c", "a", "p"], ["c", "c", "c", "c", "e"]]);
    // fim: sai da lista de ativos e o serviço lê o estado final uma vez
    m.maestro.ativos = [];
    m.maestro.finais.set("mpl_AAAA1111", pipeline("concluido", ["concluida", "concluida", "concluida", "concluida", "concluida"], { concluido_em: new Date(m.rel.t).toISOString() }));
    m.emitir("maestro:evento", { workspace_id: "ws_1", pipeline_id: "mpl_AAAA1111" });
    await m.rel.avancar(300);
    const fim = m.ultimo()[0]!;
    expect(fim).toMatchObject({ resultado: "concluido", concluido: true });
    expect(fim.itens.every((i) => i.estado === "concluido")).toBe(true);
    expect(fim.fim_em).not.toBeNull();
    // retenção: some depois de 60 s, sem nenhum evento (um único timer de expiração)
    await m.rel.avancar(61_000);
    expect(m.ultimo()).toEqual([]);
    expect(m.rel.fila).toHaveLength(0);
  });

  it("coalesce: uma rajada de eventos vira UMA leitura e UMA publicação, no mínimo 250 ms depois", async () => {
    const m = montar();
    m.maestro.ativos = [pipeline("executando", ["executando"])];
    await m.servico.estado();
    const leiturasAntes = m.maestro.leituras;
    const publicadasAntes = m.publicados.length;
    m.maestro.ativos = [pipeline("executando", ["concluida", "executando"])];
    for (let i = 0; i < 25; i++) m.emitir("maestro:evento", { workspace_id: "ws_1", pipeline_id: "mpl_AAAA1111" });
    await m.rel.avancar(249);
    expect(m.publicados.length).toBe(publicadasAntes);
    await m.rel.avancar(2);
    expect(m.maestro.leituras - leiturasAntes).toBe(1);
    expect(m.publicados.length).toBe(publicadasAntes + 1);
  });

  it("não republica estado idêntico", async () => {
    const m = montar();
    m.maestro.ativos = [pipeline("executando", ["executando"])];
    await m.servico.estado();
    const n = m.publicados.length;
    m.emitir("maestro:evento", { workspace_id: "ws_1", pipeline_id: "mpl_AAAA1111" });
    await m.rel.avancar(300);
    expect(m.publicados.length).toBe(n);
  });

  it("o Pane da etapa vira sessao_id; o pedido vai redigido e curto; payload sem texto de conversa", async () => {
    const m = montar();
    m.maestro.ativos = [pipeline("executando", ["executando"])];
    const p = (await m.servico.estado()).progressos[0]!;
    expect(p.itens[0]!.sessao_id).toBe("sess_pane_0");
    expect(p.pedido).toBe("Adicionar frete");
    expect(JSON.stringify(p).length).toBeLessThan(2_000);
  });

  it("dispensar e fixar valem por progresso, aparecem no estado e são esquecidos quando o progresso some", async () => {
    const m = montar();
    m.maestro.ativos = [pipeline("executando", ["executando"])];
    await m.servico.estado();
    m.servico.dispensar("pl:mpl_AAAA1111");
    m.servico.fixar("pl:mpl_AAAA1111", true);
    await m.rel.avancar(300);
    expect(m.ultimo()[0]).toMatchObject({ dispensado: true, fixado: true });
    m.servico.fixar("pl:mpl_AAAA1111", false);
    await m.rel.avancar(300);
    expect(m.ultimo()[0]!.fixado).toBeUndefined();
    m.maestro.ativos = [];
    m.emitir("maestro:evento", { workspace_id: "ws_1", pipeline_id: "mpl_AAAA1111" });
    await m.rel.avancar(300);
    expect(m.ultimo()).toEqual([]);
    m.maestro.ativos = [pipeline("executando", ["executando"])];
    m.emitir("maestro:evento", { workspace_id: "ws_1", pipeline_id: "mpl_AAAA1111" });
    await m.rel.avancar(300);
    expect(m.ultimo()[0]!.dispensado).toBeUndefined();
  });

  it("progressos de OUTRO workspace são acompanhados em segundo plano", async () => {
    const m = montar();
    m.maestro.ativos = [pipeline("executando", ["concluida", "executando"], { id: "mpl_BBBB2222", workspace_id: "ws_2" })];
    const e = await m.servico.estado();
    expect(e.progressos.map((p) => p.workspace_id)).toEqual(["ws_2"]);
  });

  it("encerrar cancela os timers e as assinaturas", async () => {
    const m = montar();
    m.maestro.ativos = [pipeline("executando", ["executando"])];
    await m.servico.estado();
    m.emitir("maestro:evento", { workspace_id: "ws_1" });
    m.servico.encerrar();
    expect(m.rel.fila).toHaveLength(0);
    expect((m.barramento.get("maestro:evento") ?? []).length).toBe(0);
  });
});

describe("serviço de progresso: skill solta (hook UserPromptSubmit)", () => {
  it("`/expx:runx` detectado abre um progresso 'previsto'; o fim do turno da sessão o conclui; some depois da retenção", async () => {
    const m = montar();
    m.servico.aoSkillDetectada({ workspace_id: "ws_1", pane_id: "pane_9", skill: "runx" });
    await m.rel.avancar(300);
    let p = m.ultimo()[0]!;
    expect(p).toMatchObject({ origem: "skill", titulo: "/expx:runx", previsto: true, resultado: "em_andamento" });
    expect(m.inscritosSessao()).toBe(1);
    m.sinal({ tipo: "atividade", sessao_id: "sess_pane_9", atividade: "pronto" }); // pronto ANTES de trabalhar: ainda não é o fim
    await m.rel.avancar(300);
    expect(m.ultimo()[0]!.resultado).toBe("em_andamento");
    m.sinal({ tipo: "atividade", sessao_id: "sess_pane_9", atividade: "trabalhando" });
    m.sinal({ tipo: "atividade", sessao_id: "sess_pane_9", atividade: "aguardando" });
    await m.rel.avancar(300);
    expect(m.ultimo()[0]!.resultado).toBe("aguardando");
    m.sinal({ tipo: "atividade", sessao_id: "sess_pane_9", atividade: "trabalhando" });
    m.sinal({ tipo: "atividade", sessao_id: "sess_pane_9", atividade: "pronto" });
    await m.rel.avancar(300);
    p = m.ultimo()[0]!;
    expect(p).toMatchObject({ resultado: "concluido", concluido: true });
    expect(m.inscritosSessao()).toBe(0); // sem skill viva, a assinatura de sessão cai
    await m.rel.avancar(61_000);
    expect(m.ultimo()).toEqual([]);
  });

  it("sessão encerrada com erro: a skill falha; encerrada pelo app: conclui", async () => {
    const m = montar();
    m.servico.aoSkillDetectada({ workspace_id: "ws_1", pane_id: "pane_1", skill: "prodx" });
    m.servico.aoSkillDetectada({ workspace_id: "ws_1", pane_id: "pane_2", skill: "memox" });
    await m.rel.avancar(300);
    m.sinal({ tipo: "encerramento", sessao_id: "sess_pane_1", codigo: 1, solicitado: false });
    m.sinal({ tipo: "encerramento", sessao_id: "sess_pane_2", codigo: 143, solicitado: true });
    await m.rel.avancar(300);
    const por = Object.fromEntries(m.ultimo().map((p) => [p.titulo, p.resultado]));
    expect(por).toEqual({ "/expx:prodx": "falhou", "/expx:memox": "concluido" });
  });

  it("skill sem sinal por 15 min some em silêncio (não afirma conclusão)", async () => {
    const m = montar();
    m.servico.aoSkillDetectada({ workspace_id: "ws_1", pane_id: "pane_1", skill: "runx" });
    await m.rel.avancar(300);
    expect(m.ultimo()).toHaveLength(1);
    await m.rel.avancar(15 * 60_000 + 1_000);
    expect(m.ultimo()).toEqual([]);
  });

  it("nome de skill inválido é ignorado", async () => {
    const m = montar();
    m.servico.aoSkillDetectada({ workspace_id: "ws_1", pane_id: "pane_1", skill: "../../x" });
    m.servico.aoSkillDetectada({ workspace_id: "ws_1", pane_id: "pane_1", skill: "" });
    await m.rel.avancar(300);
    expect(m.ultimo()).toEqual([]);
  });

  it("o estágio do rastro (trabalho da mesma ferramenta) vira a etapa medida", async () => {
    let estagio = "e1";
    const m = montar({ trabalhos: () => [trab({ id: "OC-1", ferramenta: "runx", estagio, ultima_atividade: new Date(m0.rel.t).toISOString() })] });
    const m0 = m;
    m.servico.aoSkillDetectada({ workspace_id: "ws_1", pane_id: "pane_1", skill: "runx" });
    await m.rel.avancar(300);
    estagio = "e3";
    m.emitir("metodo:mudou", { workspace_id: "ws_1" });
    await m.rel.avancar(300);
    const p = m.ultimo()[0]!;
    expect(p.itens.map((i) => i.estado[0])).toEqual(["c", "c", "e", "p", "p"]);
    expect(p.itens[2]!.detalhe).toBeUndefined();
  });
});

function trab(extra: Partial<TrabalhoLido> & { id: string }): TrabalhoLido {
  return { titulo: "Trabalho", status: "em_andamento", ultima_atividade: null, sprints: [], ferramenta: "sprintx", estagio: "f1", eventos_total: 1, ...extra };
}

describe("serviço de progresso: sprintx e rastro", () => {
  const comTasks = (t: Partial<TrabalhoLido>, status: Array<"concluida" | "em_andamento" | "pendente">): TrabalhoLido =>
    trab({ ...t, id: "frete", sprints: [{ id: "S", titulo: "S", fases: [{ id: "F1", titulo: "F", tasks: status.map((s, i) => ({ id: `T-${i + 1}`, titulo: `t${i}`, status: s, depende_de: [], concluida_em: null, duracao_observada_ms: null })) }] }] });

  it("task reivindicada abre o acompanhamento; plano todo concluído publica o fim; plano já concluído ao carregar NÃO abre nada", async () => {
    let status: Array<"concluida" | "em_andamento" | "pendente"> = ["concluida", "concluida"];
    let relogio = (): string => "";
    const m = montar({ trabalhos: () => [comTasks({ ultima_atividade: relogio() }, status)] });
    relogio = () => new Date(m.rel.t - 60_000).toISOString();
    expect((await m.servico.estado()).progressos).toEqual([]); // tudo concluído antes de abrir o app
    status = ["concluida", "em_andamento", "pendente"];
    m.emitir("metodo:mudou", { workspace_id: "ws_1" });
    await m.rel.avancar(300);
    expect(m.ultimo()).toHaveLength(1);
    expect(m.ultimo()[0]).toMatchObject({ origem: "sprintx", resultado: "em_andamento" });
    status = ["concluida", "concluida", "concluida"];
    m.emitir("metodo:mudou", { workspace_id: "ws_1" });
    await m.rel.avancar(300);
    expect(m.ultimo()[0]).toMatchObject({ resultado: "concluido", concluido: true });
    await m.rel.avancar(61_000);
    expect(m.ultimo()).toEqual([]);
  });

  it("task em andamento esquecida há horas não abre", async () => {
    const m = montar({ trabalhos: () => [comTasks({ ultima_atividade: "2026-10-01T06:00:00.000Z" }, ["em_andamento"])] });
    expect((await m.servico.estado()).progressos).toEqual([]);
  });

  it("Maestro + sprintx do mesmo trabalho: uma lista, com o contador de tasks na etapa de execução", async () => {
    const m = montar({ trabalhos: () => [comTasks({ ultima_atividade: new Date(m.rel.t - 30_000).toISOString() }, ["concluida", "em_andamento", "pendente"])] });
    const p = pipeline("executando", ["concluida", "concluida", "concluida", "concluida", "concluida"], { trabalho_id: "frete" });
    p.plano.etapas = [{ etapa_id: "sprintx.f6", ordem: 1, estado_inicial: "pendente", tipo: "implementador" }];
    p.execs = [{ etapa_id: "sprintx.f6", ordem: 1, tentativa: 1, rodada: 1, estado: "executando", pane_id: null, inicio_em: null, fim_em: null, detalhe: null }];
    m.maestro.ativos = [p];
    const e = await m.servico.estado();
    expect(e.progressos.map((x) => x.origem)).toEqual(["maestro"]);
    expect(e.progressos[0]!.itens[0]!.detalhe).toBe("1/3 tasks");
  });

  it("rastro sem hook: atividade nova de uma ferramenta do método abre uma skill; a primeira leitura é só a linha de base", async () => {
    let total = 3;
    let estagio = "f1";
    const m = montar({ trabalhos: () => [trab({ id: "frete", ferramenta: "sprintx", estagio, eventos_total: total, ultima_atividade: new Date(m.rel.t).toISOString() })] });
    expect((await m.servico.estado()).progressos).toEqual([]); // baseline
    total = 4;
    estagio = "f2";
    m.emitir("metodo:mudou", { workspace_id: "ws_1" });
    await m.rel.avancar(300);
    expect(m.ultimo()).toHaveLength(1);
    expect(m.ultimo()[0]).toMatchObject({ origem: "skill", previsto: true, titulo: "/expx:sprintx" });
    expect(m.ultimo()[0]!.itens.find((i) => i.estado === "em_andamento")?.id).toBe("sprintx.f2");
  });
});
