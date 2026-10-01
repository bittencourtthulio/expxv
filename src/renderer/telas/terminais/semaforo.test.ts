import { describe, expect, it } from "vitest";
import { atividadeDoGrupo, contarAguardando, primeiraAguardando, rotuloDaAtividade, type AbaSemaforo } from "./semaforo";

const aba = (sessao_id: string, aba_id: string, atividade?: AbaSemaforo["atividade"], estado: AbaSemaforo["estado"] = "executando"): AbaSemaforo => ({ sessao_id, aba_id, estado, ...(atividade === undefined ? {} : { atividade }) });

describe("atividadeDoGrupo", () => {
  it("funcional: raiz pronto e divisão aguardando mostram aguardando na aba", () => {
    const abas = [aba("a", "a", "pronto"), aba("b", "a", "aguardando")];
    expect(atividadeDoGrupo(abas, "a")).toBe("aguardando");
  });
  it("funcional: prioridade aguardando > trabalhando > pronto", () => {
    expect(atividadeDoGrupo([aba("a", "a", "pronto"), aba("b", "a", "trabalhando")], "a")).toBe("trabalhando");
    expect(atividadeDoGrupo([aba("a", "a", "pronto"), aba("b", "a")], "a")).toBe("pronto");
  });
  it("funcional: grupo sem atividade é undefined e outro grupo não interfere", () => {
    expect(atividadeDoGrupo([aba("a", "a"), aba("b", "b", "aguardando")], "a")).toBeUndefined();
    expect(atividadeDoGrupo([], "a")).toBeUndefined();
  });
  it("seguranca: sessão que não está executando não conta (atividade velha de processo encerrado)", () => {
    expect(atividadeDoGrupo([aba("a", "a", "aguardando", "encerrada"), aba("b", "a", "pronto")], "a")).toBe("pronto");
  });
});

describe("contador e primeira aguardando", () => {
  const abas = [aba("a", "a", "pronto"), aba("b", "b", "aguardando"), aba("c", "b", "aguardando"), aba("d", "d", "aguardando", "erro")];
  it("funcional: conta as sessões aguardando e devolve a primeira", () => {
    expect(contarAguardando(abas)).toBe(2);
    expect(primeiraAguardando(abas)).toBe("b");
  });
  it("funcional: sem ninguém aguardando o contador é 0 e não há alvo", () => {
    expect(contarAguardando([aba("a", "a", "pronto")])).toBe(0);
    expect(primeiraAguardando([aba("a", "a", "pronto")])).toBeNull();
  });
});

describe("rotuloDaAtividade", () => {
  it("funcional: cada estado tem forma e texto, nunca só cor", () => {
    expect(rotuloDaAtividade("trabalhando")).toEqual({ forma: "anel", glifo: "", texto: "trabalhando" });
    expect(rotuloDaAtividade("aguardando")).toEqual({ forma: "alerta", glifo: "!", texto: "aguardando você" });
    expect(rotuloDaAtividade("pronto")).toEqual({ forma: "check", glifo: "✓", texto: "pronto" });
    expect(rotuloDaAtividade(undefined)).toBeNull();
  });
});

import { textoAguardando } from "./semaforo";
describe("textoAguardando", () => {
  it("singular e plural", () => {
    expect(textoAguardando(1)).toBe("1 aguardando você");
    expect(textoAguardando(3)).toBe("3 aguardando você");
  });
});
