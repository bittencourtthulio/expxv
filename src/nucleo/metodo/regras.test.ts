import { describe, expect, it } from "vitest";
import { fs, tk, trab } from "../../../tests/fixtures/metodo/construtores";
import { verificarViolacoes } from "./regras";
import type { TipoViolacao } from "./tipos";

const AGORA = Date.parse("2026-09-29T12:00:00Z");
const tipos = (t: ReturnType<typeof trab>): TipoViolacao[] => verificarViolacoes(t, { agora: AGORA }).map((v) => v.tipo);

describe("violações: uma por tipo", () => {
  it("teste_ausente: integração ou funcional ausente, null ou só espaços", () => {
    expect(tipos(trab({}, [tk("T-01.01", { teste_integracao: null })]))).toEqual(["teste_ausente"]);
    expect(tipos(trab({}, [tk("T-01.01", { teste_funcional: "   " })]))).toEqual(["teste_ausente"]);
    const v = verificarViolacoes(trab({}, [tk("T-01.01", { teste_integracao: null, teste_funcional: null })]), { agora: AGORA });
    expect(v.map((x) => x.detalhe)).toEqual(["teste_integracao esta ausente ou vazio", "teste_funcional esta ausente ou vazio"]);
    expect(tipos(trab({}, [tk("T-01.01")]))).toEqual([]);
  });

  it("regressao_ausente: só runx bug, na primeira task pela ordem natural de id", () => {
    const base = { ferramenta: "runx" as const, tipo_ocorrencia: "bug", estagio: "e3", estagio_declarado: "e3" };
    expect(tipos(trab(base, [tk("T-01.02", { teste_regressao: "x" }), tk("T-01.01", { teste_regressao: null })]))).toEqual(["regressao_ausente"]);
    expect(tipos(trab(base, [tk("T-01.02"), tk("T-01.01", { teste_regressao: "falha antes" })]))).toEqual([]);
    expect(tipos(trab({ ...base, tipo_ocorrencia: "melhoria-ui" }, [tk("T-01.01")]))).toEqual([]);
    expect(tipos(trab({ tipo_ocorrencia: "bug" }, [tk("T-01.01")]))).toEqual([]); // sprintx nunca é cobrado
  });

  it("concluida_sem_verde: vermelha e nao_executada violam; verde e parcial não", () => {
    for (const [suite, viola] of [["vermelha", true], ["nao_executada", true], ["verde", false], ["parcial", false]] as const) {
      expect(tipos(trab({}, [tk("T-01.01", { status: "concluida", suite })])).includes("concluida_sem_verde")).toBe(viola);
    }
    expect(tipos(trab({}, [tk("T-01.01", { status: "em_andamento", suite: "vermelha" })]))).toEqual([]);
  });

  it("paralela_com_dependencia: task e fase", () => {
    expect(tipos(trab({}, [tk("T-01.01"), tk("T-01.02", { paralelizavel: true, depende_de: ["T-01.01"] })]))).toEqual(["paralela_com_dependencia"]);
    const t = trab({}, []);
    t.sprints[0]!.fases = [
      fs("F-01.1", [tk("T-01.01", { fase: "F-01.1" })], { paralela_com: ["F-01.2"] }),
      fs("F-01.2", [tk("T-01.02", { fase: "F-01.2", depende_de: ["T-01.01"] })], { paralela_com: ["F-01.1"] }),
    ];
    const v = verificarViolacoes(t, { agora: AGORA }).filter((x) => x.tipo === "paralela_com_dependencia");
    expect(v.map((x) => x.alvo).sort()).toEqual(["F-01.1", "F-01.2"]);
  });

  it("sem_criterio_saida: sprint e fase declarada; fase não declarada é ignorada", () => {
    const t = trab({}, [tk("T-01.01")]);
    t.sprints[0]!.criterio_saida = null;
    t.sprints[0]!.fases[0]!.criterio_saida = "  ";
    t.sprints[0]!.fases.push(fs("F-01.9", [], { criterio_saida: null, declarada: false }));
    const v = verificarViolacoes(t, { agora: AGORA }).filter((x) => x.tipo === "sem_criterio_saida");
    expect(v.map((x) => x.alvo).sort()).toEqual(["F-01.1", "sprint-01"]);
  });

  it("dependencia_inexistente", () => {
    const v = verificarViolacoes(trab({}, [tk("T-01.01", { depende_de: ["T-99.99"] })]), { agora: AGORA });
    expect(v).toEqual([expect.objectContaining({ tipo: "dependencia_inexistente", alvo: "T-01.01", detalhe: expect.stringContaining("T-99.99") })]);
  });

  it("ciclo_dependencia: uma violação por participante, nenhuma para quem só depende do ciclo", () => {
    const t = trab({}, [tk("T-01.01", { depende_de: ["T-01.02"] }), tk("T-01.02", { depende_de: ["T-01.01"] }), tk("T-01.03", { depende_de: ["T-01.01"] })]);
    const v = verificarViolacoes(t, { agora: AGORA }).filter((x) => x.tipo === "ciclo_dependencia");
    expect(v.map((x) => x.alvo)).toEqual(["T-01.01", "T-01.02"]);
  });

  it("bloqueio_antigo: aberto há mais que o limite (padrão 7 dias); resolvido e recente não", () => {
    const b = (id: string, aberto_em: string, resolvido_em: string | null) => ({ id, task: null, aberto_em, resolvido_em, aberto: resolvido_em === null, descricao: "d", arquivo: "docs/x/00-BLOQUEIOS.md" });
    const t = trab({ bloqueios: [b("B-01", "2026-09-01", null), b("B-02", "2026-09-01", "2026-09-02"), b("B-03", "2026-09-22", null), b("B-04", "2026-09-21", null)] });
    const v = verificarViolacoes(t, { agora: AGORA }).filter((x) => x.tipo === "bloqueio_antigo");
    expect(v.map((x) => x.alvo)).toEqual(["B-01", "B-04"]); // B-03 tem exatamente 7 dias (limite), B-04 tem 8
  });

  it("estagio_incoerente: ferramenta x estágio e estágio declarado à frente do disco", () => {
    expect(tipos(trab({ estagio_declarado: "e3" }))).toEqual(["estagio_incoerente"]);
    expect(tipos(trab({ ferramenta: "runx", estagio: "e3", estagio_declarado: "f2" }))).toEqual(["estagio_incoerente"]);
    // declarado f6, disco prova só f5 (auditoria ausente): à frente
    const v = verificarViolacoes(trab({ estagio: "f5", estagio_declarado: "f6" }), { agora: AGORA });
    expect(v.map((x) => x.tipo)).toEqual(["estagio_incoerente"]);
    // declarado atrás do disco é atraso normal de gravação, não violação
    expect(tipos(trab({ estagio: "f6", estagio_declarado: "f5" }))).toEqual([]);
    // sem declaração não há o que conferir
    expect(tipos(trab({ estagio_declarado: null }))).toEqual([]);
  });

  it("buildx: dependência inexistente e ciclo entre features", () => {
    const f = (id: string, depende_de: string[]) => ({ id, titulo: id, slug: null, status: "pendente", depende_de, paralelizavel: false });
    const t = trab({ ferramenta: "buildx", tipo: "projeto", estagio: "b4", estagio_declarado: "b4", features: [f("FT-01", ["FT-09"]), f("FT-02", ["FT-03"]), f("FT-03", ["FT-02"])] }, []);
    t.sprints = [];
    const v = verificarViolacoes(t, { agora: AGORA });
    expect(v.map((x) => `${x.tipo}:${x.alvo}`).sort()).toEqual(["ciclo_dependencia:FT-02", "ciclo_dependencia:FT-03", "dependencia_inexistente:FT-01"]);
  });

  it("nunca lança para trabalho vazio", () => {
    const t = trab({}, []);
    t.sprints = [];
    expect(verificarViolacoes(t, { agora: AGORA })).toEqual([]);
  });
});
