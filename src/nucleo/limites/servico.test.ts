import { describe, expect, it } from "vitest";
import type { EventoLimites, LimitSnapshot } from "../../compartilhado/limites";
import type { AdaptadorLimite, ContaLimite } from "./adaptadores/adaptador";
import { criarLimitsService, type Agendador, type DependenciasLimitsService } from "./servico";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");

/** Relógio + agendador falsos: `avancar` dispara os timers vencidos em ordem e deixa as promessas assentarem. */
function relogio() {
  let agora = T0;
  let seq = 0;
  const timers = new Map<number, { em: number; fn: () => void }>();
  const agendador: Agendador = {
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { em: agora + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id as number);
    },
  };
  const assentar = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
  };
  return {
    agendador,
    agora: () => agora,
    pendentes: () => timers.size,
    async avancar(ms: number): Promise<void> {
      const alvo = agora + ms;
      for (;;) {
        const prox = [...timers.entries()].filter(([, t]) => t.em <= alvo).sort((a, b) => a[1].em - b[1].em || a[0] - b[0])[0];
        if (prox === undefined) break;
        timers.delete(prox[0]);
        agora = Math.max(agora, prox[1].em);
        prox[1].fn();
        await assentar();
      }
      agora = alvo;
      await assentar();
    },
    assentar,
  };
}

const conta = (id: string, provedor = "claude"): ContaLimite => ({ id, provedor, rotulo: id, config_dir: null, habilitada: true });
const janela = (pct: number, deltaMin = 120) => ({ kind: "five_hour" as const, used_pct: pct, resets_at: new Date(T0 + deltaMin * 60_000).toISOString() });
function snap(id: string, pct: number, extra: Partial<LimitSnapshot> = {}): LimitSnapshot {
  return { account_id: id, provider: "claude", fetched_at: new Date(T0).toISOString(), fonte: "claude_statusline", confianca: "medido", status: "ok", windows: [janela(pct)], model_buckets: {}, ...extra };
}

interface Montagem {
  rel: ReturnType<typeof relogio>;
  eventos: EventoLimites[];
  deps: DependenciasLimitsService;
  foco: { v: boolean };
  contas: ContaLimite[];
}
function montar(adaptadores: AdaptadorLimite[], contas: ContaLimite[] = [conta("a")], extra: Partial<DependenciasLimitsService> = {}): Montagem {
  const rel = relogio();
  const eventos: EventoLimites[] = [];
  const foco = { v: true };
  const deps: DependenciasLimitsService = { contas: () => contas, adaptadores, agora: rel.agora, agendador: rel.agendador, foco: () => foco.v, emitir: (e) => eventos.push(e), ...extra };
  return { rel, eventos, deps, foco, contas };
}

function fonte(id: string, ler: AdaptadorLimite["ler"], extra: Partial<AdaptadorLimite> = {}): AdaptadorLimite & { chamadas: number } {
  const a = { id, fonte: "claude_statusline" as const, provedores: null, intervalo_min_s: 60, rede: false, aplicavel: () => true, chamadas: 0, ler: async (c: ContaLimite, ctx: Parameters<AdaptadorLimite["ler"]>[1]) => { a.chamadas++; return ler(c, ctx); }, ...extra };
  return a;
}

describe("LimitsService: cache e leitura", () => {
  it("snapshot() é síncrono e devolve desconhecido quando não há dado (nunca 0)", () => {
    const m = montar([fonte("f", async () => null)]);
    const s = criarLimitsService(m.deps);
    const r = s.snapshot();
    expect(r.contas[0]?.slack_pct).toBeNull();
    expect(r.contas[0]?.fonte).toBe("nenhuma");
    expect(r.geral.cobertura).toEqual({ com_dado: 0, total: 1 });
    expect(r.geral.folga_media_pct).toBeNull();
  });

  it("atualizar() lê, normaliza e preenche o cache", async () => {
    const m = montar([fonte("f", async (c) => snap(c.id, 40))]);
    const s = criarLimitsService(m.deps);
    const r = await s.atualizar();
    expect(r.contas[0]?.bottleneck).toBe("five_hour");
    expect(r.contas[0]?.slack_pct).toBe(60);
    expect(s.snapshot().geral.pior?.used_pct).toBe(40);
  });

  it("100 atualizar() seguidos = 1 leitura; depois de 5 s libera outra", async () => {
    const f = fonte("f", async (c) => snap(c.id, 10));
    const m = montar([f]);
    const s = criarLimitsService(m.deps);
    await Promise.all(Array.from({ length: 100 }, () => s.atualizar()));
    for (let i = 0; i < 100; i++) await s.atualizar();
    expect(f.chamadas).toBe(1);
    await m.rel.avancar(5_000);
    await s.atualizar();
    expect(f.chamadas).toBe(2);
  });

  it("adaptador que não se aplica à conta não é chamado; falha de um não derruba os outros", async () => {
    const nao = fonte("nao", async () => snap("a", 1), { aplicavel: () => false });
    const quebra = fonte("quebra", async () => { throw new Error("x"); });
    const ok = fonte("ok", async (c) => snap(c.id, 55));
    const s = criarLimitsService(montar([nao, quebra, ok]).deps);
    const r = await s.atualizar();
    expect(nao.chamadas).toBe(0);
    expect(r.contas[0]?.slack_pct).toBe(45);
  });

  it("adaptador que devolve snapshot de outra conta é corrigido para a conta lida", async () => {
    const s = criarLimitsService(montar([fonte("f", async () => snap("outra", 20))]).deps);
    const r = await s.atualizar();
    expect(r.contas[0]?.account_id).toBe("a");
  });

  it("conta desabilitada fica fora do geral; pedida por id, aparece", async () => {
    const desab = { ...conta("d"), habilitada: false };
    const s = criarLimitsService(montar([fonte("f", async (c) => snap(c.id, 10))], [conta("a"), desab]).deps);
    expect(s.snapshot().contas.map((u) => u.account_id)).toEqual(["a"]);
    expect(s.snapshot(["d"]).contas.map((u) => u.account_id)).toEqual(["d"]);
  });
});

describe("LimitsService: agenda (≤ 1 leitura/conta/60 s, só com foco)", () => {
  it("rajada de marcarSuja: lê na hora a primeira e coalesce o resto numa leitura final aos 60 s", async () => {
    const f = fonte("f", async (c) => snap(c.id, 10));
    const m = montar([f]);
    const s = criarLimitsService(m.deps);
    s.marcarSuja("a");
    await m.rel.assentar();
    expect(f.chamadas).toBe(1);
    for (let i = 0; i < 50; i++) {
      await m.rel.avancar(500);
      s.marcarSuja("a");
    }
    expect(f.chamadas).toBe(1); // 25 s depois: nada novo
    await m.rel.avancar(34_000); // 59 s
    expect(f.chamadas).toBe(1);
    await m.rel.avancar(1_500); // passou dos 60 s
    expect(f.chamadas).toBe(2);
  });

  it("primeira mudança depois de 60 s de calma lê na hora", async () => {
    const f = fonte("f", async (c) => snap(c.id, 10));
    const m = montar([f]);
    const s = criarLimitsService(m.deps);
    s.marcarSuja("a");
    await m.rel.assentar();
    await m.rel.avancar(90_000);
    s.marcarSuja("a");
    await m.rel.assentar();
    expect(f.chamadas).toBe(2);
  });

  it("relógio acelerado: 1 hora com ciclo ligado e 5 contas = no máximo 61 leituras por conta", async () => {
    const f = fonte("f", async (c) => snap(c.id, 10));
    const cs = ["a", "b", "c", "d", "e"].map((i) => conta(i));
    const m = montar([f], cs);
    const s = criarLimitsService(m.deps);
    s.iniciar();
    await m.rel.avancar(3_600_000);
    const est = s.estatisticas();
    for (const c of cs) expect(est.leiturasPorConta[c.id] ?? 0).toBeLessThanOrEqual(61);
    expect(est.leituras).toBeGreaterThanOrEqual(5 * 55);
    s.parar();
  });

  it("sem foco = zero leituras (CT-9.17); ao voltar o foco lê na hora", async () => {
    const f = fonte("f", async (c) => snap(c.id, 10));
    const m = montar([f]);
    m.foco.v = false;
    const s = criarLimitsService(m.deps);
    s.iniciar();
    s.marcarSuja("a");
    await m.rel.avancar(5 * 60_000);
    expect(f.chamadas).toBe(0);
    m.foco.v = true;
    s.aoFocoMudar(true);
    await m.rel.assentar();
    expect(f.chamadas).toBe(1);
    s.parar();
  });

  it("fonte de rede (intervalo 300 s) roda no máximo 1 vez por conta a cada 5 min", async () => {
    const local = fonte("local", async (c) => snap(c.id, 10));
    const rede = fonte("rede", async (c) => snap(c.id, 20, { fonte: "openrouter_api" }), { intervalo_min_s: 300, rede: true });
    const m = montar([local, rede]);
    const s = criarLimitsService(m.deps);
    s.iniciar();
    await m.rel.avancar(30 * 60_000);
    expect(rede.chamadas).toBeLessThanOrEqual(7); // 30 min / 5 min + a inicial
    expect(rede.chamadas).toBeGreaterThanOrEqual(5);
    expect(local.chamadas).toBeGreaterThan(rede.chamadas * 3);
    s.parar();
  });

  it("parar() limpa todos os timers", async () => {
    const m = montar([fonte("f", async (c) => snap(c.id, 90))]);
    const s = criarLimitsService(m.deps);
    s.iniciar();
    s.marcarSuja("a");
    await m.rel.avancar(2_000);
    s.marcarSuja("a");
    s.parar();
    expect(m.rel.pendentes()).toBe(0);
  });
});

describe("LimitsService: timeout e breaker", () => {
  it("adaptador travado é abortado em 2 s sem bloquear os outros", async () => {
    let sinal: AbortSignal | undefined;
    const trava = fonte("trava", (_c, ctx) => { sinal = ctx.sinal; return new Promise(() => undefined); });
    const ok = fonte("ok", async (c) => snap(c.id, 30));
    const m = montar([trava, ok]);
    const s = criarLimitsService(m.deps);
    const p = s.atualizar();
    await m.rel.assentar();
    expect(sinal?.aborted).toBe(false);
    await m.rel.avancar(2_000);
    const r = await p;
    expect(sinal?.aborted).toBe(true);
    expect(r.contas[0]?.slack_pct).toBe(70);
  });

  it("3 falhas seguidas abrem o breaker por 5 min e emitem provedor_indisponivel", async () => {
    const quebra = fonte("quebra", async () => { throw new Error("x"); }, { provedores: ["codex"] });
    const m = montar([quebra], [conta("a", "codex")]);
    const s = criarLimitsService(m.deps);
    for (let i = 0; i < 3; i++) {
      await s.atualizar();
      await m.rel.avancar(6_000);
    }
    expect(m.eventos.filter((e) => e.tipo === "provedor_indisponivel")).toEqual([{ tipo: "provedor_indisponivel", provider: "codex", motivo: expect.stringContaining("quebra") }]);
    const antes = quebra.chamadas;
    await s.atualizar();
    await m.rel.avancar(6_000);
    await s.atualizar();
    expect(quebra.chamadas).toBe(antes); // silêncio
    await m.rel.avancar(5 * 60_000);
    await s.atualizar();
    expect(quebra.chamadas).toBe(antes + 1);
  });

  it("sucesso zera a contagem de falhas", async () => {
    let n = 0;
    const f = fonte("f", async (c) => { n++; if (n % 3 !== 0) throw new Error("x"); return snap(c.id, 5); });
    const m = montar([f]);
    const s = criarLimitsService(m.deps);
    for (let i = 0; i < 9; i++) {
      await s.atualizar();
      await m.rel.avancar(6_000);
    }
    expect(m.eventos.some((e) => e.tipo === "provedor_indisponivel")).toBe(false);
  });
});

describe("LimitsService: merge entre fontes", () => {
  const manual = (pct: number, quando: number): LimitSnapshot => snap("a", pct, { fonte: "manual", confianca: "manual", fetched_at: new Date(quando).toISOString() });

  it("dado mais recente vence: manual novo cobre o medido velho; medido mais novo faz o manual sumir do merge", async () => {
    const tempos = { medido: T0 - 120_000, manual: T0 - 30_000 };
    const med = fonte("med", async (c) => snap(c.id, 20, { fetched_at: new Date(tempos.medido).toISOString() }));
    const man = fonte("man", async () => manual(70, tempos.manual), { fonte: "manual" });
    const m = montar([med, man]);
    const s = criarLimitsService(m.deps);
    await s.atualizar();
    expect(s.usoDe("a").confianca).toBe("manual");
    expect(s.usoDe("a").windows[0]?.used_pct).toBe(70);
    tempos.medido = T0 - 5_000; // chegou um medido mais novo que o valor informado
    await m.rel.avancar(6_000);
    await s.atualizar();
    expect(s.usoDe("a").confianca).toBe("medido");
    expect(s.usoDe("a").windows[0]?.used_pct).toBe(20);
  });

  it("empate de instante: medido > manual > estimado", async () => {
    const s = criarLimitsService(
      montar([
        fonte("est", async (c) => snap(c.id, 90, { fonte: "estimado", confianca: "estimado" })),
        fonte("man", async (c) => snap(c.id, 60, { fonte: "manual", confianca: "manual" })),
        fonte("med", async (c) => snap(c.id, 30)),
      ]).deps,
    );
    await s.atualizar();
    expect(s.usoDe("a").windows[0]?.used_pct).toBe(30);
  });

  it("estimativa nunca cobre dado medido ainda válido, mas preenche a falta dele", async () => {
    const est = fonte("est", async (c) => snap(c.id, 90, { fonte: "estimado", confianca: "estimado", fetched_at: new Date(T0 + 5_000).toISOString() }));
    const med = fonte("med", async (c) => snap(c.id, 30));
    const so = criarLimitsService(montar([est]).deps);
    await so.atualizar();
    expect(so.usoDe("a").confianca).toBe("estimado");
    const com = criarLimitsService(montar([est, med]).deps);
    await com.atualizar();
    expect(com.usoDe("a").windows[0]?.used_pct).toBe(30);
  });

  it("janela vencida do medido não esconde o manual válido", async () => {
    const venc = fonte("venc", async (c) => snap(c.id, 99, { windows: [{ kind: "five_hour", used_pct: 99, resets_at: new Date(T0 - 1000).toISOString() }] }));
    const man = fonte("man", async (c) => snap(c.id, 40, { fonte: "manual", confianca: "manual", fetched_at: new Date(T0 - 60_000).toISOString() }));
    const s = criarLimitsService(montar([venc, man]).deps);
    await s.atualizar();
    expect(s.usoDe("a").windows[0]?.used_pct).toBe(40);
  });

  it("recarregarFonte lê só a fonte pedida, ignorando o limite de 5 s", async () => {
    let valor = 10;
    const man = fonte("manual", async (c) => snap(c.id, valor, { fonte: "manual", confianca: "manual" }), { fonte: "manual" });
    const outra = fonte("outra", async () => null);
    const m = montar([man, outra]);
    const s = criarLimitsService(m.deps);
    await s.atualizar();
    valor = 33;
    const uso = await s.recarregarFonte("a", "manual");
    expect(uso.windows[0]?.used_pct).toBe(33);
    expect(outra.chamadas).toBe(1);
  });
});

describe("LimitsService: eventos", () => {
  it("atualizado é coalescido em 500 ms e lista as contas", async () => {
    const m = montar([fonte("f", async (c) => snap(c.id, 10))], [conta("a"), conta("b")]);
    const s = criarLimitsService(m.deps);
    await s.atualizar();
    expect(m.eventos.filter((e) => e.tipo === "atualizado")).toEqual([]);
    await m.rel.avancar(499);
    expect(m.eventos.filter((e) => e.tipo === "atualizado")).toEqual([]);
    await m.rel.avancar(2);
    expect(m.eventos.filter((e) => e.tipo === "atualizado")).toEqual([{ tipo: "atualizado", contas: ["a", "b"] }]);
  });

  it("leitura sem mudança não gera `atualizado`", async () => {
    const m = montar([fonte("f", async (c) => snap(c.id, 10))]);
    const s = criarLimitsService(m.deps);
    await s.atualizar();
    await m.rel.avancar(1_000);
    m.eventos.length = 0;
    await m.rel.avancar(6_000);
    await s.atualizar();
    await m.rel.avancar(1_000);
    expect(m.eventos).toEqual([]);
  });

  it("consumo_alto ao cruzar 85 subindo, 1 vez; só rearma abaixo de 80 (histerese)", async () => {
    let pct = 50;
    const m = montar([fonte("f", async (c) => snap(c.id, pct))]);
    const s = criarLimitsService(m.deps);
    const altos = () => m.eventos.filter((e) => e.tipo === "consumo_alto");
    const ler = async (p: number) => { pct = p; await m.rel.avancar(6_000); await s.atualizar(); };
    await ler(50);
    await ler(84);
    expect(altos()).toHaveLength(0);
    await ler(86);
    expect(altos()).toEqual([{ tipo: "consumo_alto", conta_id: "a", janela: "five_hour", used_pct: 86 }]);
    await ler(90);
    await ler(83); // dentro da histerese
    await ler(87);
    expect(altos()).toHaveLength(1);
    await ler(79); // rearma
    await ler(88);
    expect(altos()).toHaveLength(2);
  });

  it("primeira leitura já acima do limiar também avisa (conta nasce quente)", async () => {
    const m = montar([fonte("f", async (c) => snap(c.id, 92))]);
    await criarLimitsService(m.deps).atualizar();
    expect(m.eventos.some((e) => e.tipo === "consumo_alto")).toBe(true);
  });

  it("limite_atingido ao cruzar o limiar de esgotamento (medido) e balde de modelo conta como série própria", async () => {
    const m = montar([fonte("f", async (c) => snap(c.id, 40, { model_buckets: { opus: { used_pct: 100, resets_at: new Date(T0 + 3_600_000).toISOString(), kind: "weekly" } } }))]);
    await criarLimitsService(m.deps).atualizar();
    expect(m.eventos).toContainEqual({ tipo: "limite_atingido", conta_id: "a", janela: "modelo", pane_id: null, fonte: "medido" });
    expect(m.eventos).toContainEqual({ tipo: "consumo_alto", conta_id: "a", janela: "modelo", used_pct: 100 });
  });

  it("limiares configuráveis (70 / 95)", async () => {
    const m = montar([fonte("f", async (c) => snap(c.id, 72))], [conta("a")], { limiares: () => ({ troca: 70, esgotamento: 95 }) });
    await criarLimitsService(m.deps).atualizar();
    expect(m.eventos.some((e) => e.tipo === "consumo_alto")).toBe(true);
    expect(m.eventos.some((e) => e.tipo === "limite_atingido")).toBe(false);
  });

  it("registrarLimiteDoPty: evento saida_do_pty e cooldown (hora da frase ou +5 min)", () => {
    const cooldowns: Array<[string, string]> = [];
    const m = montar([], [conta("a")], { marcarCooldown: (id, ate) => cooldowns.push([id, ate]) });
    const s = criarLimitsService(m.deps);
    s.registrarLimiteDoPty({ conta_id: "a", pane_id: "pane_1", reinicia_em: null });
    s.registrarLimiteDoPty({ conta_id: "a", pane_id: null, reinicia_em: new Date(T0 + 3_600_000).toISOString() });
    s.registrarLimiteDoPty({ conta_id: "inexistente", pane_id: null, reinicia_em: null });
    expect(cooldowns).toEqual([["a", new Date(T0 + 300_000).toISOString()], ["a", new Date(T0 + 3_600_000).toISOString()]]);
    expect(m.eventos).toEqual([
      { tipo: "limite_atingido", conta_id: "a", janela: "five_hour", pane_id: "pane_1", fonte: "saida_do_pty" },
      { tipo: "limite_atingido", conta_id: "a", janela: "five_hour", pane_id: null, fonte: "saida_do_pty" },
    ]);
  });

  it("contasMudaram descarta estado de conta removida e lê a nova", async () => {
    const cs = [conta("a")];
    const f = fonte("f", async (c) => snap(c.id, 10));
    const m = montar([f], cs);
    const s = criarLimitsService(m.deps);
    s.iniciar();
    await m.rel.assentar();
    cs.splice(0, 1, conta("b"));
    s.contasMudaram();
    await m.rel.assentar();
    expect(s.snapshot().contas.map((u) => u.account_id)).toEqual(["b"]);
    expect(s.estatisticas().leiturasPorConta["b"]).toBe(1);
    s.parar();
  });
});
