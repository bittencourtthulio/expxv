import { describe, expect, it } from "vitest";
import { trab } from "../../../tests/fixtures/metodo/construtores";
import { ESTADOS_PIPELINE, type EstadoPipeline, type EtapaExec, type EtapaId, type NivelRigidez, type PipelineEstado, type PipelineId } from "../../compartilhado/maestro";
import type { EstadoPane } from "../dominio/enums";
import { SONDA_VAZIA, type SondaDeDisco, type TrabalhoParaMaestro } from "./etapas/conclusao";
import { aplicarAcaoDoUsuario, avancar, criarExecs, ehTerminal, novoPipeline, resumoDoPipeline, transicaoValida, voltasPermitidas, type ObservacaoDoDisco } from "./maquina";
import { planejar } from "./planejar";
import { EVIDENCIA_VAZIA, type EvidenciaDoDisco } from "./rigidez/plano-de-etapas";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const intencaoDe: Record<string, "bug" | "feature" | "pedido" | "entrega"> = { runx: "bug", sprintx: "feature", prodx: "pedido", mergex: "entrega" };
function criar(pipeline: PipelineId, nivel: NivelRigidez, ev: Partial<EvidenciaDoDisco> = {}, permissao: "seguro" | "equilibrado" | "automatico" = "automatico"): PipelineEstado {
  const plano = planejar({ intencao: intencaoDe[pipeline] ?? "bug", confianca: 0.9, candidatas: [], retomar: null, fonte: "regra" }, nivel, { id: "mpl_1", agora_ms: T0, evidencia: { ...EVIDENCIA_VAZIA, ...ev }, permissao });
  const p = novoPipeline({ id: "mpl_1", workspace_id: "w", mission_id: null, trabalho_id: null, pipeline_id: plano.pipeline_id, intencao: plano.intencao, via: "api", origem_pane_id: null, texto_hash: "h", texto_resumo: "r", nivel_base: nivel, nivel_atual: nivel, nivel_pedido: null, executar_direto: false, voltar_ao_padrao: false, plano, criado_em: new Date(T0).toISOString(), atualizado_em: new Date(T0).toISOString(), override_trava: false } as never, T0);
  return { ...p, estado: "executando" };
}
const obs = (o: Partial<ObservacaoDoDisco> = {}): ObservacaoDoDisco => ({ agora_ms: T0, trabalho: null, sondas: SONDA_VAZIA, panes: {}, max_terminais: 4, timeout_sem_progresso_ms: 30 * 60_000, fechar_concluidos: true, ...o });
const oc = (estagio: string, o: Record<string, unknown> = {}): TrabalhoParaMaestro => trab({ tipo: "ocorrencia", ferramenta: "runx", id: "OC-2026-0142-x", pasta: "docs/manutencao/OC-2026-0142-x", estagio, veredito_qa: null, ...o });
const ex = (p: PipelineEstado, e: string): EtapaExec[] => p.execs.filter((x) => x.etapa_id === e);
const panes = (m: Record<string, EstadoPane>): ObservacaoDoDisco["panes"] => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { estado: v }]));
/** simula o serviço: marca a exec despachada como executando num Pane. */
function comoDespachada(p: PipelineEstado, etapa: EtapaId, pane: string, rodada = 1): PipelineEstado {
  return { ...p, execs: p.execs.map((e) => (e.etapa_id === etapa && e.rodada === rodada && e.estado === "despachando" ? { ...e, estado: "executando", pane_id: pane } : e)) };
}

describe("transições do pipeline", () => {
  const VALIDAS: Record<EstadoPipeline, EstadoPipeline[]> = {
    proposto: ["executando", "cancelado", "expirado"],
    executando: ["aguardando_humano", "aguardando_usuario", "aguardando_confirmacao", "bloqueado_piso", "bloqueado_trava", "pausado", "concluido", "concluido_parcial", "falhou", "cancelado"],
    aguardando_humano: ["executando", "pausado", "cancelado", "concluido", "concluido_parcial", "falhou"],
    aguardando_usuario: ["executando", "pausado", "cancelado", "falhou"],
    aguardando_confirmacao: ["executando", "pausado", "cancelado"],
    bloqueado_piso: ["executando", "pausado", "cancelado", "falhou"],
    bloqueado_trava: ["executando", "pausado", "cancelado"],
    pausado: ["executando", "cancelado"],
    concluido: [], concluido_parcial: [], falhou: [], cancelado: [], expirado: [],
  };
  it("tabela completa: as válidas passam e todas as outras são recusadas (13 × 13)", () => {
    for (const de of ESTADOS_PIPELINE) for (const para of ESTADOS_PIPELINE) {
      const esperado = de === para || VALIDAS[de].includes(para);
      expect(transicaoValida(de, para), `${de} → ${para}`).toBe(esperado);
    }
  });
  it("estados terminais não saem; ehTerminal", () => {
    for (const t of ["concluido", "concluido_parcial", "falhou", "cancelado", "expirado"] as const) {
      expect(ehTerminal(t)).toBe(true);
      for (const para of ESTADOS_PIPELINE) if (para !== t) expect(transicaoValida(t, para)).toBe(false);
    }
    expect(ehTerminal("executando")).toBe(false);
  });
});

describe("avancar: início e pré-requisitos", () => {
  it("proposto não anda; expira em 30 min com notificação", () => {
    const p = { ...criar("runx", 3), estado: "proposto" as const };
    expect(avancar(p, obs())).toMatchObject({ mudou: false, acoes: [] });
    const r = avancar(p, obs({ agora_ms: T0 + 31 * 60_000 }));
    expect(r.pipeline.estado).toBe("expirado");
    expect(r.pipeline.concluido_em).not.toBeNull();
    expect(r.acoes).toEqual([{ tipo: "notificar", motivo: "expirado", etapa_id: null, detalhe: expect.any(String) }]);
  });
  it("terminal e pausado são no-op", () => {
    for (const estado of ["concluido", "falhou", "cancelado", "expirado", "pausado"] as const) {
      const p = { ...criar("runx", 3), estado };
      expect(avancar(p, obs())).toEqual({ pipeline: p, acoes: [], mudou: false });
    }
  });
  it("primeira chamada: consulta inline (sem terminal) e despacha a etapa 1 com o papel certo", () => {
    const r = avancar(criar("runx", 3), obs());
    expect(r.acoes.map((a) => a.tipo)).toEqual(["consultar", "despachar"]);
    expect(r.acoes[1]).toMatchObject({ etapa_id: "runx.e1", papel: "explorador", reusar_pane_id: null, tentativa: 1, rodada: 1, nivel: 3 });
    expect(ex(r.pipeline, "memox.consultar")[0]?.estado).toBe("concluida");
    expect(ex(r.pipeline, "runx.e1")[0]?.estado).toBe("despachando");
    expect(r.pipeline.estado).toBe("executando");
  });
  it("não despacha duas etapas ao mesmo tempo: enquanto uma está em voo, nada novo", () => {
    const r1 = avancar(criar("runx", 3), obs());
    const p = comoDespachada(r1.pipeline, "runx.e1", "p1");
    const r2 = avancar(p, obs({ panes: panes({ p1: "trabalhando" }) }));
    expect(r2.acoes).toEqual([]);
    expect(r2.mudou).toBe(false);
  });
  it("idempotente: avançar de novo sobre o resultado não repete ações", () => {
    const a = avancar(criar("runx", 3), obs());
    const b = avancar(a.pipeline, obs());
    expect(b.acoes.filter((x) => x.tipo === "despachar")).toEqual([]);
  });
  it("pura: não muta a entrada", () => {
    const p = criar("runx", 3);
    const copia = JSON.stringify(p);
    avancar(p, obs());
    expect(JSON.stringify(p)).toBe(copia);
  });
});

describe("avancar: paradas humanas e confirmações", () => {
  it("prodx: p0 → p25 → assinatura humana: nunca despacha a assinatura", () => {
    let p = criar("prodx", 3);
    p = { ...p, execs: p.execs.map((e) => (e.etapa_id === "prodx.p0" || e.etapa_id === "prodx.p25" ? { ...e, estado: "concluida" as const } : e)) };
    const r = avancar(p, obs({ trabalho: trab({ tipo: "pedido", ferramenta: "prodx", id: "PD-1", estagio: "p5", prodx: { veredito: "fazer", assinado: false, briefing: false } }) }));
    expect(r.pipeline.estado).toBe("aguardando_humano");
    expect(ex(r.pipeline, "prodx.assinatura")[0]?.estado).toBe("aguardando_humano");
    expect(r.acoes).toEqual([{ tipo: "notificar", motivo: "humano", etapa_id: "prodx.assinatura", detalhe: expect.stringMatching(/assine/) }]);
    expect(r.acoes.some((a) => a.tipo === "despachar")).toBe(false);
  });
  it("assinada no disco ⇒ segue para o briefing, que exige clique", () => {
    let p = criar("prodx", 3);
    p = { ...p, execs: p.execs.map((e) => (["prodx.p0", "prodx.p25"].includes(e.etapa_id) ? { ...e, estado: "concluida" as const } : e)) };
    const assinado = trab({ tipo: "pedido", ferramenta: "prodx", id: "PD-1", estagio: "p5", prodx: { veredito: "fazer", assinado: true, briefing: false } });
    const r = avancar(p, obs({ trabalho: assinado }));
    expect(ex(r.pipeline, "prodx.assinatura")[0]?.estado).toBe("concluida");
    expect(r.pipeline.estado).toBe("aguardando_confirmacao");
    const c = aplicarAcaoDoUsuario(r.pipeline, "confirmar_etapa", "prodx.briefing", T0).pipeline;
    expect(avancar(c, obs({ trabalho: assinado })).acoes.map((a) => a.tipo)).toContain("despachar");
  });
  it("mergex.revisar: o pipeline do mergex termina esperando a pessoa; só conclui com o merge no disco", () => {
    let p = criar("mergex", 3);
    p = { ...p, execs: p.execs.map((e) => (e.etapa_id !== "mergex.revisar" ? { ...e, estado: "concluida" as const } : e)) };
    const aberto = trab({ tipo: "ocorrencia", ferramenta: "runx", id: "OC-1", entrega: { estado: "aberta", branch: "b", portao: "pronto", pr_url: "u", pr_estado: "aberto", commits: 1, arquivo: "x" } });
    const r = avancar(p, obs({ trabalho: aberto }));
    expect(r.pipeline.estado).toBe("aguardando_humano");
    expect(r.acoes.some((a) => a.tipo === "despachar")).toBe(false);
    const feito = trab({ tipo: "ocorrencia", ferramenta: "runx", id: "OC-1", entrega: { estado: "aberta", branch: "b", portao: "pronto", pr_url: "u", pr_estado: "merged", commits: 1, arquivo: "x" } });
    expect(avancar(r.pipeline, obs({ trabalho: feito })).pipeline.estado).toMatch(/^concluido/);
  });
  it("raio ALTO sem aprovação trava despacho de quem implementa; aprovado segue", () => {
    let p = criar("runx", 4, { legado: true });
    p = { ...p, execs: p.execs.map((e) => (["memox.consultar", "legadox.raio", "runx.e1", "runx.e2"].includes(e.etapa_id) ? { ...e, estado: "concluida" as const } : e)) };
    const alto = (aprovado: boolean) => oc("e3", { raio: { faixa: "alto", aprovado } });
    const r = avancar(p, obs({ trabalho: alto(false) }));
    expect(r.pipeline.estado).toBe("aguardando_humano");
    expect(r.acoes).toEqual([{ tipo: "notificar", motivo: "raio_alto", etapa_id: expect.any(String), detalhe: expect.stringMatching(/humana/) }]);
    expect(avancar(p, obs({ trabalho: alto(true) })).acoes.some((a) => a.tipo === "despachar")).toBe(true);
  });
  it("trava de nível: raio ALTO e nível < 4 ⇒ bloqueado_trava, salvo override", () => {
    let p = criar("runx", 2);
    p = { ...p, execs: p.execs.map((e) => (["memox.consultar", "runx.e1", "runx.e2"].includes(e.etapa_id) ? { ...e, estado: "concluida" as const } : e)) };
    const t = oc("e3", { raio: { faixa: "alto", aprovado: true } });
    const r = avancar(p, obs({ trabalho: t }));
    expect(r.pipeline.estado).toBe("bloqueado_trava");
    expect(r.acoes[0]).toMatchObject({ tipo: "notificar", motivo: "trava" });
    expect(avancar({ ...p, override_trava: true }, obs({ trabalho: t })).pipeline.estado).toBe("executando");
    expect(avancar({ ...p, nivel_atual: 4 }, obs({ trabalho: t })).pipeline.estado).toBe("executando");
  });
  it("piso violado ⇒ bloqueado_piso (nada despacha); não comprovado não bloqueia", () => {
    const violado = [{ id: "I3" as const, titulo: "x", estado: "violado" as const, detalhe: "src/a.ts (chave sk-)" }];
    const r = avancar(criar("runx", 3), obs({ piso: violado }));
    expect(r.pipeline.estado).toBe("bloqueado_piso");
    expect(r.acoes.some((a) => a.tipo === "despachar")).toBe(false);
    expect(r.acoes.find((a) => a.tipo === "notificar")).toMatchObject({ motivo: "piso" });
    const nc = [{ id: "I4" as const, titulo: "x", estado: "nao_comprovado" as const, detalhe: "" }];
    expect(avancar(criar("runx", 3), obs({ piso: nc })).acoes.some((a) => a.tipo === "despachar")).toBe(true);
    // reabrir a etapa limpa o bloqueio quando a causa some
    const reaberto = avancar(r.pipeline, obs({ piso: [] }));
    expect(reaberto.pipeline.estado).toBe("executando");
  });
  it("mergex.pr em `seguro`/`equilibrado` pede confirmação; `automatico` não", () => {
    for (const [permissao, esperado] of [["seguro", "aguardando_confirmacao"], ["equilibrado", "aguardando_confirmacao"], ["automatico", "executando"]] as const) {
      let p = criar("runx", 3, {}, permissao);
      p = { ...p, execs: p.execs.map((e) => (e.etapa_id !== "mergex.pr" && e.etapa_id !== "runx.e5" ? { ...e, estado: "concluida" as const } : e)) };
      expect(avancar(p, obs({ trabalho: oc("e5") })).pipeline.estado, permissao).toBe(esperado);
    }
  });
  it("Pane `aguardando` ⇒ aguardando_usuario uma vez (sem renotificar)", () => {
    const p = comoDespachada(avancar(criar("runx", 3), obs()).pipeline, "runx.e1", "p1");
    const r1 = avancar(p, obs({ panes: panes({ p1: "aguardando" }) }));
    expect(r1.pipeline.estado).toBe("aguardando_usuario");
    expect(r1.acoes.filter((a) => a.tipo === "notificar")).toHaveLength(1);
    const r2 = avancar(r1.pipeline, obs({ panes: panes({ p1: "aguardando" }) }));
    expect(r2.acoes).toEqual([]);
  });
  it("terminal que some ou encerra sem concluir ⇒ etapa e pipeline falham", () => {
    const p = comoDespachada(avancar(criar("runx", 3), obs()).pipeline, "runx.e1", "p1");
    for (const panesObs of [{}, panes({ p1: "encerrado" })]) {
      const r = avancar(p, obs({ panes: panesObs }));
      expect(r.pipeline.estado).toBe("falhou");
      expect(ex(r.pipeline, "runx.e1")[0]?.estado).toBe("falhou");
      expect(r.pipeline.concluido_em).not.toBeNull();
    }
  });
});

describe("laços de reprovação", () => {
  const ateE4 = (nivel: NivelRigidez): PipelineEstado => {
    let p = criar("runx", nivel);
    p = { ...p, execs: p.execs.map((e) => (["memox.consultar", "prodx.p0", "runx.e1", "runx.e2", "runx.e3"].includes(e.etapa_id) ? { ...e, estado: "concluida" as const, pane_id: e.etapa_id === "runx.e3" ? "p3" : null } : e)) };
    return p;
  };
  it("runx.e4 reprovado ⇒ nova rodada de e3 e e4 logo depois (rodada +1); as demais continuam depois", () => {
    const p = comoDespachada(avancar(ateE4(3), obs({ trabalho: oc("e4") })).pipeline, "runx.e4", "p4");
    const r = avancar(p, obs({ trabalho: oc("e4", { veredito_qa: "reprovado" }), sondas: { existe: () => true, mtime: () => T0 + 5000 }, agora_ms: T0 + 6000, panes: panes({ p4: "pronto", p3: "pronto" }) }));
    const ordem = r.pipeline.execs.map((e) => `${e.etapa_id}#${e.rodada}:${e.estado}`);
    expect(ordem.slice(ordem.indexOf("runx.e3#1:concluida"), ordem.indexOf("runx.e3#1:concluida") + 4)).toEqual(["runx.e3#1:concluida", "runx.e4#1:reprovada", "runx.e3#2:despachando", "runx.e4#2:pendente"]);
    expect(ordem.indexOf("mergex.check#1:pendente")).toBeGreaterThan(ordem.indexOf("runx.e4#2:pendente"));
    expect(r.acoes.find((a) => a.tipo === "despachar")).toMatchObject({ etapa_id: "runx.e3", rodada: 2, papel: "executor", reusar_pane_id: null });
    expect(ex(r.pipeline, "runx.e3")[1]?.detalhe).toMatch(/rodada 2: volta por reprovação em runx.e4/);
  });
  it("limite de voltas por nível: nível 2 pausa na 1ª reprovação; nível 3 na 2ª; nível 4 na 3ª; nível 5 na 4ª", () => {
    expect([1, 2, 3, 4, 5].map((n) => voltasPermitidas("runx.e4", n as NivelRigidez))).toEqual([0, 0, 1, 2, 3]);
    expect([1, 2, 3, 4, 5].map((n) => voltasPermitidas("sprintx.f5", n as NivelRigidez))).toEqual([0, 0, 2, 3, 4]);
    for (const [nivel, reprovacoes] of [[2, 1], [3, 2], [4, 3], [5, 4]] as const) {
      let p = ateE4(nivel);
      let r = avancar(p, obs({ trabalho: oc("e4") }));
      for (let i = 1; i <= reprovacoes; i++) {
        p = comoDespachada(r.pipeline, "runx.e4", `q${i}`, i);
        r = avancar(p, obs({ trabalho: oc("e4", { veredito_qa: "reprovado" }), sondas: { existe: () => true, mtime: () => T0 + i * 10_000 }, agora_ms: T0 + i * 10_000 + 1, panes: panes({ [`q${i}`]: "pronto", p3: "pronto" }) }));
        if (i < reprovacoes) {
          expect(r.pipeline.estado, `N${nivel} reprovação ${i}`).toBe("executando");
          // o e3 da nova rodada conclui e o e4 seguinte é despachado
          const e3 = ex(r.pipeline, "runx.e3").find((e) => e.rodada === i + 1) as EtapaExec;
          e3.estado = "concluida";
          e3.pane_id = "p3";
          r = avancar(r.pipeline, obs({ trabalho: oc("e4", { veredito_qa: null }), agora_ms: T0 + i * 10_000 + 2, panes: panes({ p3: "pronto" }) }));
        }
      }
      expect(r.pipeline.estado, `N${nivel} após ${reprovacoes} reprovação(ões)`).toBe("aguardando_usuario");
      expect(r.acoes[0]).toMatchObject({ tipo: "notificar", motivo: "limite_de_voltas" });
      expect((r.acoes[0] as { detalhe: string }).detalhe).toMatch(/QA.md/);
    }
  });
  it("sprintx.f5 NÃO ⇒ volta a f3 → f4 → f5; auditoria SIM ⇒ segue para f6", () => {
    let p = criar("sprintx", 3);
    p = { ...p, execs: p.execs.map((e) => (["memox.consultar", "sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f4"].includes(e.etapa_id) ? { ...e, estado: "concluida" as const } : e)) };
    const ft = (aud: "sim" | "nao" | null) => trab({ tipo: "feature", ferramenta: "sprintx", id: "x", pasta: "docs/x", estagio: "f5", veredito_auditoria: aud });
    let r = avancar(p, obs({ trabalho: ft(null) }));
    p = comoDespachada(r.pipeline, "sprintx.f5", "pa");
    r = avancar(p, obs({ trabalho: ft("nao"), panes: panes({ pa: "pronto" }) }));
    const rodada2 = r.pipeline.execs.filter((e) => e.rodada === 2).map((e) => e.etapa_id);
    expect(rodada2).toEqual(["sprintx.f3", "sprintx.f4", "sprintx.f5"]);
    expect(r.acoes.find((a) => a.tipo === "despachar")).toMatchObject({ etapa_id: "sprintx.f3", rodada: 2 });
    // SIM na primeira vez
    p = comoDespachada(avancar(criar("sprintx", 3), obs({ trabalho: ft(null) })).pipeline, "sprintx.f5", "pa");
    const ok = avancar({ ...p, execs: p.execs.map((e) => (["memox.consultar", "sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f4"].includes(e.etapa_id) ? { ...e, estado: "concluida" as const } : e)) }, obs({ trabalho: ft("sim") }));
    expect(ok.acoes.find((a) => a.tipo === "despachar")).toMatchObject({ etapa_id: "sprintx.f6" });
  });
  it("nível 5: avaliador com 2 avaliações vira DUAS execuções, em Panes separados", () => {
    const p = criar("runx", 5);
    const e4 = ex(p, "runx.e4");
    expect(e4.map((e) => e.tentativa)).toEqual([1, 2]);
    expect(e4.every((e) => e.avaliacoes === 2)).toBe(true);
    expect(criarExecs(p.plano).filter((e) => e.etapa_id === "sprintx.f5")).toHaveLength(0);
    const f5 = criar("sprintx", 5);
    expect(ex(f5, "sprintx.f5")).toHaveLength(2);
  });
});

describe("terminais e fechamento", () => {
  it("respeita max_terminais: com o teto atingido não abre outro", () => {
    let p = criar("runx", 3);
    p = { ...p, execs: p.execs.map((e) => (e.etapa_id === "memox.consultar" ? { ...e, estado: "concluida" as const } : e)) };
    const cheio = { ...p, execs: p.execs.map((e, i) => (i === 1 ? { ...e, estado: "pendente" as const } : e)) };
    expect(avancar(cheio, obs({ max_terminais: 0 })).acoes.some((a) => a.tipo === "despachar")).toBe(false);
    expect(avancar(cheio, obs({ max_terminais: 1 })).acoes.some((a) => a.tipo === "despachar")).toBe(true);
  });
  it("fecha o Pane de etapa concluída (menos o último implementador e quem tem Pane que a seguinte reusa)", () => {
    let p = criar("runx", 3);
    p = { ...p, execs: p.execs.map((e) => (e.etapa_id === "runx.e1" ? { ...e, estado: "concluida" as const, pane_id: "p1" } : e.etapa_id === "runx.e3" ? { ...e, estado: "concluida" as const, pane_id: "p3" } : e.etapa_id === "memox.consultar" ? { ...e, estado: "concluida" as const } : e.etapa_id === "runx.e2" ? { ...e, estado: "concluida" as const, pane_id: "p2" } : e)) };
    const r = avancar(p, obs({ trabalho: oc("e4"), panes: panes({ p1: "pronto", p2: "pronto", p3: "pronto" }) }));
    const fechados = r.acoes.filter((a) => a.tipo === "fechar_pane").map((a) => (a as { pane_id: string }).pane_id).sort();
    expect(fechados).toEqual(["p1", "p2"]);
    expect(ex(r.pipeline, "runx.e3")[0]?.pane_fechado).toBeUndefined();
    const sem = avancar(p, obs({ trabalho: oc("e4"), panes: panes({ p1: "pronto", p2: "pronto", p3: "pronto" }), fechar_concluidos: false }));
    expect(sem.acoes.filter((a) => a.tipo === "fechar_pane")).toEqual([]);
    // não fecha duas vezes
    expect(avancar(r.pipeline, obs({ trabalho: oc("e4"), panes: panes({ p1: "pronto", p2: "pronto", p3: "pronto" }) })).acoes.filter((a) => a.tipo === "fechar_pane")).toEqual([]);
  });
  it("Pane compartilhado por etapas concluídas é fechado uma vez só", () => {
    let p = criar("runx", 3);
    p = { ...p, execs: p.execs.map((e) => (["memox.consultar", "runx.e1", "runx.e2"].includes(e.etapa_id) ? { ...e, estado: "concluida" as const, pane_id: e.etapa_id === "memox.consultar" ? null : "pX" } : e)) };
    const r = avancar(p, obs({ trabalho: oc("e3"), panes: panes({ pX: "pronto" }) }));
    expect(r.acoes.filter((a) => a.tipo === "fechar_pane")).toHaveLength(1);
  });
});

describe("conclusão do pipeline", () => {
  it("tudo concluído ⇒ concluido + aprendizado; `voltar_ao_padrao` ⇒ ação; houve etapa dispensada pelo nível ⇒ concluido_parcial", () => {
    const fim = (p: PipelineEstado): PipelineEstado => ({ ...p, execs: p.execs.map((e) => (e.estado === "pulada_nivel" ? e : { ...e, estado: "concluida" as const })) });
    const r3 = avancar({ ...fim(criar("runx", 3)), voltar_ao_padrao: true }, obs());
    expect(r3.pipeline).toMatchObject({ estado: "concluido", motivo_fim: null });
    expect(r3.pipeline.concluido_em).not.toBeNull();
    expect(r3.acoes.map((a) => a.tipo)).toEqual(["aprendizado", "voltar_ao_padrao", "notificar"]);
    const r2 = avancar(fim(criar("runx", 2)), obs());
    expect(r2.pipeline.estado).toBe("concluido_parcial");
    expect(r2.pipeline.motivo_fim).toMatch(/o nível dispensou etapas/);
  });
  it("etapa desligada na configuração ou por você não conta como 'o nível pulou'", () => {
    const p = criar("runx", 3);
    const f = { ...p, execs: p.execs.map((e) => (e.etapa_id === "runx.e5" ? { ...e, estado: "pulada_usuario" as const } : { ...e, estado: "concluida" as const })) };
    expect(avancar(f, obs()).pipeline.estado).toBe("concluido");
  });
  it("etapa falhada ⇒ falhou", () => {
    const p = criar("runx", 3);
    const f = { ...p, execs: p.execs.map((e) => (e.etapa_id === "runx.e3" ? { ...e, estado: "falhou" as const } : { ...e, estado: "concluida" as const })) };
    expect(avancar(f, obs()).pipeline.estado).toBe("falhou");
  });
});

describe("ações do usuário", () => {
  const rodando = (): PipelineEstado => avancar(criar("runx", 3), obs()).pipeline;
  it("pausar/retomar/cancelar com as transições válidas; estados terminais recusam", () => {
    const p = rodando();
    const pausado = aplicarAcaoDoUsuario(p, "pausar", null, T0);
    expect(pausado).toMatchObject({ erro: null, pipeline: { estado: "pausado" } });
    expect(aplicarAcaoDoUsuario(pausado.pipeline, "retomar", null, T0).pipeline.estado).toBe("executando");
    expect(aplicarAcaoDoUsuario(p, "retomar", null, T0).erro).toMatch(/não está pausado/);
    expect(aplicarAcaoDoUsuario(p, "cancelar", null, T0).pipeline).toMatchObject({ estado: "cancelado", motivo_fim: "cancelado pelo usuário" });
    const fim = { ...p, estado: "concluido" as const };
    expect(aplicarAcaoDoUsuario(fim, "pausar", null, T0).erro).not.toBeNull();
    expect(aplicarAcaoDoUsuario(fim, "cancelar", null, T0).erro).toMatch(/já terminou/);
  });
  it("pular: etapa de piso e humana nunca; etapa já terminada não; comum sim", () => {
    const p = criar("runx", 3, { legado: true });
    expect(aplicarAcaoDoUsuario(p, "pular_etapa", "legadox.raio", T0).erro).toMatch(/piso ou humana/);
    expect(aplicarAcaoDoUsuario(criar("prodx", 3), "pular_etapa", "prodx.assinatura", T0).erro).toMatch(/piso ou humana/);
    expect(aplicarAcaoDoUsuario(p, "pular_etapa", "runx.e5", T0).pipeline.execs.find((e) => e.etapa_id === "runx.e5")?.estado).toBe("pulada_usuario");
    expect(aplicarAcaoDoUsuario(p, "pular_etapa", "naoexiste" as EtapaId, T0).erro).toMatch(/não encontrada/);
    const feito = { ...p, execs: p.execs.map((e) => (e.etapa_id === "runx.e5" ? { ...e, estado: "concluida" as const } : e)) };
    expect(aplicarAcaoDoUsuario(feito, "pular_etapa", "runx.e5", T0).erro).toMatch(/já terminou/);
  });
  it("confirmar etapa humana é recusado; reabrir etapa em andamento também", () => {
    expect(aplicarAcaoDoUsuario(criar("prodx", 3), "confirmar_etapa", "prodx.assinatura", T0).erro).toMatch(/ação humana/);
    const p = rodando();
    expect(aplicarAcaoDoUsuario(p, "reabrir_etapa", "runx.e1", T0).erro).toMatch(/em andamento/);
  });
  it("reabrir uma etapa falhada/bloqueada volta o pipeline a executando", () => {
    const p = { ...rodando(), estado: "bloqueado_piso" as const, execs: rodando().execs.map((e) => (e.etapa_id === "runx.e1" ? { ...e, estado: "concluida" as const } : e)) };
    const r = aplicarAcaoDoUsuario(p, "reabrir_etapa", "runx.e1", T0).pipeline;
    expect(r.estado).toBe("executando");
    expect(r.execs.find((e) => e.etapa_id === "runx.e1")).toMatchObject({ estado: "pendente", pane_id: null, detalhe: "reaberta por você" });
  });
  it("não existe ação de assinar, aprovar raio ou fazer merge", () => {
    const acoes = ["pausar", "retomar", "pular_etapa", "reabrir_etapa", "confirmar_etapa", "cancelar"];
    for (const a of ["assinar", "aprovar", "merge", "aprovar_raio"]) expect(acoes).not.toContain(a);
  });
  it("não muta a entrada", () => {
    const p = rodando();
    const c = JSON.stringify(p);
    aplicarAcaoDoUsuario(p, "pausar", null, T0);
    aplicarAcaoDoUsuario(p, "pular_etapa", "runx.e5", T0);
    expect(JSON.stringify(p)).toBe(c);
  });
  it("resumo para a UI", () => {
    const r = resumoDoPipeline(rodando());
    expect(r).toMatchObject({ id: "mpl_1", pipeline_id: "runx", estado: "executando", etapa_atual: "runx.e1", nivel_atual: 3 });
    expect(r.etapas.length).toBeGreaterThan(5);
  });
});

describe("desempenho da decisão (P-218) e conclusão por sonda", () => {
  it("avancar ≤ 100 ms (aqui, microssegundos) em pipeline de nível 5 com 2 avaliadores", () => {
    const p = criar("sprintx", 5, { legado: true, convencoes: true, design_system: true });
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) avancar(p, obs({ trabalho: oc("e1") }));
    expect((performance.now() - t0) / 300).toBeLessThan(100);
  });
  it("artefato novo no disco conclui stackx.detectar e avança (sondas)", () => {
    const sonda: SondaDeDisco = { existe: () => true, mtime: () => T0 + 1000 };
    const plano = planejar({ intencao: "convencoes", confianca: 0.9, candidatas: [], retomar: null, fonte: "regra" }, 4, { id: "mpl_s", agora_ms: T0, evidencia: EVIDENCIA_VAZIA });
    let p = novoPipeline({ id: "mpl_s", workspace_id: "w", mission_id: null, trabalho_id: null, pipeline_id: plano.pipeline_id, intencao: "convencoes", via: "api", origem_pane_id: null, texto_hash: "h", texto_resumo: "r", nivel_base: 4, nivel_atual: 4, nivel_pedido: null, executar_direto: false, voltar_ao_padrao: false, plano, criado_em: "", atualizado_em: "" } as never, T0);
    p = { ...p, estado: "executando" };
    const r = avancar(p, obs());
    expect(r.acoes.find((a) => a.tipo === "despachar")).toMatchObject({ etapa_id: "stackx.detectar" });
    const depois = comoDespachada(r.pipeline, "stackx.detectar", "p1");
    const r2 = avancar(depois, obs({ agora_ms: T0 + 2000, sondas: sonda, panes: panes({ p1: "pronto" }) }));
    expect(ex(r2.pipeline, "stackx.detectar")[0]?.estado).toBe("concluida");
    expect(r2.acoes.find((a) => a.tipo === "despachar")).toMatchObject({ etapa_id: "stackx.check" });
  });
});
