import { describe, expect, it } from "vitest";
import type { BichinhoVisao } from "../../../compartilhado/bichinho";
import { ACOES, EVENTOS, FASES, LIMITE_SOLTOS, TABELA, escolherAcao, podePassear, selecionarPasseantes, transicao, trabalhando, type ContextoPasseio, type Evento, type Fase } from "./maquina";
import { criarSorteio } from "./geometria";

const ctx = (o: Partial<ContextoPasseio> = {}): ContextoPasseio => ({ ligado: true, mostrar: true, semMovimento: false, oculta: false, ocioso: true, forcado: false, ...o });
const vis = (humor: BichinhoVisao["humor"], nivel: 0 | 1 | 2 | 3 | 4 = 0) => ({ humor, esforco: { nivel, origem: "nenhuma" as const, tokens_por_min: null, bytes_por_s: 0, sessoes_fluindo: 0 } });

describe("máquina de estados do passeio: tabela", () => {
  const casos: Array<[Fase, Evento, Fase]> = [
    ["no_posto", "ocioso", "saindo"], ["no_posto", "atividade", "no_posto"], ["no_posto", "trabalho", "no_posto"],
    ["saindo", "saiu", "andando"], ["saindo", "atividade", "voltando"],
    ["andando", "chegou_acao", "fazendo_algo"], ["andando", "chegou_cama", "deitando"], ["andando", "atividade", "voltando"], ["andando", "trabalho", "voltando"],
    ["fazendo_algo", "fim_acao", "andando"], ["fazendo_algo", "atividade", "voltando"], ["fazendo_algo", "trabalho", "voltando"],
    ["deitando", "deitou", "dormindo"], ["deitando", "atividade", "voltando"],
    ["dormindo", "acordar", "acordando"], ["dormindo", "atividade", "voltando"], ["dormindo", "trabalho", "voltando"],
    ["acordando", "levantou", "andando"], ["acordando", "atividade", "voltando"],
    ["voltando", "voltou", "no_posto"], ["voltando", "ocioso", "voltando"], ["voltando", "atividade", "voltando"],
    ["dormindo", "chegou_acao", "dormindo"], ["fazendo_algo", "ocioso", "fazendo_algo"],
  ];
  it.each(casos)("%s + %s → %s", (de, ev, para) => { expect(transicao(de, ev)).toBe(para); });
  it("de qualquer fase fora do posto, atividade e trabalho levam a 'voltando'", () => {
    for (const f of FASES) if (f !== "no_posto" && f !== "voltando") for (const e of ["atividade", "trabalho"] as const) expect(TABELA[f][e]).toBe("voltando");
  });
  it("todo evento e fase da tabela existem nas listas", () => {
    for (const f of FASES) for (const e of Object.keys(TABELA[f])) expect(EVENTOS).toContain(e);
  });
});

describe("quem pode passear", () => {
  it("ocioso → sai; atividade (não ocioso) → não sai", () => {
    expect(podePassear(ctx(), false)).toBe(true);
    expect(podePassear(ctx({ ocioso: false }), false)).toBe(false);
  });
  it("workspace trabalhando NÃO passeia, ocioso sim", () => {
    expect(podePassear(ctx(), true)).toBe(false);
    expect(trabalhando(vis("trabalhando"))).toBe(true);
    expect(trabalhando(vis("aguardando"))).toBe(true);
    expect(trabalhando(vis("pensando"))).toBe(true);
    expect(trabalhando(vis("ocioso", 1))).toBe(true);
    expect(trabalhando(vis("ocioso", 0))).toBe(false);
    expect(trabalhando(vis("dormindo"))).toBe(false);
    expect(trabalhando(undefined)).toBe(false);
  });
  it("reduzir movimento, silenciar, janela oculta, preferência desligada ou bichinhos escondidos: ninguém sai", () => {
    expect(podePassear(ctx({ semMovimento: true }), false)).toBe(false);
    expect(podePassear(ctx({ oculta: true }), false)).toBe(false);
    expect(podePassear(ctx({ ligado: false }), false)).toBe(false);
    expect(podePassear(ctx({ mostrar: false }), false)).toBe(false);
  });
  it("o segredo força a saída (mesmo trabalhando, sem ociosidade), mas nunca contra movimento reduzido", () => {
    expect(podePassear(ctx({ forcado: true, ocioso: false, ligado: false }), true)).toBe(true);
    expect(podePassear(ctx({ forcado: true, semMovimento: true }), false)).toBe(false);
  });
  it("limite de 8: só os mais recentes passeiam", () => {
    const cands = Array.from({ length: 11 }, (_, i) => ({ chave: `c${i}`, em: i }));
    const r = selecionarPasseantes(cands);
    expect(r).toHaveLength(LIMITE_SOLTOS);
    expect(r[0]).toBe("c10");
    expect(r).not.toContain("c0");
    expect(r).not.toContain("c2");
    expect(selecionarPasseantes(cands, 3)).toEqual(["c10", "c9", "c8"]);
  });
});

describe("ações", () => {
  it("há de 4 a 8 ações genéricas e nunca repete a anterior", () => {
    expect(ACOES.length).toBeGreaterThanOrEqual(4);
    const s = criarSorteio(7);
    let ant: (typeof ACOES)[number] | null = null;
    for (let i = 0; i < 200; i++) { const a = escolherAcao(s, undefined, ant); expect(a).not.toBe(ant); ant = a; }
  });
  it("é determinística pela semente", () => {
    const a = Array.from({ length: 10 }, ((s) => () => escolherAcao(s, "curioso", null))(criarSorteio(3)));
    const b = Array.from({ length: 10 }, ((s) => () => escolherAcao(s, "curioso", null))(criarSorteio(3)));
    expect(a).toEqual(b);
  });
});
