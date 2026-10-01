import { describe, expect, it } from "vitest";
import { MENSAGEM_LEMBRETE, criarVigiaFallback } from "./fallback";

function montar(opc: { handoff?: boolean; aceita?: boolean } = {}) {
  let agora = 1_000_000;
  const estado = { handoff: opc.handoff ?? false, aceita: opc.aceita ?? true };
  const enviados: string[] = [];
  const vigia = criarVigiaFallback({
    relogio: { agora: () => agora },
    handoffRegistrado: async () => estado.handoff,
    enviarLembrete: async (_p, t) => { if (estado.aceita) enviados.push(t); return estado.aceita; },
    handoffTimeoutMs: 60_000,
    ociosidadeMinimaMs: 10_000,
  });
  return { vigia, estado, enviados, avancar: (ms: number) => { agora += ms; } };
}

describe("fallback para CLIs sem hook", () => {
  it("reenvia o lembrete UMA vez após handoff_timeout E ociosidade; nunca duas", async () => {
    const t = montar();
    t.vigia.iniciar("w1");
    t.vigia.aoMudarEstado("w1", "pronto");
    t.avancar(70_000);
    await t.vigia.avaliar();
    expect(t.enviados).toEqual([MENSAGEM_LEMBRETE]);
    for (let i = 0; i < 5; i++) { t.avancar(120_000); await t.vigia.avaliar(); }
    t.vigia.aoMudarEstado("w1", "trabalhando");
    t.vigia.aoMudarEstado("w1", "pronto");
    t.avancar(120_000);
    await t.vigia.avaliar("w1");
    expect(t.enviados).toHaveLength(1);
    expect(t.vigia.lembretesEnviados("w1")).toBe(1);
  });

  it("não age antes do handoff_timeout, mesmo ocioso", async () => {
    const t = montar();
    t.vigia.iniciar("w1");
    t.vigia.aoMudarEstado("w1", "pronto");
    t.avancar(30_000);
    await t.vigia.avaliar();
    expect(t.enviados).toHaveLength(0);
  });

  it("não age enquanto o Pane está trabalhando ou ocioso há pouco (falso negativo)", async () => {
    const t = montar();
    t.vigia.iniciar("w1");
    t.vigia.aoMudarEstado("w1", "trabalhando");
    t.avancar(120_000);
    await t.vigia.avaliar();
    expect(t.enviados).toHaveLength(0);
    t.vigia.aoMudarEstado("w1", "pronto");
    t.avancar(2_000);
    await t.vigia.avaliar();
    expect(t.enviados).toHaveLength(0);
    t.avancar(9_000);
    await t.vigia.avaliar();
    expect(t.enviados).toHaveLength(1);
  });

  it("checagem fresca: se o handoff já existe, não lembra", async () => {
    const t = montar({ handoff: true });
    t.vigia.iniciar("w1");
    t.vigia.aoMudarEstado("w1", "pronto");
    t.avancar(120_000);
    await t.vigia.avaliar();
    expect(t.enviados).toHaveLength(0);
  });

  it("Pane encerrado sai da vigia; lembrete recusado pode ser tentado de novo", async () => {
    const t = montar({ aceita: false });
    t.vigia.iniciar("w1");
    t.vigia.aoMudarEstado("w1", "pronto");
    t.avancar(120_000);
    await t.vigia.avaliar();
    expect(t.vigia.lembretesEnviados("w1")).toBe(0);
    t.estado.aceita = true;
    await t.vigia.avaliar();
    expect(t.enviados).toHaveLength(1);
    t.vigia.aoMudarEstado("w1", "encerrado");
    await t.vigia.avaliar();
    expect(t.enviados).toHaveLength(1);
  });
});
