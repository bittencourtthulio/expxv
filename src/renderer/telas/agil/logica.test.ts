import { describe, expect, it } from "vitest";
import { antesDoDestino, celulaCsv, csvDeTabela, filtrosParaApi, formatarDuracao, formatarPercentual, janelaVirtual, lerErroAgil, motivoValido, textoDoErro, textoOrigemEstimativa, FILTROS_VAZIOS } from "./logica";

describe("erros do IPC", () => {
  it("lê [codigo/subcodigo] mesmo com o prefixo do Electron", () => {
    const e = new Error("Error invoking remote method 'agil:retrabalho_marcar': Error: [rule_violation/human_only] ação reservada a humano");
    expect(lerErroAgil(e)).toEqual({ code: "rule_violation", subcode: "human_only", message: "ação reservada a humano" });
    expect(textoDoErro(e)).toMatch(/pessoa/);
  });
  it("sem subcódigo e sem padrão", () => {
    expect(lerErroAgil(new Error("[not_found] item não existe"))).toEqual({ code: "not_found", subcode: null, message: "item não existe" });
    expect(lerErroAgil("falhou").code).toBe("unknown");
    expect(lerErroAgil(42).message).toBe("Erro desconhecido.");
  });
});

describe("formatação", () => {
  it("duração legível e desconhecido vira travessão (nunca 0)", () => {
    expect(formatarDuracao(null)).toBe("—");
    expect(formatarDuracao(30_000)).toBe("< 1 min");
    expect(formatarDuracao(90 * 60_000)).toBe("1 h 30 min");
    expect(formatarDuracao(26 * 3_600_000)).toBe("1 d 2 h");
    expect(formatarPercentual(null)).toBe("—");
    expect(formatarPercentual(0.256)).toBe("25.6 %");
    expect(textoOrigemEstimativa(null, null)).toBe("sem estimativa");
    expect(textoOrigemEstimativa("ia", 0.5)).toContain("50 %");
    expect(textoOrigemEstimativa("humano", 1)).toBe("decidido por pessoa");
  });
  it("filtros para a API omitem o que é nulo", () => {
    expect(filtrosParaApi(FILTROS_VAZIOS)).toEqual({});
    expect(filtrosParaApi({ ...FILTROS_VAZIOS, sprint_id: "s1" })).toEqual({ sprint_id: "s1" });
  });
});

describe("CSV", () => {
  it("RFC 4180 e proteção contra injeção de fórmula", () => {
    expect(celulaCsv('a"b')).toBe('"a""b"');
    expect(celulaCsv("a,b")).toBe('"a,b"');
    expect(celulaCsv("=1+1")).toBe("'=1+1");
    expect(celulaCsv("-2")).toBe("'-2");
    expect(celulaCsv(null)).toBe("");
    expect(csvDeTabela(["x", "y"], [["=a", 1], [null, "q\nr"]])).toBe('x,y\r\n\'=a,1\r\n,"q\nr"\r\n');
  });
});

describe("virtualização e reordenação", () => {
  it("janela cobre só o visível (5 000 itens → poucas linhas)", () => {
    const { inicio, fim } = janelaVirtual(5000, 28, 28 * 2000, 480);
    expect(inicio).toBeGreaterThan(1900);
    expect(fim - inicio).toBeLessThan(40);
    expect(janelaVirtual(0, 28, 0, 480)).toEqual({ inicio: 0, fim: 0 });
    expect(janelaVirtual(10, 28, 0, 1000).fim).toBe(10);
  });
  it("antesDoDestino devolve o vizinho que fica depois do item", () => {
    const ids = ["a", "b", "c", "d"];
    expect(antesDoDestino(ids, 0, 2)).toBe("d");   // a vai para depois de c → antes de d
    expect(antesDoDestino(ids, 3, 0)).toBe("a");   // d vai para o topo → antes de a
    expect(antesDoDestino(ids, 0, 3)).toBeNull();  // a vai para o fim
    expect(antesDoDestino(ids, 1, 1)).toBeNull();
    expect(antesDoDestino(ids, 9, 0)).toBeNull();
  });
  it("motivo precisa de 5 caracteres úteis", () => {
    expect(motivoValido("    ab ")).toBe(false);
    expect(motivoValido("regressão")).toBe(true);
  });
});
