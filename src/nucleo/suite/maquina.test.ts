import { describe, expect, it } from "vitest";
import { estadoInicial, percentualDe, reduzir, terminal, type EstadoInstalacao, type EventoInstalacao } from "./maquina";
import type { FalhaSuite, ResumoSuite } from "./modelo";

const falha: FalhaSuite = { causa: "sem_internet", mensagem: "x", sugestao: "y", codigo: null, etapa: "baixando" };
const resumo: ResumoSuite = { versao: "0.9.0", skills: [], criados: [], alterados: [], removidos: [], fora_do_esperado: [], truncado: false, doctor: "ok", backup: null, como_restaurar: null, restaurados: [] };
const roda = (evs: EventoInstalacao[]): EstadoInstalacao => evs.reduce(reduzir, estadoInicial());
const situacoes = (e: EstadoInstalacao): string => e.etapas.map((x) => x.situacao[0]).join("");

describe("máquina de estados da instalação", () => {
  const TABELA: ReadonlyArray<[string, EventoInstalacao[], string, string]> = [
    ["início", [], "rodando", "ppppp"],
    ["requisitos ativa", [{ t: "etapa", id: "requisitos" }], "rodando", "appp".padEnd(5, "p")],
    ["baixando fecha requisitos", [{ t: "etapa", id: "requisitos" }, { t: "etapa", id: "baixando" }], "rodando", "oapp".padEnd(5, "p")],
    ["sucesso completo", [{ t: "etapa", id: "requisitos" }, { t: "etapa", id: "baixando" }, { t: "etapa", id: "instalando" }, { t: "etapa", id: "conferindo" }, { t: "etapa", id: "pronto" }, { t: "concluida", resumo }], "concluida", "ooooo"],
    ["falha de rede no download", [{ t: "etapa", id: "requisitos" }, { t: "etapa", id: "baixando" }, { t: "falhou", falha }], "falhou", "ofppp"],
    ["cancelar no meio", [{ t: "etapa", id: "requisitos" }, { t: "etapa", id: "baixando" }, { t: "etapa", id: "instalando" }, { t: "cancelada" }], "cancelada", "ooFpp".toLowerCase().replace("f", "f")],
  ];
  it.each(TABELA)("%s", (_nome, evs, fase, etapas) => {
    const e = roda(evs);
    expect(e.fase).toBe(fase);
    expect(situacoes(e)).toBe(etapas.replace("F", "f"));
  });

  it("estado terminal ignora novos eventos", () => {
    const e = roda([{ t: "etapa", id: "requisitos" }, { t: "falhou", falha }]);
    expect(terminal(e)).toBe(true);
    expect(reduzir(e, { t: "etapa", id: "baixando" })).toBe(e);
    expect(reduzir(e, { t: "concluida", resumo })).toBe(e);
  });

  it("nunca volta de etapa", () => {
    const e = roda([{ t: "etapa", id: "instalando" }]);
    expect(reduzir(e, { t: "etapa", id: "baixando" })).toBe(e);
  });

  it("barra determinística por etapa, monotônica e 100 só no fim", () => {
    let e = estadoInicial();
    const vistos: number[] = [];
    const passo = (ev: EventoInstalacao): void => { e = reduzir(e, ev); vistos.push(percentualDe(e)); };
    passo({ t: "etapa", id: "requisitos" }); passo({ t: "sub", fracao: 0.5 }); passo({ t: "sub", fracao: 1 });
    passo({ t: "etapa", id: "baixando" }); passo({ t: "sub", fracao: 0.5 }); passo({ t: "sub", fracao: 0.2 });
    passo({ t: "etapa", id: "instalando" }); passo({ t: "sub", fracao: 1 });
    passo({ t: "etapa", id: "conferindo" }); passo({ t: "etapa", id: "pronto" });
    expect(vistos).toEqual([...vistos].sort((a, b) => a - b));
    expect(Math.max(...vistos)).toBeLessThan(100);
    expect(vistos[2]).toBe(10); // requisitos completos = peso 10
    expect(vistos[4]).toBe(25); // 10 + 30 * 0.5
    expect(vistos[5]).toBe(25); // fração nunca recua
    passo({ t: "concluida", resumo });
    expect(percentualDe(e)).toBe(100);
  });

  it("fração inválida é ignorada e fica entre 0 e 1", () => {
    let e = roda([{ t: "etapa", id: "baixando" }]);
    e = reduzir(e, { t: "sub", fracao: Number.NaN });
    expect(e.sub).toBe(0);
    e = reduzir(e, { t: "sub", fracao: 7 });
    expect(e.sub).toBe(1);
  });
});
