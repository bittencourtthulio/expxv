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

import type { PerfilAgente } from "../../../compartilhado/harness";

const perfil: PerfilAgente = { agente_id: null, provider: "claude", cli: "claude", modelo: "opus", esforco: null, faixa: "topo" };
function comPane() {
  const m = novo();
  const pane = m.r.pane.criar({ workspace_id: m.ws.id, tipo: "cli", cli: "claude", papel: "executor" } as never);
  return { ...m, pane };
}

describe("repo pane-rota", () => {
  it("grava, lê e sobrescreve a rota preservando ignorar_sugestao_ate; troca soma salto e carimba hora", () => {
    const { r, pane } = comPane();
    const a = r.paneRota.gravar({ pane_id: pane.id, perfil, task_type: "implementar", decisao_id: "dec_1" });
    expect(a).toMatchObject({ perfil, task_type: "implementar", saltos: 0, ultima_troca_em: null });
    r.paneRota.ignorarSugestaoAte(pane.id, "2026-01-01T00:30:00.000Z");
    const t = r.paneRota.registrarTroca(pane.id, "2026-01-01T00:00:00.000Z");
    expect(t).toMatchObject({ saltos: 1, ultima_troca_em: "2026-01-01T00:00:00.000Z", ignorar_sugestao_ate: "2026-01-01T00:30:00.000Z" });
    const b = r.paneRota.gravar({ pane_id: pane.id, perfil: { ...perfil, faixa: "alto" }, saltos: t.saltos });
    expect(b.perfil.faixa).toBe("alto");
    expect(b.ignorar_sugestao_ate).toBe("2026-01-01T00:30:00.000Z");
  });

  it("rota inexistente é erro nominal; apagar o Pane leva a rota em cascata", () => {
    const { r, pane, b } = comPane();
    expect(r.paneRota.obter("pane_x")).toBeUndefined();
    expect(() => r.paneRota.exigir("pane_x")).toThrow(NaoEncontradoErro);
    expect(() => r.paneRota.registrarTroca("pane_x")).toThrow(NaoEncontradoErro);
    expect(() => r.paneRota.gravar({ pane_id: "pane_inexistente", perfil })).toThrow(/FOREIGN KEY/i);
    r.paneRota.gravar({ pane_id: pane.id, perfil });
    b.executar("DELETE FROM pane WHERE id = ?", [pane.id]);
    expect(r.paneRota.obter(pane.id)).toBeUndefined();
  });
});
