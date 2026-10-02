import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => {
  const ouvintes = new Set<() => void>();
  return {
    ouvintes,
    sessoes: [] as Array<{ sessao_id: string; estado: string }>,
    pedirTela: vi.fn(),
    pedirAcao: vi.fn(),
  };
});
vi.mock("./navegacao", () => ({ pedirTela: ctx.pedirTela, pedirAcao: ctx.pedirAcao }));
vi.mock("./terminais", () => ({
  storeTerminais: {
    obter: () => ({ sessoes: ctx.sessoes }),
    assinar: (o: () => void) => { ctx.ouvintes.add(o); return () => void ctx.ouvintes.delete(o); },
  },
}));
import { abrirTerminalDeLogin, COMANDO_LOGIN_GH } from "./adicionar-login";

beforeEach(() => { vi.useFakeTimers(); ctx.sessoes = [{ sessao_id: "antiga", estado: "executando" }]; ctx.ouvintes.clear(); ctx.pedirTela.mockClear(); ctx.pedirAcao.mockClear(); });
afterEach(() => vi.useRealTimers());

describe("abrirTerminalDeLogin", () => {
  it("abre um terminal novo e DIGITA o comando sem Enter (nunca executa o login)", () => {
    const escrever = vi.fn();
    abrirTerminalDeLogin({ escrever });
    expect(ctx.pedirTela).toHaveBeenCalledWith("terminais");
    expect(ctx.pedirAcao).toHaveBeenCalledWith("novo-terminal");
    ctx.sessoes = [...ctx.sessoes, { sessao_id: "nova", estado: "executando" }];
    ctx.ouvintes.forEach((o) => o());
    vi.advanceTimersByTime(500);
    expect(escrever).toHaveBeenCalledTimes(1);
    expect(escrever).toHaveBeenCalledWith("nova", COMANDO_LOGIN_GH);
    expect(escrever.mock.calls[0]?.[1]).not.toMatch(/[\r\n]/);
    expect(ctx.ouvintes.size).toBe(0); // parou de ouvir
  });
  it("sessão antiga nunca recebe o comando; sem sessão nova no prazo, desiste", () => {
    const escrever = vi.fn();
    abrirTerminalDeLogin({ escrever });
    ctx.ouvintes.forEach((o) => o());
    vi.advanceTimersByTime(10_000);
    expect(escrever).not.toHaveBeenCalled();
    expect(ctx.ouvintes.size).toBe(0);
  });
  it("o comando é só o login do GitHub, sem token", () => {
    expect(COMANDO_LOGIN_GH).toBe("gh auth login --hostname github.com");
  });
});
