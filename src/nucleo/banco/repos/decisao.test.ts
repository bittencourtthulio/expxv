import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { criarRepositorios } from "./index";
import { ErroDominio, NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const r = criarRepositorios(b);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const conta = r.conta.criar({ provedor: "claude", rotulo: "c1" });
  return { b, r, ws, conta };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

import type { DecisaoEntrada } from "../../../compartilhado/harness";

function dec(extra: Partial<DecisaoEntrada> = {}): DecisaoEntrada {
  return {
    proposito: "selecao_conta", workspace_id: "ws_1", mission_id: null, pane_id: null, tipo: "choice", opcoes: ["a", "b"], probs: null, escolhida: "a", confianca: null,
    fonte: "regra", escolha_regra: "a", divergiu: false, latencia_ms: null, custo_usd: null, custo_origem: "desconhecido", decisor: null, resumo_enviado: null,
    resumo_hash: null, skills_aplicadas: false, recibo: "Conta c1 escolhida por regra.", ...extra,
  };
}

describe("repo decisao", () => {
  it("grava com id dec_, escolhida ∈ opcoes, custo desconhecido = null (nunca 0) e lista paginada do mais recente", () => {
    const { r } = novo();
    const a = r.decisao.inserir(dec(), "2026-01-01T00:00:00.000Z");
    expect(a.id).toMatch(/^dec_/);
    expect(a.custo_usd).toBeNull();
    expect(() => r.decisao.inserir(dec({ escolhida: "z" }))).toThrow(ValorInvalidoErro);
    expect(() => r.decisao.inserir(dec({ opcoes: [] }))).toThrow(ValorInvalidoErro);
    expect(() => r.decisao.inserir(dec({ resumo_enviado: "x".repeat(501) }))).toThrow(ValorInvalidoErro);
    expect(() => r.decisao.inserir(dec({ custo_usd: -1 }))).toThrow(ValorInvalidoErro);
    expect(() => r.decisao.inserir(dec({ custo_usd: Number.NaN }))).toThrow(ValorInvalidoErro);
    for (let i = 0; i < 4; i++) r.decisao.inserir(dec({ proposito: i % 2 ? "troca" : "task_type" }), `2026-01-0${i + 2}T00:00:00.000Z`);
    const p1 = r.decisao.listar({ limite: 3 });
    expect(p1.itens).toHaveLength(3);
    expect(p1.itens[0]!.criado_em > p1.itens[2]!.criado_em).toBe(true);
    const p2 = r.decisao.listar({ limite: 3, cursor: p1.proximo! });
    expect(p2.itens).toHaveLength(2);
    expect(p2.proximo).toBeNull();
    expect(r.decisao.listar({ proposito: "troca" }).itens).toHaveLength(2);
    expect(r.decisao.listar({ desde: "2026-01-04T00:00:00.000Z" }).itens).toHaveLength(2);
  });

  it("totais: custo só dos conhecidos; nenhum conhecido = null; desconhecidos contados à parte (CT-9.12)", () => {
    const { r } = novo();
    expect(r.decisao.totais()).toEqual({ consultas: 0, custo_usd: null, custo_desconhecido: 0 });
    r.decisao.inserir(dec());
    expect(r.decisao.totais()).toEqual({ consultas: 1, custo_usd: null, custo_desconhecido: 1 });
    for (let i = 0; i < 127; i++) r.decisao.inserir(dec({ fonte: "decisor", custo_usd: 0.0002, custo_origem: "resposta" }));
    const t = r.decisao.totais();
    expect(t.consultas).toBe(128);
    expect(t.custo_desconhecido).toBe(1);
    expect(t.custo_usd).toBeCloseTo(0.0254, 6);
  });

  it("compactar: soma por dia/propósito, apaga em lotes, é idempotente e não perde custo conhecido", () => {
    const { r } = novo();
    for (let i = 0; i < 25; i++) {
      r.decisao.inserir(dec({ fonte: i % 5 === 0 ? "fallback" : "decisor", divergiu: i % 10 === 0, custo_usd: i % 2 ? 0.01 : null, custo_origem: i % 2 ? "resposta" : "desconhecido" }), "2025-01-01T10:00:00.000Z");
    }
    r.decisao.inserir(dec(), "2026-06-01T00:00:00.000Z");
    expect(r.decisao.compactar("2026-01-01T00:00:00.000Z", 10)).toBe(25);
    expect(r.decisao.listar().itens).toHaveLength(1);
    expect(r.decisao.compactar("2026-01-01T00:00:00.000Z", 10)).toBe(0);
    const ag = r.decisao.agregadoDoDia("2025-01-01");
    expect(ag).toHaveLength(1);
    expect(ag[0]).toMatchObject({ proposito: "selecao_conta", consultas: 25, falhas: 5, divergencias: 3, custo_desconhecido: 13 });
    expect(ag[0]!.custo_usd).toBeCloseTo(0.12, 9);
    // segunda leva no mesmo dia acumula
    r.decisao.inserir(dec({ custo_usd: 0.5, custo_origem: "tabela" }), "2025-01-01T23:00:00.000Z");
    r.decisao.compactar("2026-01-01T00:00:00.000Z");
    const depois = r.decisao.agregadoDoDia("2025-01-01")[0]!;
    expect(depois.consultas).toBe(26);
    expect(depois.custo_usd).toBeCloseTo(0.62, 9);
  });
});
