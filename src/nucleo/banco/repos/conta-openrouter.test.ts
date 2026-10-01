import { afterEach, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
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
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

function comContaOr() {
  const m = novo();
  const or = m.r.conta.criar({ provedor: "openrouter", rotulo: "or·1" });
  return { ...m, or };
}

describe("repo conta-openrouter", () => {
  it("grava só a referência do cofre e a máscara; saldo começa null (nunca 0) e atualiza", () => {
    const { r, or } = comContaOr();
    const c = r.contaOpenrouter.gravar({ conta_id: or.id, cofre_entrada_id: "OPENROUTER_KEY_x", ultimos4: "ab12" });
    expect(c).toMatchObject({ rotulo: "or·1", ultimos4: "ab12", tipo: "desconhecido", limite_usd: null, usado_usd: null, saldo_usd: null, saldo_em: null });
    const s = r.contaOpenrouter.atualizarSaldo(or.id, { tipo: "pago", limite_usd: 10, usado_usd: 9, saldo_em: "2026-01-01T00:00:00.000Z" });
    expect(s).toMatchObject({ tipo: "pago", limite_usd: 10, usado_usd: 9, saldo_usd: null });
    const sem = r.contaOpenrouter.atualizarSaldo(or.id, { saldo_em: "2026-01-01T01:00:00.000Z", limite_usd: Number.NaN, usado_usd: -3 });
    expect(sem).toMatchObject({ tipo: "desconhecido", limite_usd: null, usado_usd: null });
    expect(r.contaOpenrouter.gravar({ conta_id: or.id, cofre_entrada_id: "OUTRA", ultimos4: "zz99" }).ultimos4).toBe("zz99");
    expect(r.contaOpenrouter.listar()).toHaveLength(1);
    expect(r.contaOpenrouter.remover(or.id)).toBe(true);
    expect(r.contaOpenrouter.obter(or.id)).toBeUndefined();
  });

  it("recusa chave no lugar da referência, máscara longa, conta de outro provedor e inexistente", () => {
    const { r, or, conta } = comContaOr();
    const CHAVE = "sk-or-v1-0123456789abcdef0123456789abcdef";
    expect(() => r.contaOpenrouter.gravar({ conta_id: or.id, cofre_entrada_id: CHAVE, ultimos4: "cdef" })).toThrow(ValorInvalidoErro);
    expect(() => r.contaOpenrouter.gravar({ conta_id: or.id, cofre_entrada_id: "a".repeat(48), ultimos4: "cdef" })).toThrow(ValorInvalidoErro);
    expect(() => r.contaOpenrouter.gravar({ conta_id: or.id, cofre_entrada_id: "X", ultimos4: "12345" })).toThrow(ValorInvalidoErro);
    expect(() => r.contaOpenrouter.gravar({ conta_id: or.id, cofre_entrada_id: "X", ultimos4: "" })).toThrow(ValorInvalidoErro);
    expect(() => r.contaOpenrouter.gravar({ conta_id: conta.id, cofre_entrada_id: "X", ultimos4: "1234" })).toThrow(ValorInvalidoErro);
    expect(() => r.contaOpenrouter.gravar({ conta_id: "conta_x", cofre_entrada_id: "X", ultimos4: "1234" })).toThrow(NaoEncontradoErro);
    expect(() => r.contaOpenrouter.atualizarSaldo(or.id, { saldo_em: "2026-01-01T00:00:00.000Z" })).toThrow(NaoEncontradoErro);
  });

  it("a chave não aparece em nenhuma tabela do banco (varredura do arquivo inteiro)", () => {
    const { r, or, b } = comContaOr();
    r.contaOpenrouter.gravar({ conta_id: or.id, cofre_entrada_id: "OPENROUTER_KEY_x", ultimos4: "ab12" });
    const CHAVE = "sk-or-v1-SENTINELA0123456789abcdef";
    for (const t of b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")) {
      const linhas = b.consultar(`SELECT * FROM ${t.name}`);
      expect(JSON.stringify(linhas), t.name).not.toContain(CHAVE);
    }
  });
});
