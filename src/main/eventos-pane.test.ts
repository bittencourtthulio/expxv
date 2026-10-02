import { describe, expect, it } from "vitest";
import type { EventoTerminal } from "../compartilhado/terminais";
import type { Pane } from "../nucleo/dominio/tipos";
import { criarBarramento } from "./barramento";
import { ligarEventosDePane } from "./eventos-pane";

describe("ligarEventosDePane", () => {
  function montar() {
    const panes = new Map<string, Partial<Pane>>([["p1", { id: "p1", estado: "pronto", encerrado_motivo: null }]]);
    let ouvinte: ((e: EventoTerminal) => void) | null = null;
    const barramento = criarBarramento();
    const vistos: Array<[string, unknown]> = [];
    for (const t of ["pane.state_changed", "pane.closed"]) barramento.assinar(t, (p) => vistos.push([t, p]));
    const desligar = ligarEventosDePane({
      sessoes: { assinar: (fn) => ((ouvinte = fn), () => (ouvinte = null)) },
      paneDaSessao: (s) => (s === "s1" ? "p1" : null),
      obterPane: (id) => panes.get(id) as Pane | undefined,
      barramento,
    });
    const evento = (tipo: "atividade" | "encerramento", sessao = "s1") => ouvinte?.({ tipo, sessao_id: sessao, atividade: "pronto" } as unknown as EventoTerminal);
    return { panes, vistos, evento, desligar, ligado: () => ouvinte !== null };
  }

  it("publica a mudança de estado uma vez e ignora repetição e sessão desconhecida", () => {
    const m = montar();
    m.evento("atividade");
    m.evento("atividade");
    m.evento("atividade", "outra");
    expect(m.vistos).toEqual([["pane.state_changed", { pane_id: "p1", estado: "pronto" }]]);
    m.panes.set("p1", { id: "p1", estado: "trabalhando" });
    m.evento("atividade");
    expect(m.vistos).toHaveLength(2);
  });

  it("encerramento publica state_changed e pane.closed com o motivo", () => {
    const m = montar();
    m.panes.set("p1", { id: "p1", estado: "encerrado", encerrado_motivo: "superseded" });
    m.evento("encerramento");
    expect(m.vistos).toEqual([
      ["pane.state_changed", { pane_id: "p1", estado: "encerrado" }],
      ["pane.closed", { pane_id: "p1", reason: "superseded" }],
    ]);
  });

  it("desligar solta a assinatura", () => {
    const m = montar();
    m.desligar();
    expect(m.ligado()).toBe(false);
  });
});
