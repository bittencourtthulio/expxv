import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco/banco";
import { migrar } from "../banco/migrar";
import { CONFIRMACAO_DIRETA, criarArmazemDispositivos } from "./dispositivos";
import { relogioMovel } from "../../../tests/fixtures/jarvis/cenario-remoto";

const abertos: Banco[] = [];
const novo = () => {
  const banco = abrirBanco(":memory:");
  migrar(banco);
  abertos.push(banco);
  const relogio = relogioMovel();
  const revogados: string[] = [];
  const a = criarArmazemDispositivos({ banco, relogio, validade_dias: () => 30, aoRevogar: (id) => revogados.push(id) });
  return { banco, relogio, a, revogados };
};
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const chave = Buffer.from("chave-publica-de-teste");

describe("armazém de dispositivos (T-13.14)", () => {
  it("cria com `leitura`, só com a chave pública; persiste e recarrega", () => {
    const { banco, a, relogio } = novo();
    const x = a.criar({ nome: "iPhone do Thulio", chave_publica: chave, ip: "192.168.1.9" });
    expect(x.permissao).toBe("leitura");
    expect(x.id).toMatch(/^dev_/);
    const linha = banco.consultarUm<Record<string, unknown>>("SELECT * FROM remoto_dispositivo WHERE id = ?", [x.id]);
    expect(Object.keys(linha ?? {}).sort()).toEqual(["chave_publica", "criado_em", "expira_em", "id", "nome", "permissao", "revogado_em", "ultimo_ip", "ultimo_uso_em"]); // nenhum segredo de dispositivo
    const outro = criarArmazemDispositivos({ banco, relogio, validade_dias: () => 30 });
    expect(outro.ativo(x.id)?.chave_publica.equals(chave)).toBe(true);
  });
  it("revogado nunca autentica; revogação avisa quem derruba o canal; segunda revogação é falsa", () => {
    const { a, revogados } = novo();
    const x = a.criar({ nome: "n", chave_publica: chave, ip: null });
    expect(a.ativo(x.id)).not.toBeNull();
    expect(a.revogar(x.id)).toBe(true);
    expect(a.ativo(x.id)).toBeNull();
    expect(a.revogar(x.id)).toBe(false);
    expect(revogados).toEqual([x.id]);
    expect(a.definirPermissao(x.id, "mensagem_direta", CONFIRMACAO_DIRETA)).toBeNull();
  });
  it("expira e a validade desliza com o uso", () => {
    const { a, relogio } = novo();
    const x = a.criar({ nome: "n", chave_publica: chave, ip: null });
    relogio.avancar(29 * 86_400_000);
    a.tocar(x.id, "192.168.1.9");
    relogio.avancar(29 * 86_400_000);
    expect(a.ativo(x.id)).not.toBeNull();
    relogio.avancar(2 * 86_400_000);
    expect(a.ativo(x.id)).toBeNull();
  });
  it("permissão só sobe por ação explícita; `mensagem_direta` exige digitar PERMITIR; baixar é livre", () => {
    const { a } = novo();
    const x = a.criar({ nome: "n", chave_publica: chave, ip: null });
    expect(a.definirPermissao(x.id, "mensagem_confirmada", null)?.permissao).toBe("mensagem_confirmada");
    expect(a.definirPermissao(x.id, "mensagem_direta", null)).toBeNull();
    expect(a.definirPermissao(x.id, "mensagem_direta", "permitir")).toBeNull();
    expect(a.definirPermissao(x.id, "mensagem_direta", "PERMITIR")?.permissao).toBe("mensagem_direta");
    expect(a.definirPermissao(x.id, "leitura", null)?.permissao).toBe("leitura");
    expect(a.definirPermissao(x.id, "root" as never, "PERMITIR")).toBeNull();
  });
  it("consulta quente <= 5 ms (P-14) e revogar todos", () => {
    const { a, revogados } = novo();
    const xs = Array.from({ length: 20 }, (_, i) => a.criar({ nome: `d${i}`, chave_publica: chave, ip: null }));
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) a.ativo((xs[i % 20] as { id: string }).id);
    expect((performance.now() - t0) / 1000).toBeLessThan(5);
    expect(a.revogarTodos()).toBe(20);
    expect(revogados).toHaveLength(20);
    expect(a.listar().every((x) => x.revogado_em !== null)).toBe(true);
  });
});
