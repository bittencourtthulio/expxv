// Derivador (c): skill solta -> Progresso; lista conhecida "prevista" x único item; agregação sem duplicar.
import { describe, expect, it } from "vitest";
import { agregarProgressos } from "./agregar";
import { derivarDaSkill, listaConhecida, nomeDaSkill, type SkillObservada } from "./skill";
import type { PipelineParaProgresso } from "./maestro";
import type { TrabalhoParaProgresso } from "./sprintx";

const base: SkillObservada = { workspace_id: "ws_1", skill: "runx", chave: "pane_1", iniciada_em: 1_000 };
const estados = (s: SkillObservada) => derivarDaSkill(s).itens.map((i) => i.estado);

describe("nomeDaSkill", () => {
  it.each([["/expx:runx", "runx"], ["expx:runx-causa", "runx-causa"], ["  /expx:SprintX ", "sprintx"], ["runx", "runx"], ["/expx:ru nx;rm", "runxrm"]])("%s", (e, s) => expect(nomeDaSkill(e)).toBe(s));
});

describe("listaConhecida", () => {
  it("skill-roteador usa a família inteira do catálogo", () => {
    const l = listaConhecida("runx")!;
    expect(l.completa).toBe(true);
    expect(l.etapas.map((e) => e.id)).toEqual(["runx.e1", "runx.e2", "runx.e3", "runx.e4", "runx.e5"]);
  });
  it("sub-skill é uma etapa só", () => {
    const l = listaConhecida("sprintx-executar")!;
    expect(l.completa).toBe(false);
    expect(l.etapas.map((e) => e.id)).toEqual(["sprintx.f6"]);
  });
  it("sem lista conhecida (ou família de uma etapa só)", () => {
    expect(listaConhecida("memox")).toBeNull();
    expect(listaConhecida("coisa-nova")).toBeNull();
    expect(listaConhecida("consulta")).toBeNull();
  });
});

describe("derivarDaSkill", () => {
  it("recém-detectada, sem rastro: lista PREVISTA, só a primeira etapa em andamento, marcada 'prevista'", () => {
    const p = derivarDaSkill(base);
    expect(p.previsto).toBe(true);
    expect(p.origem).toBe("skill");
    expect(p.titulo).toBe("/expx:runx");
    expect(estados(base)).toEqual(["em_andamento", "pendente", "pendente", "pendente", "pendente"]);
    expect(p.itens[0]).toMatchObject({ detalhe: "prevista", desde: 1_000 });
    expect(p.resultado).toBe("em_andamento");
  });
  it("estágio medido pelo rastro: antes ✓, atual em andamento, depois pendente; sem a nota 'prevista'", () => {
    const p = derivarDaSkill({ ...base, estagio: "e3" });
    expect(p.itens.map((i) => i.estado)).toEqual(["concluido", "concluido", "em_andamento", "pendente", "pendente"]);
    expect(p.itens[2]!.detalhe).toBeUndefined();
  });
  it("atividade 'aguardando' da sessão: a etapa atual espera você", () => {
    const p = derivarDaSkill({ ...base, estagio: "e1", atividade: "aguardando" });
    expect(p.itens[0]).toMatchObject({ estado: "aguardando", detalhe: "responda no terminal" });
    expect(p.resultado).toBe("aguardando");
  });
  it("fim ok marca tudo; fim com falha para na etapa atual", () => {
    expect(estados({ ...base, fim_em: 5_000, resultado: "ok" })).toEqual(["concluido", "concluido", "concluido", "concluido", "concluido"]);
    const f = derivarDaSkill({ ...base, estagio: "e2", fim_em: 5_000, resultado: "falha" });
    expect(f.itens.map((i) => i.estado)).toEqual(["concluido", "falhou", "pendente", "pendente", "pendente"]);
    expect(f.resultado).toBe("falhou");
    expect(f.fim_em).toBe(5_000);
  });
  it("sem lista conhecida: um único item 'Executando <skill>…' que vira ✓ no fim; não é 'prevista'", () => {
    const s = { ...base, skill: "memox" };
    const rodando = derivarDaSkill(s);
    expect(rodando.itens).toHaveLength(1);
    expect(rodando.itens[0]).toMatchObject({ rotulo: "Executando memox…", estado: "em_andamento" });
    expect(rodando.previsto).toBe(false);
    const fim = derivarDaSkill({ ...s, fim_em: 9, resultado: "ok" });
    expect(fim.itens[0]!.estado).toBe("concluido");
    expect(fim.concluido).toBe(true);
    expect(derivarDaSkill({ ...s, atividade: "aguardando" }).itens[0]!.estado).toBe("aguardando");
  });
  it("sub-skill mostra só a etapa dela e não é 'prevista'", () => {
    const p = derivarDaSkill({ ...base, skill: "/expx:runx-causa" });
    expect(p.itens.map((i) => i.id)).toEqual(["runx.e1"]);
    expect(p.previsto).toBe(false);
  });
  it("a sessão da etapa atual vai no item (o clique foca o terminal)", () => {
    expect(derivarDaSkill({ ...base, sessao_id: "sess_1" }).itens[0]!.sessao_id).toBe("sess_1");
  });
});

describe("agregarProgressos", () => {
  const pipeline = (extra: Partial<PipelineParaProgresso> = {}): PipelineParaProgresso => ({
    id: "mpl_X", workspace_id: "ws_1", trabalho_id: "frete", pipeline_id: "sprintx", estado: "executando", texto_resumo: "", motivo_fim: null, criado_em: "2026-10-01T09:00:00.000Z", concluido_em: null,
    plano: { etapas: [{ etapa_id: "sprintx.f5", ordem: 1, estado_inicial: "pendente", tipo: "avaliador" }, { etapa_id: "sprintx.f6", ordem: 2, estado_inicial: "pendente", tipo: "implementador" }] },
    execs: [{ etapa_id: "sprintx.f5", ordem: 1, tentativa: 1, rodada: 1, estado: "concluida", pane_id: null, inicio_em: null, fim_em: null, detalhe: null }, { etapa_id: "sprintx.f6", ordem: 2, tentativa: 1, rodada: 1, estado: "executando", pane_id: null, inicio_em: null, fim_em: null, detalhe: null }],
    ...extra,
  });
  const trabalho: TrabalhoParaProgresso = {
    id: "frete", titulo: "Frete", status: "em_andamento", ultima_atividade: "2026-10-01T11:59:00.000Z",
    sprints: [{ id: "S", titulo: "S", fases: [{ id: "F1", titulo: "F", tasks: [{ id: "T-1", titulo: "a", status: "concluida", depende_de: [], concluida_em: null, duracao_observada_ms: null }, { id: "T-2", titulo: "b", status: "em_andamento", depende_de: [], concluida_em: null, duracao_observada_ms: null }] }] }],
  };

  it("Maestro + sprintx do mesmo trabalho: uma lista só, e a etapa de execução ganha 'N/M tasks'", () => {
    const r = agregarProgressos({ pipelines: [pipeline()], sprintx: [{ trabalho, workspace_id: "ws_1" }], skills: [] });
    expect(r.map((p) => p.origem)).toEqual(["maestro"]);
    expect(r[0]!.itens[1]!.detalhe).toBe("1/2 tasks");
  });
  it("sprintx sem Maestro aparece sozinho; skill do mesmo trabalho não duplica", () => {
    const r = agregarProgressos({ pipelines: [], sprintx: [{ trabalho, workspace_id: "ws_1", iniciado_em: 5 }], skills: [{ workspace_id: "ws_1", skill: "sprintx", chave: "frete", iniciada_em: 1, trabalho_id: "frete" }] });
    expect(r.map((p) => p.origem)).toEqual(["sprintx"]);
    expect(r[0]!.iniciado_em).toBe(5);
  });
  it("skill solta de outro trabalho aparece; ordem por início; pipeline proposto fica de fora", () => {
    const r = agregarProgressos({
      pipelines: [pipeline({ trabalho_id: null }), pipeline({ id: "mpl_P", estado: "proposto" })],
      sprintx: [],
      skills: [{ workspace_id: "ws_1", skill: "prodx", chave: "pane_2", iniciada_em: 1 }],
    });
    expect(r.map((p) => p.origem)).toEqual(["skill", "maestro"]);
  });
});
