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

describe("repo limite-manual", () => {
  it("define (upsert por conta+janela), lista e limpa por janela ou tudo", () => {
    const { r, conta } = novo();
    r.limiteManual.definir(conta.id, "weekly", 40, "2026-01-08T00:00:00.000Z");
    const m = r.limiteManual.definir(conta.id, "weekly", 55, null);
    expect(m).toMatchObject({ usado_pct: 55, reinicia_em: null });
    r.limiteManual.definir(conta.id, "five_hour", 10, "2026-01-01T05:00:00.000Z");
    expect(r.limiteManual.listar(conta.id).map((l) => l.janela)).toEqual(["five_hour", "weekly"]);
    expect(r.limiteManual.limpar(conta.id, "weekly")).toBe(1);
    expect(r.limiteManual.limpar(conta.id)).toBe(1);
    expect(r.limiteManual.listar()).toEqual([]);
  });

  it("recusa 0..100 violado, janela credit, conta inexistente; vencidos são removidos e sobrevivem ao reabrir o repositório", () => {
    const { r, conta, b } = novo();
    expect(() => r.limiteManual.definir(conta.id, "weekly", 101, null)).toThrow(ValorInvalidoErro);
    expect(() => r.limiteManual.definir(conta.id, "weekly", Number.NaN, null)).toThrow(ValorInvalidoErro);
    expect(() => r.limiteManual.definir(conta.id, "credit" as never, 10, null)).toThrow(ValorInvalidoErro);
    expect(() => r.limiteManual.definir("conta_x", "weekly", 10, null)).toThrow(NaoEncontradoErro);
    r.limiteManual.definir(conta.id, "five_hour", 90, "2026-01-01T05:00:00.000Z");
    r.limiteManual.definir(conta.id, "weekly", 20, "2026-01-08T00:00:00.000Z");
    r.limiteManual.definir(conta.id, "monthly", 5, null);
    expect(criarRepositoriosNovo(b).limiteManual.listar()).toHaveLength(3); // persiste no banco
    expect(r.limiteManual.limparVencidos("2026-01-02T00:00:00.000Z")).toBe(1);
    expect(r.limiteManual.listar().map((l) => l.janela)).toEqual(["monthly", "weekly"]);
  });
});
import { criarRepositorios as criarRepositoriosNovo } from "./index";
