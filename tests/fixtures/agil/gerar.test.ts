import { describe, expect, it } from "vitest";
import { fonteDaSprint, gerarVolumeAgil, ocorrencias, todasAsFontes, SPRINTS } from "./gerar";

describe("fixture ágil (T-18.08)", () => {
  it("determinística: mesma geração, mesmo resultado (sem aleatório nem relógio)", () => {
    expect(JSON.stringify(todasAsFontes())).toBe(JSON.stringify(todasAsFontes()));
    expect(JSON.stringify(gerarVolumeAgil({ trabalhos: 5, tasksPorTrabalho: 7 }))).toBe(JSON.stringify(gerarVolumeAgil({ trabalhos: 5, tasksPorTrabalho: 7 })));
    expect(JSON.stringify(ocorrencias())).toBe(JSON.stringify(ocorrencias()));
  });
  it("40 sprints, 4 tasks cada; retrabalho de cada fonte e escopo presentes", () => {
    const fs = todasAsFontes();
    expect(fs).toHaveLength(SPRINTS);
    expect(fs.every((f) => f.trabalho.sprints[0]?.fases[0]?.tasks.length === 4)).toBe(true);
    expect(fonteDaSprint(5).qa?.achados.some((a) => a.severidade === "alta")).toBe(true); // QA reprovado
    expect(fonteDaSprint(10).rastro.filter((e) => e.task === "T-01.01" && e.evento === "task_iniciada")).toHaveLength(2); // reabertura
    expect(fonteDaSprint(7).commits.some((c) => c.mensagem.startsWith("fix("))).toBe(true); // commit de correção
    expect(fonteDaSprint(9).commits.some((c) => c.mensagem.startsWith("feat(T-01.01): novo"))).toBe(true); // escopo, não defeito
    expect(ocorrencias().map((o) => o.regressao_de)).toContain("feat-08");
  });
  it("volume: 200 trabalhos × 25 tasks = 5 000 tasks", () => {
    const v = gerarVolumeAgil();
    expect(v).toHaveLength(200);
    expect(v.reduce((a, f) => a + f.trabalho.sprints.flatMap((s) => s.fases.flatMap((x) => x.tasks)).length, 0)).toBe(5000);
  });
});
