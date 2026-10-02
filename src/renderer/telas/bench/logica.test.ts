import { describe, expect, it } from "vitest";
import type { Comparacao, Estimativa, ResumoResultado } from "../../../compartilhado/bench";
import { LIMITE_VIRTUALIZAR, VISUAL_ESTADO, anexarLog, barrasDeComposite, construirGrade, contadorTexto, custoCurto, custoTexto, deveVirtualizar, duracaoTexto, notaTexto, placarTexto, politicaDoRascunho, rotuloCelula, textoCustoEstimado, textoSandbox, TETO_LOG_MEMORIA } from "./logica";
import { comparacaoFalsa, estimativaFalsa, res } from "./fabrica-teste";

describe("custo: desconhecido nunca vira zero", () => {
  it("null → ? / custo desconhecido; valores formatados em USD", () => {
    expect(custoCurto(null)).toBe("?");
    expect(custoTexto(null)).toBe("custo desconhecido");
    expect(custoCurto(null)).not.toMatch(/0/);
    expect(custoCurto(1.5)).toBe("US$ 1,50");
    expect(custoCurto(0.0123)).toBe("US$ 0,0123");
    expect(custoCurto(0)).toBe("US$ 0,00"); // zero MEDIDO é zero
    expect(custoTexto(2)).toBe("US$ 2,00");
  });
  it("duração e nota", () => {
    expect(duracaoTexto(null)).toBe("—");
    expect(duracaoTexto(12.34)).toBe("12,3 s");
    expect(duracaoTexto(65.4)).toBe("1 min 05 s");
    expect(notaTexto(null)).toBe("sem nota");
    expect(notaTexto(7.5)).toBe("7,5");
  });
});

describe("estado por FORMA + texto (nunca só cor)", () => {
  it("todo estado tem glifo e rótulo próprios e distintos", () => {
    const glifos = Object.values(VISUAL_ESTADO).map((v) => v.glifo);
    expect(new Set(glifos).size).toBe(glifos.length);
    for (const v of Object.values(VISUAL_ESTADO)) { expect(v.glifo.length).toBeGreaterThan(0); expect(v.rotulo.length).toBeGreaterThan(2); }
  });
  it("rótulo da célula traz tarefa, alvo, estado, duração, custo e nota por extenso", () => {
    const r = res("bres_x", "t", "a", { custo_usd: null, qualidade: null, estado: "falhou", aviso: "saída 2" });
    const t = rotuloCelula("Tarefa", "Alvo", r);
    expect(t).toContain("falhou");
    expect(t).toContain("custo desconhecido");
    expect(t).toContain("sem nota");
    expect(t).toContain("Aviso: saída 2");
    expect(rotuloCelula("T", "A", null)).toBe("T em A: sem execução");
  });
});

describe("grade e virtualização", () => {
  it("monta tarefa × alvo com os vigentes e ignora substituídos", () => {
    const rs: ResumoResultado[] = [res("1", "t1", "a"), res("2", "t1", "a", { estado: "substituido", tentativa: 1 }), res("3", "t2", "b")];
    const g = construirGrade(rs, ["t1", "t2"], ["a", "b"]);
    expect(g[0]!.celulas.map((c) => c.resultado?.id ?? null)).toEqual(["1", null]);
    expect(g[1]!.celulas.map((c) => c.resultado?.id ?? null)).toEqual([null, "3"]);
  });
  it("virtualiza acima de 100 linhas", () => {
    expect(LIMITE_VIRTUALIZAR).toBe(100);
    expect(deveVirtualizar(100)).toBe(false);
    expect(deveVirtualizar(101)).toBe(true);
  });
  it("contador 4/18 · US$ 0,41 e custo ? sem dado", () => {
    expect(contadorTexto(4, 18, 0.41)).toBe("4/18 · US$ 0,41");
    expect(contadorTexto(0, 0, null)).toBe("0/0 · custo ?");
  });
});

describe("estimativa e sandbox", () => {
  it("custo: faixa, único valor, desconhecido e misto", () => {
    expect(textoCustoEstimado(estimativaFalsa({ custo_min_usd: 1.8, custo_max_usd: 6.4 }))).toBe("US$ 1,80 – 6,40");
    expect(textoCustoEstimado(estimativaFalsa({ custo_min_usd: 1, custo_max_usd: 1 }))).toBe("US$ 1,00");
    const desconhecido: Estimativa = estimativaFalsa({ custo_min_usd: null, custo_max_usd: null, alvos_sem_custo: 3 });
    expect(textoCustoEstimado(desconhecido)).toBe("custo desconhecido para 3 alvo(s)");
    expect(textoCustoEstimado(estimativaFalsa({ alvos_sem_custo: 1 }))).toContain("custo desconhecido para 1 alvo(s)");
  });
  it("sandbox indisponível diz que não pode rodar; sem sandbox exige frase reforçada", () => {
    expect(textoSandbox("indisponivel")).toMatch(/não posso rodar/);
    expect(textoSandbox("nenhum")).toMatch(/frase reforçada/);
    expect(textoSandbox("macos")).toMatch(/macOS/);
  });
});

describe("comparação em SVG próprio e política", () => {
  it("barras proporcionais ao maior score; sem nota = barra vazia", () => {
    const c: Comparacao = comparacaoFalsa();
    const b = barrasDeComposite(c.agregado, 200);
    expect(b.map((x) => x.alvo)).toEqual(["alvo-a", "alvo-b"]);
    expect(b[1]!.largura).toBe(200);
    expect(b[0]!.largura).toBe(Math.round((75.6 / 79.25) * 200));
    expect(barrasDeComposite([{ alvo: "x", composite_medio: null, custo_total_usd: null, duracao_media_s: null, vitorias: 0, tarefas: 0 }])[0]!.largura).toBe(0);
    expect(placarTexto(c)).toBe("alvo-a 1 · alvo-b 1");
  });
  it("rascunho → política global; fallback NUNCA vazio (alternativas ou o próprio executor); nada é gravado aqui", () => {
    const ex = { provider: "claude", cli: "claude", model: "m", effort: "high", faixa: null } as const;
    const sem = politicaDoRascunho({ atividade: "bug", task_type: "bug-fix", executor: ex, alternativas: [], evidencia: [] });
    expect(sem.workspace_id).toBeNull();
    expect(sem.fallback).toEqual([ex]);
    expect(sem.executor).toEqual(ex);
    expect(sem.executor).not.toBe(ex); // cópia
    const alt = { ...ex, model: "m2" };
    const com = politicaDoRascunho({ atividade: "bug", task_type: "bug-fix", executor: ex, alternativas: [alt], evidencia: [] });
    expect(com.alternativas).toEqual([alt]);
    expect(com.fallback).toEqual([alt]);
    expect(com.habilitada).toBe(true);
  });
  it("log em memória mantém o FIM e respeita o teto", () => {
    const grande = "x".repeat(TETO_LOG_MEMORIA - 5) + "ab";
    expect(anexarLog(grande, "cdefghij").length).toBe(TETO_LOG_MEMORIA);
    expect(anexarLog(grande, "cdefghij").endsWith("cdefghij")).toBe(true);
    expect(anexarLog("a", "b")).toBe("ab");
  });
});
