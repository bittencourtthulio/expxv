import { describe, expect, it, vi } from "vitest";
import { criarNotificador, montarNotificacaoAtividade } from "./notificar";

function montar(opcoes: { foco?: boolean; suportado?: boolean } = {}) {
  const mostrar = vi.fn();
  const criar = vi.fn(() => ({ show: mostrar }));
  const notificar = criarNotificador({
    suportado: () => opcoes.suportado ?? true,
    criar,
    janelaEmFoco: () => opcoes.foco ?? false,
    nomeDaFerramenta: (id) => (id === "claude" ? "Claude Code" : id),
  });
  return { notificar, criar, mostrar };
}

describe("notificação da sinaleira", () => {
  it("avisa quando o agente termina ou pede aprovação e a janela está sem foco", () => {
    const { notificar, criar, mostrar } = montar();
    expect(notificar("claude", "pronto")).toBe(true);
    expect(notificar("claude", "aguardando")).toBe(true);
    expect(mostrar).toHaveBeenCalledTimes(2);
    const corpos = criar.mock.calls.map((c) => (c as unknown as [{ body: string }])[0].body);
    expect(corpos[0]).toContain("terminou");
    expect(corpos[1]).toContain("aprovação");
  });

  it("não avisa com a janela em foco, enquanto trabalha, ou sem suporte do sistema", () => {
    expect(montar({ foco: true }).notificar("claude", "pronto")).toBe(false);
    expect(montar().notificar("claude", "trabalhando")).toBe(false);
    expect(montar({ suportado: false }).notificar("claude", "pronto")).toBe(false);
  });

  it("o texto só tem metadados: nome da ferramenta e o fato; nada de sessão, caminho ou saída", () => {
    const dados = montarNotificacaoAtividade("pronto", "Claude Code");
    expect(dados?.body).toBe("Claude Code terminou.");
    expect(montarNotificacaoAtividade("trabalhando", "x")).toBeNull();
  });

  it("falha ao criar a notificação não se propaga", () => {
    const notificar = criarNotificador({ suportado: () => true, criar: () => { throw new Error("sem permissão"); }, janelaEmFoco: () => false, nomeDaFerramenta: (i) => i });
    expect(notificar("claude", "pronto")).toBe(false);
  });
});

describe("notificação respeita a preferência", () => {
  it("desligada: não cria nada; ligada de novo: volta a avisar", () => {
    let ligado = false;
    const criar = vi.fn(() => ({ show: vi.fn() }));
    const notificar = criarNotificador({ suportado: () => true, criar, janelaEmFoco: () => false, nomeDaFerramenta: (i) => i, ativo: () => ligado });
    expect(notificar("claude", "pronto")).toBe(false);
    expect(criar).not.toHaveBeenCalled();
    ligado = true;
    expect(notificar("claude", "pronto")).toBe(true);
    expect(criar).toHaveBeenCalledTimes(1);
  });
});
