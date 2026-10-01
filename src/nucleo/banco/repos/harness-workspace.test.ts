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

import { configHarnessPadrao } from "./harness-workspace";
import { modoTrocaEfetivo } from "../../../compartilhado/harness";

describe("repo harness-workspace", () => {
  it("sem linha devolve os padrões P-28 (nível 4, 85/100, margem 10, até 3 saltos, troca entre provedores, faixa mesma)", () => {
    const { r, ws } = novo();
    const c = r.harnessWorkspace.obter(ws.id);
    expect(c).toMatchObject({ nivel: 4, modo_troca: null, limiar_troca_pct: 85, limiar_esgotamento_pct: 100, margem_troca_pontos: 10, troca_entre_provedores: true, faixa_minima_troca: "mesma", max_saltos: 3, piloto_edita_politica: false, injetar_cofre_no_env: false });
    expect(r.harnessWorkspace.existe(ws.id)).toBe(false);
    expect(modoTrocaEfetivo(c.modo_troca, "seguro")).toBe("so_sugerir");
    expect(modoTrocaEfetivo(c.modo_troca, "automatico")).toBe("automatico");
    expect(modoTrocaEfetivo("manual", "automatico")).toBe("manual");
  });

  it("grava os três modos, descer_1 e max_saltos; restaurar volta ao padrão", () => {
    const { r, ws } = novo();
    for (const modo of ["manual", "so_sugerir", "automatico"] as const) {
      expect(r.harnessWorkspace.gravar({ ...configHarnessPadrao(ws.id), modo_troca: modo }).modo_troca).toBe(modo);
    }
    const g = r.harnessWorkspace.gravar({ ...configHarnessPadrao(ws.id), faixa_minima_troca: "descer_1", max_saltos: 5, troca_entre_provedores: false, injetar_cofre_no_env: true });
    expect(g).toMatchObject({ faixa_minima_troca: "descer_1", max_saltos: 5, troca_entre_provedores: false, injetar_cofre_no_env: true });
    expect(r.harnessWorkspace.existe(ws.id)).toBe(true);
    r.harnessWorkspace.restaurar(ws.id);
    expect(r.harnessWorkspace.obter(ws.id).faixa_minima_troca).toBe("mesma");
  });

  it("limiar_troca ≥ limiar_esgotamento e valores fora da faixa são recusados", () => {
    const { r, ws } = novo();
    const p = configHarnessPadrao(ws.id);
    expect(() => r.harnessWorkspace.gravar({ ...p, limiar_troca_pct: 90, limiar_esgotamento_pct: 90 })).toThrow(ValorInvalidoErro);
    expect(() => r.harnessWorkspace.gravar({ ...p, limiar_troca_pct: 99, limiar_esgotamento_pct: 60 })).toThrow(ValorInvalidoErro);
    expect(() => r.harnessWorkspace.gravar({ ...p, nivel: 5 })).toThrow(ValorInvalidoErro);
    expect(() => r.harnessWorkspace.gravar({ ...p, max_saltos: 0 })).toThrow(ValorInvalidoErro);
    expect(() => r.harnessWorkspace.gravar({ ...p, faixa_minima_troca: "uma_abaixo" as never })).toThrow(ValorInvalidoErro);
    expect(() => r.harnessWorkspace.gravar({ ...p, modo_troca: "sempre" as never })).toThrow(ValorInvalidoErro);
    expect(() => r.harnessWorkspace.gravar({ ...p, workspace_id: "ws_inexistente" })).toThrow(/FOREIGN KEY/i);
    expect(r.harnessWorkspace.existe(ws.id)).toBe(false);
  });
});
