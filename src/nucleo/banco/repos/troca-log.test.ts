import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { criarRepositorios } from "./index";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";

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

import type { NovaTroca } from "./troca-log";

const troca = (extra: Partial<NovaTroca> = {}): NovaTroca => ({
  workspace_id: "ws_1", de: { conta_id: "conta_1", provedor: "claude", modelo: "opus" }, para: { conta_id: "conta_2", provedor: "claude", modelo: "opus" },
  motivo: "consumo_alto", modo: "automatico", tipo_troca: "outra_conta", consumo_origem_pct: 87, consumo_destino_pct: 20, status: "sugerida", recibo: "r", ...extra,
});

describe("repo troca-log", () => {
  it("insere com id trc_, devolve a Troca do contrato e muda o status (adiada_por só com adiada)", () => {
    const { r } = novo();
    const t = r.trocaLog.inserir(troca({ pane_antigo_id: "pane_1" }));
    expect(t.id).toMatch(/^trc_/);
    expect(t).toMatchObject({ status: "sugerida", motivo: "consumo_alto", de: { provedor: "claude" }, para: { conta_id: "conta_2" }, consumo_origem_pct: 87, adiada_por: null });
    expect(r.trocaLog.atualizarStatus(t.id, "adiada", { adiada_por: "trabalhando" })).toMatchObject({ status: "adiada", adiada_por: "trabalhando" });
    expect(r.trocaLog.pendentesDoPane("pane_1")).toHaveLength(1);
    const feita = r.trocaLog.atualizarStatus(t.id, "feita", { adiada_por: "trabalhando", pane_novo_id: "pane_2", recibo: "feito" });
    expect(feita).toMatchObject({ status: "feita", adiada_por: null, pane_novo_id: "pane_2", recibo: "feito" });
    expect(r.trocaLog.pendentesDoPane("pane_1")).toHaveLength(0);
  });

  it("valida enums, consumo 0..100 e inexistente", () => {
    const { r } = novo();
    expect(() => r.trocaLog.inserir(troca({ motivo: "tedio" as never }))).toThrow(ValorInvalidoErro);
    expect(() => r.trocaLog.inserir(troca({ modo: "sempre" as never }))).toThrow(ValorInvalidoErro);
    expect(() => r.trocaLog.inserir(troca({ consumo_origem_pct: 101 }))).toThrow(ValorInvalidoErro);
    expect(() => r.trocaLog.inserir(troca({ adiada_por: "preguica" }))).toThrow(ValorInvalidoErro);
    expect(() => r.trocaLog.inserir(troca({ recibo: " " }))).toThrow(ValorInvalidoErro);
    expect(() => r.trocaLog.atualizarStatus("trc_x", "feita")).toThrow(NaoEncontradoErro);
    expect(() => r.trocaLog.atualizarStatus(r.trocaLog.inserir(troca()).id, "voou" as never)).toThrow(ValorInvalidoErro);
  });

  it("lista do mais recente com cursor, desde e workspace", () => {
    const { r } = novo();
    for (let i = 0; i < 5; i++) r.trocaLog.inserir(troca({ workspace_id: i < 3 ? "ws_1" : "ws_2" }), `2026-01-0${i + 1}T00:00:00.000Z`);
    const p1 = r.trocaLog.listar({ limite: 2 });
    expect(p1.itens.map((t) => t.criado_em.slice(0, 10))).toEqual(["2026-01-05", "2026-01-04"]);
    expect(r.trocaLog.listar({ limite: 2, cursor: p1.proximo! }).itens.map((t) => t.criado_em.slice(8, 10))).toEqual(["03", "02"]);
    expect(r.trocaLog.listar({ workspace_id: "ws_2" }).itens).toHaveLength(2);
    expect(r.trocaLog.listar({ desde: "2026-01-04T00:00:00.000Z" }).itens).toHaveLength(2);
  });
});
