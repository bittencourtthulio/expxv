import { describe, expect, it } from "vitest";
import { criarNotificadorDeTroca } from "./notificar-troca";

describe("criarNotificadorDeTroca", () => {
  const aviso = { tipo: "sugerida", workspace_id: "ws", pane_id: "p", troca_id: "t", texto: "Conta A a 90%." } as const;
  function montar(extra: { suportado?: boolean; ativo?: boolean; falha?: boolean } = {}) {
    const mostradas: Array<{ title: string; body: string }> = [];
    let aberta = 0;
    const n = criarNotificadorDeTroca({
      suportado: () => extra.suportado ?? true,
      ...(extra.ativo === undefined ? {} : { ativo: () => extra.ativo as boolean }),
      criar: (d, aoClicar) => ({
        show: () => {
          if (extra.falha === true) throw new Error("falhou ao mostrar");
          mostradas.push(d);
          aoClicar();
        },
      }),
      abrirJanela: () => void aberta++,
    });
    return { n, mostradas, aberta: () => aberta };
  }

  it("mostra título e corpo curtos e liga o clique à janela", () => {
    const m = montar();
    expect(m.n(aviso)).toBe(true);
    expect(m.mostradas[0]?.body).toBe("Conta A a 90%.");
    expect(m.mostradas[0]?.title).toContain("Trocar de conta?");
    expect(m.aberta()).toBe(1);
  });

  it("respeita não suportado, pausa e falha sem lançar", () => {
    expect(montar({ suportado: false }).n(aviso)).toBe(false);
    expect(montar({ ativo: false }).n(aviso)).toBe(false);
    expect(montar({ falha: true }).n(aviso)).toBe(false);
  });
});
