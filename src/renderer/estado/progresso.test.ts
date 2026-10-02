import { describe, expect, it, vi } from "vitest";
import { CHAVE_PROGRESSO_MOSTRAR, type EstadoProgresso, type EventoProgressoMudou, type Progresso } from "../../compartilhado/progresso";
import { criarStoreProgresso, indicadorDe, visiveisDe } from "./progresso";

function prog(id: string, resultado: Progresso["resultado"], estados: Array<Progresso["itens"][number]["estado"]>, extra: Partial<Progresso> = {}): Progresso {
  return { id, origem: "maestro", titulo: "Pipeline: nova feature", workspace_id: "ws_1", resultado, concluido: resultado === "concluido", previsto: false, iniciado_em: 1_000, fim_em: resultado === "em_andamento" ? null : 61_000, itens: estados.map((estado, i) => ({ id: `e${i}`, rotulo: `Etapa ${i + 1}`, estado })), ...extra };
}

function montar(opcoes: { pref?: unknown; estado?: EstadoProgresso } = {}) {
  let agora = 10_000;
  const timers: Array<{ id: number; em: number; fn: () => void }> = [];
  let seq = 0;
  let ouvinte: ((e: EventoProgressoMudou) => void) | null = null;
  const desassinar = vi.fn(() => { ouvinte = null; });
  const api = {
    estado: vi.fn(async () => opcoes.estado ?? { progressos: [] }),
    dispensar: vi.fn(async () => ({ ok: true as const })),
    fixar: vi.fn(async () => ({ ok: true as const })),
    assinar: vi.fn((cb: (e: EventoProgressoMudou) => void) => { ouvinte = cb; return desassinar; }),
  };
  const config = { ler: vi.fn(async () => opcoes.pref), gravar: vi.fn(async () => ({ ok: true as const })) };
  const ws = { atual: { id: "ws_1" } as { id: string } | null, ouvintes: new Set<() => void>(), obter() { return { atual: this.atual }; }, assinar(o: () => void) { this.ouvintes.add(o); return () => void this.ouvintes.delete(o); } };
  const avisar = vi.fn();
  const focarSessao = vi.fn();
  const abrirPipelines = vi.fn();
  const store = criarStoreProgresso({
    api: () => api as never, config: () => config as never, workspaces: ws, agora: () => agora,
    agendar: (fn, ms) => { const id = ++seq; timers.push({ id, em: agora + ms, fn }); return id; },
    cancelar: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    avisar, focarSessao, abrirPipelines,
  });
  const avancar = (ms: number): void => {
    const fim = agora + ms;
    for (;;) {
      const t = timers.filter((x) => x.em <= fim).sort((a, b) => a.em - b.em)[0];
      if (t === undefined) break;
      timers.splice(timers.indexOf(t), 1);
      agora = Math.max(agora, t.em);
      t.fn();
    }
    agora = fim;
  };
  return { store, api, config, ws, avisar, focarSessao, abrirPipelines, timers, avancar, emitir: (progressos: Progresso[]) => ouvinte?.({ progressos }), desassinar, assinado: () => ouvinte !== null };
}
const tick = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("store do painel de progresso", () => {
  it("preferência padrão LIGADA: lê o estado, assina o main e abre quando algo está em andamento", async () => {
    const m = montar({ estado: { progressos: [prog("pl:a", "em_andamento", ["concluido", "em_andamento", "pendente"])] } });
    await m.store.iniciar();
    await tick();
    expect(m.config.ler).toHaveBeenCalledWith(CHAVE_PROGRESSO_MOSTRAR);
    expect(m.assinado()).toBe(true);
    expect(visiveisDe(m.store.obter()).map((c) => c.progresso.id)).toEqual(["pl:a"]);
    expect(m.timers).toHaveLength(0); // nada agendado com tudo em andamento
  });

  it("feature desligada: não lê nem assina o main; religar assina e grava", async () => {
    const m = montar({ pref: false });
    await m.store.iniciar();
    expect(m.api.estado).not.toHaveBeenCalled();
    expect(m.api.assinar).not.toHaveBeenCalled();
    expect(visiveisDe(m.store.obter())).toEqual([]);
    await m.store.definirLigado(true);
    expect(m.config.gravar).toHaveBeenCalledWith(CHAVE_PROGRESSO_MOSTRAR, true);
    expect(m.assinado()).toBe(true);
    await m.store.definirLigado(false);
    expect(m.config.gravar).toHaveBeenLastCalledWith(CHAVE_PROGRESSO_MOSTRAR, false);
    expect(m.desassinar).toHaveBeenCalled();
  });

  it("evento do main abre o painel; concluir mostra o resumo, fecha em 2 s + animação e deixa o toast 'Ver resumo'", async () => {
    const m = montar();
    await m.store.iniciar();
    await tick();
    m.emitir([prog("pl:a", "em_andamento", ["concluido", "em_andamento", "pendente"])]);
    expect(visiveisDe(m.store.obter())).toHaveLength(1);
    m.emitir([prog("pl:a", "concluido", ["concluido", "concluido", "concluido"])]);
    expect(m.store.obter().ciclo.itens["pl:a"]!.fase).toBe("resumo");
    m.avancar(1_999);
    expect(m.store.obter().ciclo.itens["pl:a"]!.fase).toBe("resumo");
    m.avancar(2);
    expect(m.store.obter().ciclo.itens["pl:a"]!.fase).toBe("fechando");
    m.avancar(250);
    expect(visiveisDe(m.store.obter())).toEqual([]);
    expect(m.avisar).toHaveBeenCalledTimes(1);
    const [texto, tom, acao] = m.avisar.mock.calls[0]!;
    expect(texto).toBe("Pipeline: nova feature · Concluído: 3/3 em 1 min");
    expect(tom).toBe("sucesso");
    expect(acao.rotulo).toBe("Ver resumo");
    acao.executar();
    expect(m.store.obter().ciclo.itens["pl:a"]!.fase).toBe("leitura");
    m.avancar(10_001);
    m.avancar(250);
    expect(visiveisDe(m.store.obter())).toEqual([]);
    expect(m.timers).toHaveLength(0); // sem prazo pendente: nenhum timer
  });

  it("falha e aguardando NÃO fecham sozinhos", async () => {
    const m = montar();
    await m.store.iniciar();
    await tick();
    m.emitir([prog("pl:a", "aguardando", ["concluido", "aguardando"]), prog("pl:b", "falhou", ["falhou", "pendente"], { iniciado_em: 2_000 })]);
    m.avancar(600_000);
    expect(visiveisDe(m.store.obter()).map((c) => c.fase)).toEqual(["ativo", "falha"]);
  });

  it("dispensar e fixar vão ao main; troca de workspace troca o painel; o indicador do card vem do segundo plano", async () => {
    const m = montar();
    await m.store.iniciar();
    await tick();
    m.emitir([prog("pl:a", "em_andamento", ["concluido", "em_andamento"]), prog("pl:x", "em_andamento", ["concluido", "concluido", "em_andamento"], { workspace_id: "ws_2" })]);
    expect(visiveisDe(m.store.obter()).map((c) => c.progresso.id)).toEqual(["pl:a"]);
    expect(indicadorDe(m.store.obter(), "ws_2")).toMatchObject({ feitos: 2, total: 3 });
    m.ws.atual = { id: "ws_2" };
    m.ws.ouvintes.forEach((o) => o());
    expect(visiveisDe(m.store.obter()).map((c) => c.progresso.id)).toEqual(["pl:x"]);
    m.store.fixar("pl:x", true);
    expect(m.api.fixar).toHaveBeenCalledWith("pl:x", true);
    m.store.dispensar("pl:x");
    expect(m.api.dispensar).toHaveBeenCalledWith("pl:x");
    expect(visiveisDe(m.store.obter())).toEqual([]);
  });

  it("a região viva só muda quando a etapa em andamento muda (ou o progresso termina)", async () => {
    const m = montar();
    await m.store.iniciar();
    await tick();
    m.emitir([prog("pl:a", "em_andamento", ["em_andamento", "pendente", "pendente"])]);
    const inicial = m.store.obter().anuncio;
    m.emitir([prog("pl:a", "em_andamento", ["em_andamento", "pendente", "pendente"], { itens: prog("x", "em_andamento", ["em_andamento", "pendente", "pendente"]).itens.map((i) => ({ ...i, detalhe: "ruído" })) })]);
    expect(m.store.obter().anuncio).toBe(inicial);
    m.emitir([prog("pl:a", "em_andamento", ["concluido", "em_andamento", "pendente"])]);
    expect(m.store.obter().anuncio).toBe("Pipeline: nova feature. Etapa 2 de 3: Etapa 2.");
    m.emitir([prog("pl:a", "falhou", ["concluido", "falhou", "pendente"])]);
    expect(m.store.obter().anuncio).toBe("Pipeline: nova feature. Parou na etapa Etapa 2: falhou.");
  });

  it("clique numa etapa foca a sessão; detalhes abre a tela Pipelines", async () => {
    const m = montar();
    m.store.focarEtapa("sess_1");
    expect(m.focarSessao).toHaveBeenCalledWith("sess_1");
    const p = prog("pl:a", "em_andamento", ["em_andamento"]);
    m.store.abrirDetalhes(p);
    expect(m.abrirPipelines).toHaveBeenCalledWith(p);
  });

  it("sem API (navegador): fica indisponível e não lança", async () => {
    const store = criarStoreProgresso({ api: () => undefined, config: () => undefined, workspaces: { obter: () => ({ atual: null }), assinar: () => () => undefined } });
    await store.iniciar();
    expect(store.obter().disponivel).toBe(false);
    expect(visiveisDe(store.obter())).toEqual([]);
  });

  it("encerrar solta assinaturas e timers", async () => {
    const m = montar();
    await m.store.iniciar();
    await tick();
    m.emitir([prog("pl:a", "em_andamento", ["em_andamento"])]);
    m.emitir([prog("pl:a", "concluido", ["concluido"])]);
    expect(m.timers.length).toBeGreaterThan(0);
    m.store.encerrar();
    expect(m.timers).toHaveLength(0);
    expect(m.ws.ouvintes.size).toBe(0);
    expect(m.assinado()).toBe(false);
  });
});
