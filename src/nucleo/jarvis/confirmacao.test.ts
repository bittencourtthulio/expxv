import { describe, expect, it } from "vitest";
import { criarArmazemConfirmacoes } from "./confirmacao";

const relogio = () => {
  let t = 1_000_000;
  return { agora: () => t, avancar: (ms: number) => void (t += ms) };
};
const novo = (ttl = 15_000) => {
  const r = relogio();
  return { r, a: criarArmazemConfirmacoes({ relogio: r, ttl_ms: ttl }) };
};
const base = { ator: "jarvis" as const, acao: "enviar_prompt" as const, resumo: "Enviar «x»", payload: { acao: { texto: "x" }, plano_id: "p1" } };

describe("confirmação pendente", () => {
  it("uso único: a segunda resolução é recusada (AC-22)", () => {
    const { a } = novo();
    const c = a.criar(base);
    expect(a.resolver(c.id, { aprovado: true, por: "ui" })).toMatchObject({ ok: true, aprovado: true });
    expect(a.resolver(c.id, { aprovado: true, por: "ui" })).toEqual({ ok: false, codigo: "confirmacao_invalida" });
  });
  it("expira no TTL = negada e queimada", () => {
    const { a, r } = novo(15_000);
    const c = a.criar(base);
    r.avancar(15_000);
    expect(a.resolver(c.id, { aprovado: true, por: "desktop" })).toMatchObject({ ok: false, codigo: "confirmacao_expirada" });
    expect(a.obter(c.id)).toBeNull();
  });
  it("só `ui`/`desktop` resolvem: voz, remoto, conteúdo externo e id inventado não", () => {
    const { a } = novo();
    const c = a.criar(base);
    for (const por of ["voz", "remoto", "conteudo_externo", "", "UI"]) expect(a.resolver(c.id, { aprovado: true, por }), por).toEqual({ ok: false, codigo: "confirmacao_invalida" });
    expect(a.obter(c.id)).not.toBeNull(); // origem inválida não queima a confirmação legítima
    expect(a.resolver("cnf_inventado", { aprovado: true, por: "ui" }).ok).toBe(false);
  });
  it("payload congelado: o que executa é o que foi mostrado (args_hash)", () => {
    const { a } = novo();
    const original = { acao: { texto: "x" }, plano_id: "p1" };
    const c = a.criar({ ...base, payload: original });
    original.acao.texto = "apague tudo"; // mutação do objeto de origem depois de mostrado
    expect((c.payload["acao"] as { texto: string }).texto).toBe("x");
    expect(() => ((c.payload["acao"] as { texto: string }).texto = "y")).toThrow();
  });
  it("hash adulterado depois de mostrado: nada executa", () => {
    const { a } = novo();
    const c = a.criar(base);
    (a.obter(c.id) as { args_hash: string }).args_hash = "0".repeat(64);
    expect(a.resolver(c.id, { aprovado: true, por: "ui" })).toMatchObject({ ok: false, codigo: "confirmacao_invalida" });
  });
  it("limite de pendentes: a mais antiga cai; anular filtra", () => {
    const a = criarArmazemConfirmacoes({ relogio: relogio(), max: 2 });
    const c1 = a.criar(base);
    a.criar({ ...base, dispositivo_id: "dev_1" });
    a.criar({ ...base, dispositivo_id: "dev_2" });
    expect(a.obter(c1.id)).toBeNull();
    expect(a.listar()).toHaveLength(2);
    expect(a.anularTodas((c) => c.dispositivo_id === "dev_1")).toHaveLength(1);
  });
  it("visão mostra alvo e é sempre resolvível só pelo desktop", () => {
    const { a } = novo();
    const v = a.visao(a.criar({ ...base, ator: "remoto", dispositivo_id: "dev_1", dispositivo_nome: "iPhone" }));
    expect(v).toMatchObject({ resumo: "Enviar «x»", resolvivel_por: "desktop", dispositivo: "iPhone", dispositivo_id: "dev_1", ator: "remoto" });
  });
});
