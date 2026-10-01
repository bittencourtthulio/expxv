import { describe, expect, it, vi } from "vitest";
import { encaminharEventoMenu } from "./encaminhar-menu";

function montar() {
  const enviar = vi.fn();
  const definirTema = vi.fn();
  return { enviar, definirTema, enc: (e: Parameters<typeof encaminharEventoMenu>[0]) => encaminharEventoMenu(e, { enviar, definirTema }) };
}

describe("encaminharEventoMenu", () => {
  it("abrir-projeto, paleta e sobre vão ao renderer pelo canal app:menu", () => {
    const m = montar();
    m.enc({ tipo: "abrir-projeto" });
    m.enc({ tipo: "paleta" });
    m.enc({ tipo: "sobre" });
    expect(m.enviar.mock.calls).toEqual([
      ["app:menu", { acao: "abrir-projeto" }],
      ["app:menu", { acao: "paleta" }],
      ["app:menu", { acao: "sobre" }],
    ]);
    expect(m.definirTema).not.toHaveBeenCalled();
  });
  it("tema 'alternar' vai ao renderer (que sabe o efetivo); valor explícito é aplicado no main", () => {
    const m = montar();
    m.enc({ tipo: "tema", valor: "alternar" });
    expect(m.enviar).toHaveBeenCalledWith("app:menu", { acao: "tema" });
    m.enviar.mockClear();
    m.enc({ tipo: "tema", valor: "escuro" });
    expect(m.definirTema).toHaveBeenCalledWith("escuro");
    expect(m.enviar).not.toHaveBeenCalled();
  });
});
