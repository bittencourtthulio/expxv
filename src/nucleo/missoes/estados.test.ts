import { describe, expect, it } from "vitest";
import { ESTADOS_MISSAO, TransicaoMissaoInvalidaErro, type EstadoMissao } from "../dominio";
import { caminhoAte, exigirTransicao, ocupaArvore } from "./estados";

describe("estados da Missão", () => {
  it("transição inválida lança o erro nominal", () => {
    expect(() => exigirTransicao("intake", "concluida")).toThrow(TransicaoMissaoInvalidaErro);
    expect(() => exigirTransicao("concluida", "executando")).toThrow(TransicaoMissaoInvalidaErro);
    expect(() => exigirTransicao("abortada", "abortada")).toThrow(TransicaoMissaoInvalidaErro);
    expect(() => exigirTransicao("intake", "planejando")).not.toThrow();
  });

  it("caminho até concluida passa pelos estados intermediários na ordem", () => {
    expect(caminhoAte("intake", "concluida")).toEqual(["planejando", "executando", "revisando", "concluida"]);
    expect(caminhoAte("revisando", "concluida")).toEqual(["concluida"]);
    expect(caminhoAte("executando", "abortada")).toEqual(["abortada"]);
  });

  it("estados terminais não têm caminho", () => {
    for (const t of ["concluida", "falhou", "abortada"] as EstadoMissao[]) {
      for (const alvo of ESTADOS_MISSAO) expect(caminhoAte(t, alvo)).toBeNull();
    }
  });

  it("Missão livre/livre não ocupa árvore; as demais sim", () => {
    expect(ocupaArvore({ modo: "livre", origem: "livre" })).toBe(false);
    expect(ocupaArvore({ modo: "livre", origem: "feature" })).toBe(true);
    expect(ocupaArvore({ modo: "squad", origem: "livre" })).toBe(true);
    expect(ocupaArvore({ modo: "agentico", origem: "projeto" })).toBe(true);
  });
});
