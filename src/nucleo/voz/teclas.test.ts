import { describe, expect, it } from "vitest";
import { teclaNativaIndisponivel, validarAtalho } from "./teclas";

describe("validação de atalho de voz", () => {
  it("aceita Cmd+Shift+Space no mac e Ctrl+Shift+Space no Windows", () => {
    expect(validarAtalho("Command+Shift+Space", { plataforma: "mac" })).toEqual({ ok: true, acelerador: "Command+Shift+Space" });
    expect(validarAtalho("Control+Shift+Space", { plataforma: "windows" }).ok).toBe(true);
  });
  it("modificador isolado (Option direita) não é aceito, com explicação", () => {
    const r = validarAtalho("Alt", { plataforma: "mac" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/Modificador/);
    expect(validarAtalho("Command+Shift", { plataforma: "mac" }).ok).toBe(false);
  });
  it("Windows/Linux recusa Ctrl+letra pura (D-37)", () => {
    expect(validarAtalho("Control+K", { plataforma: "windows" }).ok).toBe(false);
    expect(validarAtalho("Control+Shift+K", { plataforma: "linux" }).ok).toBe(true);
  });
  it("conflito com atalho do menu é recusado", () => {
    expect(validarAtalho("Command+Shift+5", { plataforma: "mac", reservados: ["shift+command+5"] }).ok).toBe(false);
  });
  it("tecla inválida e repetição são recusadas", () => {
    expect(validarAtalho("Command+Shift+??", { plataforma: "mac" }).ok).toBe(false);
    expect(validarAtalho("Command+Command+K", { plataforma: "mac" }).ok).toBe(false);
  });
  it("adaptador nativo responde indisponível (P-35)", () => {
    expect(teclaNativaIndisponivel.disponivel).toBe(false);
    expect(teclaNativaIndisponivel.registrar("Alt+Space", () => undefined)).toBe(false);
  });
});
