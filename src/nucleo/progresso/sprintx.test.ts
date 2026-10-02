// Derivador (b): tasks do plano do sprintx -> Progresso (dependências, fases, estados, atividade recente).
import { describe, expect, it } from "vitest";
import { derivarDoSprintx, ordenarPorDependencia, sprintxAtivo, totalDeTasks, type TrabalhoParaProgresso } from "./sprintx";

type T = TrabalhoParaProgresso["sprints"][number]["fases"][number]["tasks"][number];
const task = (id: string, status: T["status"], extra: Partial<T> = {}): T => ({ id, titulo: `Titulo ${id}`, status, depende_de: [], concluida_em: null, duracao_observada_ms: null, ...extra });
const AGORA = Date.parse("2026-10-01T12:00:00.000Z");
function trabalho(fases: Array<{ id: string; tasks: T[] }>, extra: Partial<TrabalhoParaProgresso> = {}): TrabalhoParaProgresso {
  return { id: "frete", titulo: "Frete grátis", status: "em_andamento", ultima_atividade: "2026-10-01T11:58:00.000Z", sprints: [{ id: "S-01", titulo: "Sprint", fases: fases.map((f) => ({ id: f.id, titulo: `Fase ${f.id}`, tasks: f.tasks })) }], ...extra };
}

describe("ordenarPorDependencia", () => {
  it("respeita dependências e mantém a ordem declarada nos empates", () => {
    const r = ordenarPorDependencia([{ id: "T3", depende_de: ["T1"] }, { id: "T1", depende_de: [] }, { id: "T2", depende_de: [] }, { id: "T4", depende_de: ["T3", "T2"] }]);
    expect(r.map((t) => t.id)).toEqual(["T1", "T3", "T2", "T4"]);
  });
  it("ciclo e dependência inexistente nunca travam", () => {
    const r = ordenarPorDependencia([{ id: "A", depende_de: ["B"] }, { id: "B", depende_de: ["A"] }, { id: "C", depende_de: ["X"] }]);
    expect(r.map((t) => t.id).sort()).toEqual(["A", "B", "C"]);
    expect(r).toHaveLength(3);
  });
});

describe("derivarDoSprintx", () => {
  it("sem tasks não há progresso", () => expect(derivarDoSprintx(trabalho([{ id: "F1", tasks: [] }]), "ws_1")).toBeNull());

  it("estados das tasks: pendente, em andamento, concluída, bloqueada", () => {
    const p = derivarDoSprintx(trabalho([{ id: "F1", tasks: [task("T-01", "concluida"), task("T-02", "em_andamento"), task("T-03", "pendente"), task("T-04", "bloqueada")] }]), "ws_1", { agora: AGORA })!;
    expect(p.itens.map((i) => i.estado)).toEqual(["concluido", "em_andamento", "pendente", "aguardando"]);
    expect(p.itens[3]!.detalhe).toBe("bloqueada");
    expect(p.resultado).toBe("em_andamento");
    expect(p.origem).toBe("sprintx");
    expect(p.titulo).toBe("Sprint: Frete grátis");
  });

  it("task pendente diz de quem depende (até 2) e a ordem segue as dependências", () => {
    const p = derivarDoSprintx(trabalho([{ id: "F1", tasks: [task("T-02", "pendente", { depende_de: ["T-01"] }), task("T-01", "em_andamento"), task("T-03", "pendente", { depende_de: ["T-01", "T-02", "T-09"] })] }]), "ws_1")!;
    expect(p.itens.map((i) => i.id)).toEqual(["T-01", "T-02", "T-03"]);
    expect(p.itens[1]!.detalhe).toBe("depende de T-01");
    expect(p.itens[2]!.detalhe).toBe("depende de T-01, T-02");
  });

  it("várias fases viram grupos com cabeçalho curto; uma fase só não tem cabeçalho", () => {
    const duas = derivarDoSprintx(trabalho([{ id: "F1", tasks: [task("T-01", "concluida")] }, { id: "F2", tasks: [task("T-02", "em_andamento")] }]), "ws_1")!;
    expect(duas.itens.map((i) => i.grupo)).toEqual(["F1 · Fase F1", "F2 · Fase F2"]);
    const uma = derivarDoSprintx(trabalho([{ id: "F1", tasks: [task("T-01", "concluida")] }]), "ws_1")!;
    expect(uma.itens[0]!.grupo).toBeUndefined();
  });

  it("tudo concluído = resultado concluído; duração observada vira desde/fim_em", () => {
    const fim = "2026-10-01T11:50:00.000Z";
    const p = derivarDoSprintx(trabalho([{ id: "F1", tasks: [task("T-01", "concluida", { concluida_em: fim, duracao_observada_ms: 60_000 })] }]), "ws_1")!;
    expect(p.resultado).toBe("concluido");
    expect(p.concluido).toBe(true);
    expect(p.itens[0]).toMatchObject({ fim_em: Date.parse(fim), desde: Date.parse(fim) - 60_000 });
  });

  it("só bloqueadas e pendentes: o resultado é aguardando", () => {
    const p = derivarDoSprintx(trabalho([{ id: "F1", tasks: [task("T-01", "concluida"), task("T-02", "bloqueada")] }]), "ws_1")!;
    expect(p.resultado).toBe("aguardando");
  });

  it("rótulos nunca passam de 60 caracteres e totalDeTasks conta tudo", () => {
    const t = trabalho([{ id: "F1", tasks: [task("T-01", "pendente", { titulo: "x".repeat(300) }), task("T-02", "pendente")] }, { id: "F2", tasks: [task("T-03", "pendente")] }]);
    expect(derivarDoSprintx(t, "ws_1")!.itens[0]!.rotulo.length).toBeLessThanOrEqual(60);
    expect(totalDeTasks(t)).toBe(3);
  });
});

describe("sprintxAtivo", () => {
  const uma = (...s: T["status"][]) => trabalho([{ id: "F1", tasks: s.map((x, i) => task(`T-${i}`, x)) }]);
  it.each<[string, TrabalhoParaProgresso, boolean]>([
    ["task reivindicada, atividade recente", uma("pendente", "em_andamento"), true],
    ["começou e não terminou", uma("concluida", "pendente"), true],
    ["tudo pendente: ainda não começou", uma("pendente", "pendente"), false],
    ["tudo concluído: não está em execução", uma("concluida", "concluida"), false],
    ["task em andamento esquecida há horas", trabalho([{ id: "F1", tasks: [task("T-1", "em_andamento")] }], { ultima_atividade: "2026-10-01T08:00:00.000Z" }), false],
    ["sem atividade registrada", trabalho([{ id: "F1", tasks: [task("T-1", "em_andamento")] }], { ultima_atividade: null }), false],
    ["sem tasks", trabalho([{ id: "F1", tasks: [] }]), false],
  ])("%s", (_n, t, esperado) => expect(sprintxAtivo(t, AGORA)).toBe(esperado));
});
