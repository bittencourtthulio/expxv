import { describe, expect, it } from "vitest";
import { atribuir, chaveCard, janelasDoBanco, janelasDoRastro, reatribuir, type JanelaTask } from "./atribuicao";

const j = (task: string, inicio: string, fim: string | null, trab = "T1"): JanelaTask => ({ trabalho_id: trab, task_id: task, inicio, fim });
const ex = { papel: "executor" };

describe("atribuir", () => {
  it("piloto é sempre orquestração, mesmo dentro de uma janela de card", () => {
    expect(atribuir("2026-01-01T10:05:00Z", [j("T-01.01", "2026-01-01T10:00:00Z", null)], { papel: "piloto" }).atribuicao).toBe("orquestracao");
  });
  it("uma janela contendo o instante ⇒ card; nenhuma ⇒ sem_card", () => {
    const js = [j("T-01.01", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z")];
    expect(atribuir("2026-01-01T10:30:00Z", js, ex)).toEqual({ atribuicao: "card", trabalho_id: "T1", task_id: "T-01.01" });
    expect(atribuir("2026-01-01T09:59:59Z", js, ex).atribuicao).toBe("sem_card");
    expect(atribuir("2026-01-01T12:00:00Z", js, ex).atribuicao).toBe("sem_card");
    expect(atribuir("2026-01-01T10:30:00Z", [], ex).atribuicao).toBe("sem_card");
  });
  it("dois cards SEQUENCIAIS no mesmo Pane: cada um só a sua janela (CT-10.06), inclusive na borda com tolerância", () => {
    const js = [j("A", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z"), j("B", "2026-01-01T11:00:02Z", "2026-01-01T12:00:00Z")];
    expect(atribuir("2026-01-01T10:59:00Z", js, ex).task_id).toBe("A");
    expect(atribuir("2026-01-01T11:00:01Z", js, ex).task_id).toBe("A"); // tolerância do fim
    expect(atribuir("2026-01-01T11:00:03Z", js, ex).task_id).toBe("B"); // a janela estrita de B vence a tolerância de A
  });
  it("janelas de cards diferentes sobrepostas ⇒ ambígua (CT-10.07)", () => {
    const js = [j("A", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z"), j("B", "2026-01-01T10:30:00Z", null)];
    expect(atribuir("2026-01-01T10:45:00Z", js, ex)).toEqual({ atribuicao: "ambigua", trabalho_id: null, task_id: null });
  });
  it("a mesma task em duas origens (banco e rastro) conta como UM card, não ambiguidade", () => {
    const js = [j("A", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z"), j("A", "2026-01-01T10:00:05Z", "2026-01-01T11:00:00Z")];
    expect(atribuir("2026-01-01T10:30:00Z", js, ex).atribuicao).toBe("card");
  });
  it("janela aberta (fim null) vale até agora; instante inválido ⇒ sem_card", () => {
    expect(atribuir("2026-03-01T00:00:00Z", [j("A", "2026-01-01T10:00:00Z", null)], ex).atribuicao).toBe("card");
    expect(atribuir("lixo", [j("A", "2026-01-01T10:00:00Z", null)], ex).atribuicao).toBe("sem_card");
  });
  it("trabalhos diferentes com a mesma task_id são cards diferentes", () => {
    const js = [j("T-01.01", "2026-01-01T10:00:00Z", null, "X"), j("T-01.01", "2026-01-01T10:00:00Z", null, "Y")];
    expect(atribuir("2026-01-01T10:30:00Z", js, ex).atribuicao).toBe("ambigua");
  });
});

describe("reatribuir", () => {
  const reg = (id: string, ts: string, atribuicao: "card" | "sem_card", task: string | null) => ({ id, ts, atribuicao, trabalho_id: task ? "T1" : null, task_id: task });
  it("task_concluida que chega depois do uso move sem_card para o card (CT-10.12) e é idempotente", () => {
    const regs = [reg("r1", "2026-01-01T10:30:00Z", "sem_card", null)];
    const js = [j("A", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z")];
    const m = reatribuir(regs, js, ex);
    expect(m).toHaveLength(1);
    expect(m[0]?.para).toEqual({ atribuicao: "card", trabalho_id: "T1", task_id: "A" });
    const aplicados = regs.map((r) => ({ ...r, ...(m.find((x) => x.id === r.id)?.para ?? {}) }));
    expect(reatribuir(aplicados, js, ex)).toEqual([]);
  });
  it("não muda o que já está certo", () => {
    expect(reatribuir([reg("r1", "2026-01-01T10:30:00Z", "card", "A")], [j("A", "2026-01-01T10:00:00Z", null)], ex)).toEqual([]);
  });
});

describe("janelas", () => {
  it("do banco: sem reivindicada_em não há janela; aberta tem fim null", () => {
    const js = janelasDoBanco([{ task_ref: "A", reivindicada_em: null, entregue_em: null }, { task_ref: "B", reivindicada_em: "2026-01-01T10:00:00Z", entregue_em: null }, { task_ref: "C", reivindicada_em: "2026-01-01T10:00:00Z", entregue_em: "2026-01-01T11:00:00Z" }], "T1");
    expect(js.map((x) => [x.task_id, x.fim])).toEqual([["B", null], ["C", "2026-01-01T11:00:00Z"]]);
  });
  it("do rastro: só pares explícitos; concluída sem iniciada não gera janela; iniciada sem concluída fica aberta", () => {
    const js = janelasDoRastro(
      [
        { ts: "2026-01-01T10:00:00Z", evento: "task_iniciada", task: "A" },
        { ts: "2026-01-01T11:00:00Z", evento: "task_concluida", task: "A" },
        { ts: "2026-01-01T12:00:00Z", evento: "task_concluida", task: "B" },
        { ts: "2026-01-01T13:00:00Z", evento: "task_iniciada", task: "C" },
        { ts: "2026-01-01T13:00:00Z", evento: "outro", task: null },
      ],
      "T1",
    );
    expect(js.map((x) => [x.task_id, x.inicio, x.fim])).toEqual([["A", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z"], ["C", "2026-01-01T13:00:00Z", null]]);
  });
  it("chaveCard", () => expect(chaveCard("ws_1", "T1", "T-01.02")).toBe("ws_1|T1|T-01.02"));
});
