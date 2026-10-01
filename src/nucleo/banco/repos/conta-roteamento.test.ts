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

describe("repo conta-roteamento", () => {
  it("conta sem linha devolve padrões sem escrever; config grava reservas, pins e tetos (omitido mantém, null apaga)", () => {
    const { r, ws, conta, b } = novo();
    expect(r.contaRoteamento.obter(conta.id)).toMatchObject({ auth: "desconhecida", reservada_modelos: [], em_cooldown_ate: null, teto_tokens_5h: null });
    expect(b.consultar("SELECT * FROM conta_roteamento")).toHaveLength(0);
    expect(r.contaRoteamento.obter("conta_x")).toBeUndefined();
    const g = r.contaRoteamento.gravarConfig({ conta_id: conta.id, reservada_modelos: ["opus"], reservada_papeis: ["revisor"], workspaces_fixados: [ws.id], teto_tokens_5h: 1000, teto_tokens_semana: 9000 });
    expect(g).toMatchObject({ reservada_modelos: ["opus"], reservada_papeis: ["revisor"], workspaces_fixados: [ws.id], teto_tokens_5h: 1000, teto_tokens_semana: 9000 });
    expect(r.contaRoteamento.gravarConfig({ conta_id: conta.id, reservada_modelos: [], reservada_papeis: [], workspaces_fixados: [] })).toMatchObject({ teto_tokens_5h: 1000, reservada_modelos: [] });
    expect(r.contaRoteamento.gravarConfig({ conta_id: conta.id, reservada_modelos: [], reservada_papeis: [], workspaces_fixados: [], teto_tokens_5h: null }).teto_tokens_5h).toBeNull();
  });

  it("auth, cooldown e listagem (uma linha por conta, com padrão para as sem linha)", () => {
    const { r, conta } = novo();
    const outra = r.conta.criar({ provedor: "codex", rotulo: "c2" });
    expect(r.contaRoteamento.definirAuth(conta.id, "expirada").auth).toBe("expirada");
    expect(r.contaRoteamento.definirCooldown(conta.id, "2026-01-01T00:05:00.000Z").em_cooldown_ate).toBe("2026-01-01T00:05:00.000Z");
    expect(r.contaRoteamento.definirCooldown(conta.id, null).em_cooldown_ate).toBeNull();
    const l = r.contaRoteamento.listar();
    expect(l.map((c) => c.conta_id).sort()).toEqual([conta.id, outra.id].sort());
    expect(l.find((c) => c.conta_id === outra.id)?.auth).toBe("desconhecida");
  });

  it("erros nominais: conta inexistente, papel inválido, auth inválida, teto inválido", () => {
    const { r, conta } = novo();
    const base = { reservada_modelos: [], reservada_papeis: [], workspaces_fixados: [] };
    expect(() => r.contaRoteamento.gravarConfig({ conta_id: "conta_x", ...base })).toThrow(NaoEncontradoErro);
    expect(() => r.contaRoteamento.gravarConfig({ conta_id: conta.id, ...base, reservada_papeis: ["rei" as never] })).toThrow(ValorInvalidoErro);
    expect(() => r.contaRoteamento.definirAuth(conta.id, "talvez" as never)).toThrow(ValorInvalidoErro);
    expect(() => r.contaRoteamento.gravarConfig({ conta_id: conta.id, ...base, teto_tokens_5h: 0 })).toThrow(ValorInvalidoErro);
    expect(() => r.contaRoteamento.definirCooldown("conta_x", null)).toThrow(NaoEncontradoErro);
  });
});
