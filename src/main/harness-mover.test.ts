import { describe, expect, it } from "vitest";
import type { Pane, Task } from "../nucleo/dominio/tipos";
import type { PedidoMoverPane } from "../nucleo/harness/troca";
import { criarBarramento } from "./barramento";
import { COOLDOWN_ORIGEM_MS, caminhoDoCheckpoint, criarMoverPane, ligarCheckpoints, type DependenciasMover } from "./harness-mover";

const SEGREDO = "SENTINELA-COFRE-4c2d9e7a11-valor";
const AGORA = Date.parse("2026-10-01T12:00:00Z");

function pane(extra: Partial<Pane> = {}): Pane {
  return { id: "p_old", workspace_id: "ws", mission_id: "m1", cli: "claude", conta_id: "c_a", modelo: null, esforco: null, papel: "executor", eh_piloto: false, estado: "pronto", cwd: ".", agente_id: null, ...extra } as Pane;
}
const task: Task = { id: "t1", mission_id: "m1", task_ref: "t-1", titulo: "Botão", briefing_path: "b.md", papel: "executor", estado: "reivindicada", pane_id: "p_old", handoff_id: null } as Task;
const pedido = (extra: Partial<PedidoMoverPane> = {}): PedidoMoverPane => ({
  pane_id: "p_old",
  workspace_id: "ws",
  de: { conta_id: "c_a", provedor: "claude", modelo: null },
  para: { provedor: "claude", cli: "claude", modelo: null, esforco: null, conta_id: "c_b", faixa: "alto" },
  motivo: "consumo_alto",
  recibo: "Troca feita: consumo 90%. O pensamento da sessão anterior não foi preservado.",
  troca_id: null,
  decisao_id: "d1",
  ...extra,
});

function montar(sobre: { falharAbrir?: boolean; falharEncerrar?: boolean; piloto?: boolean; semMissao?: boolean; cooldownAtual?: string | null } = {}) {
  const panes = new Map<string, Pane>([["p_old", pane({ eh_piloto: sobre.piloto === true, papel: sobre.piloto === true ? "piloto" : "executor", ...(sobre.semMissao === true ? { mission_id: null } : {}) })]]);
  const log: string[] = [];
  const arquivos = new Map<string, string>();
  const rotas = new Map<string, { saltos: number; ultima: string | null; perfil: unknown; decisao_id: string | null }>();
  rotas.set("p_old", { saltos: 1, ultima: null, perfil: { agente_id: null }, decisao_id: "d0" });
  const cooldowns: Array<[string, string | null]> = [];
  let tarefa: Task = { ...task };
  const abertos: unknown[] = [];
  const deps: DependenciasMover = {
    repos: {
      pane: { obter: (id) => panes.get(id) },
      paneRota: {
        obter: (id) => (rotas.has(id) ? ({ pane_id: id, perfil: { agente_id: null, provider: "claude", cli: "claude", modelo: null, esforco: null, faixa: "alto" }, task_type: "implementar", decisao_id: rotas.get(id)?.decisao_id ?? null, saltos: rotas.get(id)?.saltos ?? 0, ultima_troca_em: null, ignorar_sugestao_ate: null, atualizado_em: "" } as never) : undefined),
        gravar: (g) => (rotas.set(g.pane_id, { saltos: g.saltos ?? 0, ultima: null, perfil: g.perfil, decisao_id: g.decisao_id ?? null }), {} as never),
        registrarTroca: (id) => {
          const r = rotas.get(id);
          if (r) rotas.set(id, { ...r, saltos: r.saltos + 1, ultima: "agora" });
          return {} as never;
        },
      },
      contaRoteamento: { obter: () => (sobre.cooldownAtual === undefined ? undefined : { em_cooldown_ate: sobre.cooldownAtual }), definirCooldown: (c, a) => void cooldowns.push([c, a]) },
      conta: { obter: (id) => ({ id, rotulo: id === "c_a" ? "Pessoal" : "Trabalho" }) as never },
      mission: { obter: () => ({ id: "m1", workspace_id: "ws", worktree: null }) as never },
      workspace: { obter: () => ({ id: "ws", raiz: "/tmp/ws" }) as never },
      harnessWorkspace: { obter: () => ({}) as never },
    },
    panes: {
      abrirPane: async (p) => {
        log.push("abrir");
        abertos.push(p);
        if (sobre.falharAbrir === true) throw new Error("sem CLI");
        const novo = pane({ id: "p_new", conta_id: p.conta_id ?? null });
        panes.set("p_new", novo);
        return { pane: novo, sessao_id: "s" };
      },
      encerrarPane: async (id, motivo) => {
        log.push(`encerrar:${id}:${motivo}`);
        if (sobre.falharEncerrar === true && id === "p_old") throw new Error("falha");
        const p = panes.get(id) as Pane;
        panes.set(id, { ...p, estado: "encerrado", encerrado_motivo: motivo } as Pane);
        return panes.get(id) as Pane;
      },
      respawn: async (id) => {
        log.push(`respawn:${id}`);
        return { pane: panes.get(id) as Pane, sessao_id: "s" };
      },
    },
    taskDoPane: (id) => (id === "p_old" && sobre.piloto !== true ? tarefa : id === "p_new" ? undefined : undefined),
    reatribuirTask: (_t, paneId) => {
      log.push(`reatribuir:${paneId}`);
      tarefa = { ...tarefa, pane_id: paneId };
    },
    raiz: () => "/tmp/ws",
    gravar: async (_r, rel, texto) => (arquivos.set(rel, texto), `/tmp/ws/${rel}`),
    ler: async (_r, rel) => arquivos.get(rel) ?? null,
    statusGit: async () => ({ branch: "feat/x", linhas: [" M a.ts"] }),
    tela: async () => ["rodando", `senha ${SEGREDO}`],
    scrub: async () => (t) => t.split(SEGREDO).join("«cofre:K»"),
    existeDiretorio: () => true,
    agora: () => AGORA,
  };
  return { m: criarMoverPane(deps), log, arquivos, rotas, cooldowns, abertos, panes, tarefa: () => tarefa };
}

describe("moverPane", () => {
  it("worker: abre o novo com brief, reata o card, fecha o antigo como superseded, +1 salto e cooldown 5 min", async () => {
    const t = montar();
    const r = await t.m.moverPane(pedido());
    expect(r.novo_pane_id).toBe("p_new");
    expect(t.log).toEqual(["abrir", "reatribuir:p_new", "encerrar:p_old:superseded"]);
    expect(t.tarefa().pane_id).toBe("p_new");
    const aberto = t.abertos[0] as { respawn_de: string; conta_id: string; missao_id: string; contexto: { card: { task_ref: string; briefing_path: string } } };
    expect(aberto).toMatchObject({ respawn_de: "p_old", conta_id: "c_b", missao_id: "m1" });
    expect(aberto.contexto.card.task_ref).toBe("t-1");
    const brief = t.arquivos.get(aberto.contexto.card.briefing_path) ?? "";
    expect(brief).toMatch(/não foi preservado/);
    expect(brief).toContain("Pessoal");
    expect(t.rotas.get("p_new")).toMatchObject({ saltos: 2, decisao_id: "d1" });
    expect(t.cooldowns).toEqual([["c_a", new Date(AGORA + COOLDOWN_ORIGEM_MS).toISOString()]]);
  });

  it("Fase 14: agente LIVRE (sem Missão, com agente de squad) não troca de conta: o novo Pane perderia a permissão e o prompt do membro", async () => {
    const t = montar({ semMissao: true });
    t.panes.set("p_old", pane({ mission_id: null, agente_id: "eq.impl" }));
    await expect(t.m.moverPane(pedido())).rejects.toThrow(/agente livre/i);
    expect(t.log).toEqual([]); // nada aberto, nada fechado, nenhum brief
    expect(t.arquivos.size).toBe(0);
    expect(t.panes.get("p_old")?.estado).toBe("pronto");
  });

  it("o brief nunca leva o valor do cofre (tela lida passa pelo scrubber)", async () => {
    const t = montar();
    await t.m.moverPane(pedido());
    for (const texto of t.arquivos.values()) expect(texto).not.toContain(SEGREDO);
    expect([...t.arquivos.values()].join("\n")).toContain("«cofre:K»");
  });

  it("usa o último checkpoint gravado quando existe", async () => {
    const t = montar();
    t.arquivos.set(caminhoDoCheckpoint("m1", "p_old"), "# Checkpoint do turno\n\nMARCA-DO-CHECKPOINT");
    await t.m.moverPane(pedido());
    expect([...t.arquivos.entries()].find(([k]) => k.includes("briefs"))?.[1]).toContain("MARCA-DO-CHECKPOINT");
  });

  it("falha ao abrir o novo: o antigo fica intacto (nada fechado, card não reatado, sem cooldown)", async () => {
    const t = montar({ falharAbrir: true });
    await expect(t.m.moverPane(pedido())).rejects.toThrow("sem CLI");
    expect(t.log).toEqual(["abrir"]);
    expect(t.tarefa().pane_id).toBe("p_old");
    expect(t.cooldowns).toEqual([]);
    expect(t.panes.get("p_old")?.estado).toBe("pronto");
  });

  it("falha ao fechar o antigo: desfaz (card volta, novo é encerrado) e propaga", async () => {
    const t = montar({ falharEncerrar: true });
    await expect(t.m.moverPane(pedido())).rejects.toThrow("falha");
    expect(t.log).toEqual(["abrir", "reatribuir:p_new", "encerrar:p_old:superseded", "reatribuir:p_old", "encerrar:p_new:troca_desfeita"]);
    expect(t.tarefa().pane_id).toBe("p_old");
    expect(t.cooldowns).toEqual([]);
  });

  it("piloto: fecha o antigo antes; se o novo não abre, reabre o antigo", async () => {
    const ok = montar({ piloto: true });
    await ok.m.moverPane(pedido());
    expect(ok.log.slice(0, 2)).toEqual(["encerrar:p_old:superseded", "abrir"]);
    expect((ok.abertos[0] as { prompt_inicial: string }).prompt_inicial).toMatch(/Leia .*retomada/);
    const ruim = montar({ piloto: true, falharAbrir: true });
    await expect(ruim.m.moverPane(pedido())).rejects.toThrow("sem CLI");
    expect(ruim.log).toEqual(["encerrar:p_old:superseded", "abrir", "respawn:p_old"]);
  });

  it("Pane fora de Missão: prompt inicial curto aponta o brief e não há card", async () => {
    const t = montar({ semMissao: true });
    await t.m.moverPane(pedido());
    const aberto = t.abertos[0] as { workspace_id: string; prompt_inicial: string; contexto?: unknown };
    expect(aberto.workspace_id).toBe("ws");
    expect(aberto.contexto).toBeUndefined();
    expect(aberto.prompt_inicial).toContain("retomada");
  });

  it("cooldown já mais longo (até o reset) não é encurtado", async () => {
    const t = montar({ cooldownAtual: new Date(AGORA + 3 * 3_600_000).toISOString() });
    await t.m.moverPane(pedido());
    expect(t.cooldowns).toEqual([]);
  });

  it("Pane inexistente ou encerrado: erro sem efeito", async () => {
    const t = montar();
    await expect(t.m.moverPane(pedido({ pane_id: "nao_existe" }))).rejects.toThrow();
    expect(t.log).toEqual([]);
  });
});

describe("ligarCheckpoints", () => {
  it("fim de turno grava; encerrar libera; outros estados não gravam", async () => {
    const b = criarBarramento();
    const chamadas: string[] = [];
    const desligar = ligarCheckpoints(b, { aoFimDoTurno: async (id) => (chamadas.push(`fim:${id}`), "gravado"), liberar: (id) => void chamadas.push(`lib:${id}`) });
    b.emitir("pane.state_changed", { pane_id: "p", estado: "trabalhando" });
    b.emitir("pane.state_changed", { pane_id: "p", estado: "pronto" });
    b.emitir("pane.closed", { pane_id: "p" });
    desligar();
    b.emitir("pane.state_changed", { pane_id: "p", estado: "pronto" });
    expect(chamadas).toEqual(["fim:p", "lib:p"]);
  });
});
