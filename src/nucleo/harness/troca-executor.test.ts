import { describe, expect, it } from "vitest";
import type { ConfigHarness, DecisaoEntrada, EventoHarness } from "../../compartilhado/harness";
import type { NovaTroca, RegistroTroca } from "../banco/repos/troca-log";
import { AGORA } from "../../../tests/fixtures/harness/construtores";
import { config } from "../../../tests/fixtures/harness/rotas";
import { mundoT, paneT, quente, type SpecConta } from "../../../tests/fixtures/harness/troca";
import { ESPERA_APOS_FALHA_MS, ErroTroca, SILENCIO_SUGESTAO_MS, criarExecutorTroca, type AvisoTroca, type EntradaAvaliacao, type EstadoDoMundo, type PaneParaTroca, type PedidoMoverPane } from "./troca";
import { trocaParaLog } from "./recibo";

const cl = (id: string, x = quente(10)): SpecConta => [id, "claude", x];
const cx = (id: string, x = quente(10)): SpecConta => [id, "codex", x];
const MIN = 60_000;

/** Mundo falso e mutável: o teste muda `panes`, `usos`, `agora` e o executor lê de novo a cada ciclo. */
function cenario(inicial: { contas: SpecConta[]; panes?: Array<Partial<PaneParaTroca>>; cfg?: Partial<ConfigHarness>; mundo?: Partial<EstadoDoMundo>; semMover?: boolean; moverFalha?: string }) {
  const est = {
    agora: AGORA,
    contas: inicial.contas,
    panes: (inicial.panes ?? [{}]).map((p) => paneT(p)),
    cfg: inicial.cfg ?? {},
    mundo: inicial.mundo ?? {},
    moverFalha: inicial.moverFalha ?? null,
  };
  const linhas: RegistroTroca[] = [];
  const decisoes: DecisaoEntrada[] = [];
  const eventos: EventoHarness[] = [];
  const avisos: AvisoTroca[] = [];
  const movidos: PedidoMoverPane[] = [];
  const silencios: Array<[string, string]> = [];
  let seq = 0;
  const ler = (): EntradaAvaliacao => {
    const { usos, mundo } = mundoT(est.contas, est.mundo);
    return { panes: est.panes, usos, config: config(est.cfg), mundo };
  };
  const exec = criarExecutorTroca({
    agora: () => est.agora,
    lerMundo: () => ler(),
    registrarDecisao: (d) => {
      decisoes.push(d);
      return { id: `dec_${decisoes.length}` };
    },
    inserirTroca: (n: NovaTroca) => {
      const id = `trc_${++seq}`;
      const r = { ...(n as unknown as RegistroTroca), id, criado_em: new Date(est.agora).toISOString(), adiada_por: n.adiada_por ?? null, mission_id: n.mission_id ?? null, task_ref: n.task_ref ?? null, pane_novo_id: n.pane_novo_id ?? null, faixa: n.faixa ?? null, decisao_id: n.decisao_id ?? null, consumo_origem_pct: n.consumo_origem_pct ?? null, consumo_destino_pct: n.consumo_destino_pct ?? null } as RegistroTroca;
      linhas.push(r);
      return r;
    },
    atualizarTroca: (id, status, extra = {}) => {
      const i = linhas.findIndex((l) => l.id === id);
      if (i < 0) throw new Error("sem linha");
      const atual = linhas[i] as RegistroTroca;
      linhas[i] = { ...atual, status, adiada_por: status === "adiada" ? (extra.adiada_por ?? null) : null, pane_novo_id: extra.pane_novo_id ?? atual.pane_novo_id, recibo: extra.recibo ?? atual.recibo };
      return linhas[i] as RegistroTroca;
    },
    obterTroca: (id) => linhas.find((l) => l.id === id),
    ...(inicial.semMover
      ? {}
      : {
          moverPane: async (p: PedidoMoverPane) => {
            if (est.moverFalha) throw new Error(est.moverFalha);
            movidos.push(p);
            return { novo_pane_id: `${p.pane_id}_novo` };
          },
        }),
    ignorarSugestaoAte: (pane, ate) => silencios.push([pane, ate]),
    avisar: (a) => avisos.push(a),
    emitir: (e) => eventos.push(e),
    rotulos: () => ({ c1: "Conta 1", c2: "Conta 2" }),
  });
  return { est, exec, linhas, decisoes, eventos, avisos, movidos, silencios };
}
const status = (l: RegistroTroca[]): string[] => l.map((x) => x.status);

describe("executor: modo automático (CT-9.18)", () => {
  it("troca no ponto seguro: move, grava Decision(troca) e troca_log feita, avisa e emite", async () => {
    const c = cenario({ contas: [cl("c1", quente(87)), cl("c2", quente(20))] });
    const r = await c.exec.ciclo("ws1");
    expect(r).toMatchObject({ avaliadas: 1, executadas: 1, falhas: 0 });
    expect(c.movidos).toHaveLength(1);
    expect(c.movidos[0]).toMatchObject({ pane_id: "p1", motivo: "consumo_alto", para: { provedor: "claude", conta_id: "c2" } });
    expect(c.movidos[0]?.recibo).toMatch(/pensamento/i);
    expect(status(c.linhas)).toEqual(["feita"]);
    expect(c.linhas[0]).toMatchObject({ consumo_origem_pct: 87, consumo_destino_pct: 20, pane_novo_id: "p1_novo", modo: "automatico", tipo_troca: "outra_conta", decisao_id: "dec_1" });
    expect(c.decisoes).toHaveLength(1);
    const d = c.decisoes[0] as DecisaoEntrada;
    expect(d).toMatchObject({ proposito: "troca", fonte: "regra", decisor: null, resumo_enviado: null, pane_id: "p1" });
    expect(d.opcoes).toContain(d.escolhida);
    expect(c.eventos).toEqual([{ tipo: "troca_feita", troca_id: "trc_1", pane_antigo_id: "p1", pane_novo_id: "p1_novo" }]);
    expect(c.avisos.map((a) => a.tipo)).toEqual(["feita"]);
  });
  it("não troca de novo no ciclo seguinte quando o Pane novo já saiu do gatilho", async () => {
    const c = cenario({ contas: [cl("c1", quente(87)), cl("c2", quente(20))] });
    await c.exec.ciclo("ws1");
    c.est.panes = [paneT({ pane_id: "p1", conta_id: "c2", saltos: 1, ultima_troca_em: AGORA })];
    const r = await c.exec.ciclo("ws1");
    expect(r.avaliadas).toBe(0);
    expect(c.movidos).toHaveLength(1);
  });
  it("dois ciclos concorrentes executam uma única troca", async () => {
    const c = cenario({ contas: [cl("c1", quente(87)), cl("c2", quente(20))] });
    await Promise.all([c.exec.ciclo("ws1"), c.exec.ciclo("ws1")]);
    expect(c.movidos).toHaveLength(1);
    expect(c.linhas.filter((l) => l.status === "feita")).toHaveLength(1);
  });
  it("falha no movimento: log `falhou`, Pane antigo intacto, aviso, e espera antes de tentar de novo", async () => {
    const c = cenario({ contas: [cl("c1", quente(87)), cl("c2", quente(20))], moverFalha: "pty indisponível" });
    const r = await c.exec.ciclo("ws1");
    expect(r).toMatchObject({ executadas: 0, falhas: 1 });
    expect(status(c.linhas)).toEqual(["falhou"]);
    expect(c.linhas[0]?.recibo).toMatch(/pty indisponível/);
    expect(c.est.panes[0]).toMatchObject({ pane_id: "p1", conta_id: "c1", estado: "pronto" });
    expect(c.eventos.map((e) => e.tipo)).toEqual(["troca_falhou"]);
    expect(c.avisos.map((a) => a.tipo)).toEqual(["falhou"]);
    // não repete a tentativa antes do prazo
    c.est.agora += MIN;
    await c.exec.ciclo("ws1");
    expect(c.linhas).toHaveLength(1);
    // depois do prazo, tenta de novo e reaproveita a mesma linha
    c.est.agora += ESPERA_APOS_FALHA_MS;
    c.est.moverFalha = null;
    const r2 = await c.exec.ciclo("ws1");
    expect(r2.executadas).toBe(1);
    expect(status(c.linhas)).toEqual(["feita"]);
  });
  it("sem a porta de movimento (T-09.18 ainda não ligada): registra `falhou` e não mexe em nada", async () => {
    const c = cenario({ contas: [cl("c1", quente(87)), cl("c2", quente(20))], semMover: true });
    await c.exec.ciclo("ws1");
    expect(status(c.linhas)).toEqual(["falhou"]);
    expect(c.est.panes[0]?.conta_id).toBe("c1");
  });
});

describe("executor: modo só sugerir (CT-9.19)", () => {
  const base = () => cenario({ contas: [cl("c1", quente(88)), cl("x1", quente(10)).map((x) => x) as unknown as SpecConta].slice(0, 1).concat([["x1", "codex", quente(10)]]), cfg: { modo_troca: "so_sugerir" } });
  it("só propõe: grava `sugerida`, avisa, emite e não move", async () => {
    const c = base();
    const r = await c.exec.ciclo("ws1");
    expect(r.sugeridas).toBe(1);
    expect(c.movidos).toHaveLength(0);
    expect(status(c.linhas)).toEqual(["sugerida"]);
    expect(c.linhas[0]).toMatchObject({ tipo_troca: "outro_provedor", modo: "so_sugerir" });
    expect(c.eventos).toEqual([{ tipo: "troca_sugerida", troca_id: "trc_1", pane_id: "p1" }]);
    expect(c.avisos.map((a) => a.tipo)).toEqual(["sugerida"]);
    expect(c.decisoes).toHaveLength(1);
  });
  it("ciclos repetidos não duplicam a sugestão nem o aviso", async () => {
    const c = base();
    await c.exec.ciclo("ws1");
    await c.exec.ciclo("ws1");
    await c.exec.ciclo("ws1");
    expect(c.linhas).toHaveLength(1);
    expect(c.avisos).toHaveLength(1);
    expect(c.decisoes).toHaveLength(1);
  });
  it("aceitar executa no ponto seguro e atualiza a MESMA linha para `feita`", async () => {
    const c = base();
    await c.exec.ciclo("ws1");
    const t = await c.exec.decidir("trc_1", "aceitar");
    expect(t.status).toBe("feita");
    expect(c.linhas).toHaveLength(1);
    expect(c.movidos).toHaveLength(1);
    expect(c.movidos[0]?.para.provedor).toBe("codex");
    expect(c.linhas[0]?.pane_novo_id).toBe("p1_novo");
  });
  it("aceitar com o Pane trabalhando fica aguardando e executa no primeiro ponto seguro", async () => {
    const c = base();
    c.est.panes = [paneT({ estado: "trabalhando" })];
    await c.exec.ciclo("ws1");
    const t = await c.exec.decidir("trc_1", "aceitar");
    expect(t).toMatchObject({ status: "adiada", adiada_por: "trabalhando" });
    expect(c.movidos).toHaveLength(0);
    await c.exec.ciclo("ws1");
    expect(c.movidos).toHaveLength(0);
    c.est.panes = [paneT({ estado: "pronto" })];
    const r = await c.exec.ciclo("ws1");
    expect(r.executadas).toBe(1);
    expect(status(c.linhas)).toEqual(["feita"]);
  });
  it("aceitar quando o consumo já baixou: vira `ignorada`, nada é movido", async () => {
    const c = base();
    await c.exec.ciclo("ws1");
    c.est.contas = [cl("c1", quente(30)), ["x1", "codex", quente(10)]];
    const t = await c.exec.decidir("trc_1", "aceitar");
    expect(t.status).toBe("ignorada");
    expect(c.movidos).toHaveLength(0);
  });
  it("ignorar: status `ignorada` e silêncio de 30 min gravado", async () => {
    const c = base();
    await c.exec.ciclo("ws1");
    const t = await c.exec.decidir("trc_1", "ignorar");
    expect(t.status).toBe("ignorada");
    expect(c.silencios).toEqual([["p1", new Date(AGORA + SILENCIO_SUGESTAO_MS).toISOString()]]);
  });
  it("adiar 30 min: status `adiada` sem motivo de bloqueio", async () => {
    const c = base();
    await c.exec.ciclo("ws1");
    const t = await c.exec.decidir("trc_1", "adiar_30min");
    expect(t).toMatchObject({ status: "adiada", adiada_por: null });
    expect(c.silencios).toHaveLength(1);
  });
  it("troca inexistente: erro nominal", async () => {
    const c = base();
    await expect(c.exec.decidir("trc_zzz", "aceitar")).rejects.toMatchObject({ codigo: "troca_nao_encontrada" });
  });
  it("sugestão cujo gatilho sumiu é arquivada como `ignorada`", async () => {
    const c = base();
    await c.exec.ciclo("ws1");
    c.est.contas = [cl("c1", quente(30)), ["x1", "codex", quente(10)]];
    await c.exec.ciclo("ws1");
    expect(status(c.linhas)).toEqual(["ignorada"]);
  });
});

describe("executor: espera e bloqueios (CT-9.20)", () => {
  it("trabalhando: registra `adiada` uma vez, não move; ao ficar pronto executa na MESMA linha", async () => {
    const c = cenario({ contas: [cl("c1", quente(87)), cl("c2", quente(20))], panes: [{ estado: "trabalhando" }] });
    await c.exec.ciclo("ws1");
    await c.exec.ciclo("ws1");
    expect(status(c.linhas)).toEqual(["adiada"]);
    expect(c.linhas[0]?.adiada_por).toBe("trabalhando");
    expect(c.movidos).toHaveLength(0);
    expect(c.exec.temPendencias()).toBe(true);
    c.est.panes = [paneT({ estado: "pronto" })];
    await c.exec.ciclo("ws1");
    expect(status(c.linhas)).toEqual(["feita"]);
    expect(c.movidos).toHaveLength(1);
  });
  it("operação git em curso: nunca move, mesmo com o limite batido; ao terminar, move", async () => {
    const c = cenario({ contas: [cl("c1", quente(100)), cl("c2", quente(20))], mundo: { operacaoGit: new Set(["p1"]) } });
    for (let i = 0; i < 5; i++) {
      c.est.agora += 2 * MIN;
      await c.exec.ciclo("ws1");
    }
    expect(c.movidos).toHaveLength(0);
    c.est.mundo = {};
    await c.exec.ciclo("ws1");
    expect(c.movidos).toHaveLength(1);
  });
  it("handoff em voo e pergunta pendente adiam com o motivo certo", async () => {
    const a = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(20))], mundo: { handoffEmVoo: new Set(["p1"]) } });
    await a.exec.ciclo("ws1");
    expect(a.linhas[0]?.adiada_por).toBe("handoff_em_voo");
    const b = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(20))], mundo: { perguntaPendente: new Set(["p1"]) } });
    await b.exec.ciclo("ws1");
    expect(b.linhas[0]?.adiada_por).toBe("pergunta_pendente");
    expect(a.movidos.length + b.movidos.length).toBe(0);
  });
  it("vencida a espera (600 s), o adiado vira sugestão visível e continua sem mover", async () => {
    const c = cenario({ contas: [cl("c1", quente(87)), cl("c2", quente(20))], panes: [{ estado: "trabalhando" }] });
    await c.exec.ciclo("ws1");
    c.est.agora += 601_000;
    const r = await c.exec.ciclo("ws1");
    expect(r.sugeridas).toBe(1);
    expect(status(c.linhas)).toEqual(["sugerida"]);
    expect(c.eventos.map((e) => e.tipo)).toEqual(["troca_sugerida"]);
    expect(c.movidos).toHaveLength(0);
  });
});

describe("executor: sem alternativa (CT-9.21)", () => {
  it("permanece, avisa uma vez por 30 min e não grava troca nem Decision", async () => {
    const c = cenario({ contas: [cl("c1", quente(87))], mundo: { provedoresViaveis: ["claude"] } });
    await c.exec.ciclo("ws1");
    await c.exec.ciclo("ws1");
    expect(c.avisos.map((a) => a.tipo)).toEqual(["sem_alternativa"]);
    expect(c.linhas).toHaveLength(0);
    expect(c.decisoes).toHaveLength(0);
    expect(c.movidos).toHaveLength(0);
    c.est.agora += SILENCIO_SUGESTAO_MS;
    await c.exec.ciclo("ws1");
    expect(c.avisos).toHaveLength(2);
  });
  it("esgotada: aviso de capacidade e Pane intacto", async () => {
    const c = cenario({ contas: [cl("c1", quente(100))], mundo: { provedoresViaveis: ["claude"] } });
    await c.exec.ciclo("ws1");
    expect(c.avisos[0]?.texto).toMatch(/capacidade/i);
    expect(c.est.panes[0]?.conta_id).toBe("c1");
  });
});

describe("executor: modo manual", () => {
  it("o ciclo não sugere nem move nada", async () => {
    const c = cenario({ contas: [cl("c1", quente(97)), cl("c2", quente(10))], cfg: { modo_troca: "manual" } });
    const r = await c.exec.ciclo("ws1");
    expect(r.avaliadas).toBe(0);
    expect(c.linhas).toHaveLength(0);
    expect(c.avisos).toHaveLength(0);
  });
  it("o botão `mover` continua funcionando (ignora o modo)", async () => {
    const c = cenario({ contas: [cl("c1", quente(30)), cl("c2", quente(10))], cfg: { modo_troca: "manual" } });
    const r = await c.exec.mover({ pane_id: "p1", workspace_id: "ws1", force: true });
    expect(r).toMatchObject({ novo_pane_id: "p1_novo", de: { conta_id: "c1" }, para: { conta_id: "c2" } });
    expect(c.linhas[0]).toMatchObject({ status: "feita", motivo: "manual" });
  });
});

describe("executor: mover / account_switch (mesmo caminho do botão)", () => {
  it("not_at_limit sem force; com force troca", async () => {
    const c = cenario({ contas: [cl("c1", quente(40)), cl("c2", quente(10))] });
    await expect(c.exec.mover({ pane_id: "p1", workspace_id: "ws1" })).rejects.toMatchObject({ codigo: "not_at_limit" });
    expect(c.movidos).toHaveLength(0);
    const r = await c.exec.mover({ pane_id: "p1", workspace_id: "ws1", force: true });
    expect(r.para.conta_id).toBe("c2");
  });
  it("sem force e com a conta no gatilho: troca", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(10))] });
    const r = await c.exec.mover({ pane_id: "p1", workspace_id: "ws1" });
    expect(r.para.conta_id).toBe("c2");
    expect(c.decisoes[0]).toMatchObject({ proposito: "troca" });
  });
  it("conta alvo de outro provedor com a troca entre provedores desligada: provider_mismatch", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cx("x1")], cfg: { troca_entre_provedores: false } });
    await expect(c.exec.mover({ pane_id: "p1", workspace_id: "ws1", conta_alvo_id: "x1" })).rejects.toMatchObject({ codigo: "provider_mismatch" });
    expect(c.movidos).toHaveLength(0);
  });
  it("conta alvo de outro provedor permitida: usa exatamente a conta pedida", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cx("x1", quente(30)), cx("x2", quente(5))] });
    const r = await c.exec.mover({ pane_id: "p1", workspace_id: "ws1", conta_alvo_id: "x1" });
    expect(r.para).toMatchObject({ provedor: "codex", conta_id: "x1" });
  });
  it("conta alvo inexistente, desabilitada ou igual à atual: no_account_available", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(10))] });
    for (const alvo of ["zzz", "c1"]) await expect(c.exec.mover({ pane_id: "p1", workspace_id: "ws1", conta_alvo_id: alvo })).rejects.toMatchObject({ codigo: "no_account_available" });
  });
  it("no_capacity quando não há destino; Pane intacto", async () => {
    const c = cenario({ contas: [cl("c1", quente(100))], mundo: { provedoresViaveis: ["claude"] } });
    await expect(c.exec.mover({ pane_id: "p1", workspace_id: "ws1" })).rejects.toMatchObject({ codigo: "no_capacity" });
    expect(c.linhas).toHaveLength(0);
  });
  it("limit_reached no teto de saltos", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(10))], panes: [{ saltos: 3 }] });
    await expect(c.exec.mover({ pane_id: "p1", workspace_id: "ws1", force: true })).rejects.toMatchObject({ codigo: "limit_reached" });
  });
  it("operação git em curso recusa, a menos que o risco seja confirmado", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(10))], mundo: { operacaoGit: new Set(["p1"]) } });
    await expect(c.exec.mover({ pane_id: "p1", workspace_id: "ws1", force: true })).rejects.toMatchObject({ codigo: "operacao_em_curso" });
    const r = await c.exec.mover({ pane_id: "p1", workspace_id: "ws1", force: true, confirmouRisco: true });
    expect(r.novo_pane_id).toBe("p1_novo");
  });
  it("Pane inexistente: pane_nao_encontrado", async () => {
    const c = cenario({ contas: [cl("c1", quente(90))] });
    await expect(c.exec.mover({ pane_id: "nada", workspace_id: "ws1" })).rejects.toBeInstanceOf(ErroTroca);
  });
  it("falha do movimento manual: lança `falhou`, linha `falhou`, Pane intacto", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(10))], moverFalha: "sem terminal" });
    await expect(c.exec.mover({ pane_id: "p1", workspace_id: "ws1" })).rejects.toMatchObject({ codigo: "falhou" });
    expect(status(c.linhas)).toEqual(["falhou"]);
    expect(c.est.panes[0]?.conta_id).toBe("c1");
  });
  it("a Decisão da troca nunca leva dado do decisor e cita só rótulos (sem ids longos)", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(10))] });
    await c.exec.mover({ pane_id: "p1", workspace_id: "ws1" });
    const d = c.decisoes[0] as DecisaoEntrada;
    expect(d.decisor).toBeNull();
    expect(d.resumo_enviado).toBeNull();
    expect(d.opcoes.some((o) => o.includes("Conta 2"))).toBe(true);
  });
});

describe("recibo/log: contrato do trocaParaLog continua válido", () => {
  it("o NovaTroca montado pelo executor tem recibo sem segredo", async () => {
    const c = cenario({ contas: [cl("c1", quente(90)), cl("c2", quente(10))] });
    await c.exec.ciclo("ws1");
    expect(c.linhas[0]?.recibo.length).toBeGreaterThan(20);
    expect(c.linhas[0]?.recibo).not.toMatch(/sk-|Bearer|\/Users\//);
    expect(typeof trocaParaLog).toBe("function");
  });
});
