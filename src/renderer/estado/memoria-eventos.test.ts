import { describe, expect, it, vi } from "vitest";
import type { ApiMemoria, EventoMemoria } from "../../compartilhado/memoria";
import { memoriaFalso } from "../a11y/ade-falso-memoria";
import { criarEventosMemoria, textoDoAviso } from "./memoria-eventos";

const montar = () => {
  let emitir: (e: EventoMemoria) => void = () => undefined;
  const cancelar = vi.fn();
  const assinar = vi.fn((cb: (e: EventoMemoria) => void) => { emitir = cb; return cancelar; });
  const avisar = vi.fn();
  const ev = criarEventosMemoria({ api: () => memoriaFalso({ assinar } as Partial<ApiMemoria>), avisar });
  return { ev, assinar, cancelar, avisar, emitir: (e: EventoMemoria) => emitir(e) };
};

describe("eventos da memória fora da tela", () => {
  it("liga uma só assinatura (idempotente) e desliga limpando", () => {
    const { ev, assinar, cancelar } = montar();
    const d1 = ev.ligar();
    ev.ligar();
    expect(assinar).toHaveBeenCalledTimes(1);
    d1();
    expect(cancelar).toHaveBeenCalledTimes(1);
    ev.ligar();
    expect(assinar).toHaveBeenCalledTimes(2);
  });
  it("brief_montado guarda por Pane e notifica quem lê", () => {
    const { ev, emitir } = montar();
    ev.ligar();
    const ouvinte = vi.fn();
    ev.assinar(ouvinte);
    emitir({ canal: "memoria:brief_montado", payload: { pane_id: "p1", caracteres: 4200, truncado: true } });
    expect(ev.obter()["p1"]).toEqual({ caracteres: 4200, truncado: true });
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
  it("avisos viram toast com o tom certo; FTS5 só uma vez; mensagem limpa de controles e limitada", () => {
    const { ev, emitir, avisar } = montar();
    ev.ligar();
    emitir({ canal: "memoria:aviso", payload: { pane_id: "p1", codigo: "brief_falhou", mensagem: "falhou\u0007 " + "x".repeat(500) } });
    expect(avisar).toHaveBeenLastCalledWith(expect.stringContaining("sem o brief"), "aviso");
    expect((avisar.mock.calls[0]![0] as string).length).toBeLessThan(400);
    expect(avisar.mock.calls[0]![0]).not.toContain("\u0007");
    emitir({ canal: "memoria:aviso", payload: { pane_id: null, codigo: "limite_atingido", mensagem: "teto" } });
    expect(avisar).toHaveBeenLastCalledWith(expect.stringContaining("no limite"), "aviso");
    emitir({ canal: "memoria:aviso", payload: { pane_id: null, codigo: "fts5_indisponivel", mensagem: "" } });
    emitir({ canal: "memoria:aviso", payload: { pane_id: null, codigo: "fts5_indisponivel", mensagem: "" } });
    expect(avisar).toHaveBeenCalledTimes(3);
  });
  it("sem canal ou sem assinar não faz nada nem lança", () => {
    const ev = criarEventosMemoria({ api: () => undefined });
    expect(() => ev.ligar()()).not.toThrow();
    expect(textoDoAviso({ pane_id: null, codigo: "brief_falhou", mensagem: "" }).texto).toMatch(/sem o brief/);
  });
});
