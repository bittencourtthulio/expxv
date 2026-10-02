import { describe, expect, it } from "vitest";
import { configPadrao } from "./config/padroes";
import { lerConfig, mesclarConfig, validarConfig } from "./config/validar";
import { ErroAgil, apenasHumano } from "./erros";
import { criarGeradorId, diaUtilAnterior, ehDiaUtil, hash, instante, intervaloDias, jaccard, mediana, percentilOrdenado, prng, redigirSegredos, somarDias } from "./util";
import { dispersao } from "./metricas/percentis";
import { indexarMembros } from "./sprint/membros";
import type { MembroAgil } from "../../compartilhado/agil";

describe("config (T-18.04)", () => {
  it("o padrão é válido e traz o que o plano manda", () => {
    const c = configPadrao();
    expect(validarConfig(c)).toEqual({ ok: true, erros: [] });
    expect(c.escala_id).toBe("fibonacci");
    expect(c.escalas.find((e) => e.id === "fibonacci")?.valores.map((v) => v.valor)).toEqual([1, 2, 3, 5, 8, 13, 21]);
    expect(c.categorias).toEqual(["feature", "bug", "refator", "infra", "doc", "spike", "teste", "divida"]);
    expect(c.janela_retrabalho_dias).toBe(14);
    expect(c.estimativa_modo).toBe("ia_sugere");
    expect(c.estimativa_max_chamadas_dia).toBe(40);
    expect(c.risco_faixas).toEqual({ medio: 3, alto: 6, critico: 9 });
  });
  it("config inválida é recusada com a LISTA de erros (tabela)", () => {
    const casos: [string, (c: ReturnType<typeof configPadrao>) => void, RegExp][] = [
      ["escala inexistente", (c) => { c.escala_id = "x"; }, /escala_id/],
      ["faixas fora de ordem", (c) => { c.risco_faixas = { medio: 5, alto: 3, critico: 9 }; }, /risco_faixas/],
      ["janela zero", (c) => { c.janela_retrabalho_dias = 0; }, /janela_retrabalho_dias/],
      ["modo inválido", (c) => { (c as unknown as { estimativa_modo: string }).estimativa_modo = "x"; }, /estimativa_modo/],
      ["feriado malformado", (c) => { c.feriados = ["25/12"]; }, /feriados/],
      ["escala não crescente", (c) => { c.escalas = [{ id: "fibonacci", nome: "x", valores: [{ rotulo: "a", valor: 3 }, { rotulo: "b", valor: 2 }] }]; }, /crescentes/],
      ["lote acima de 20", (c) => { c.estimativa_lote = 21; }, /estimativa_lote/],
    ];
    for (const [nome, mut, re] of casos) {
      const c = configPadrao();
      mut(c);
      const r = validarConfig(c);
      expect(r.ok, nome).toBe(false);
      expect(r.erros.join("|"), nome).toMatch(re);
    }
    const dois = configPadrao();
    dois.janela_retrabalho_dias = 0; dois.escala_id = "x";
    expect(validarConfig(dois).erros.length).toBeGreaterThanOrEqual(2);
  });
  it("mesclar não perde chave do usuário e é idempotente (propriedade)", () => {
    const usuario = { janela_retrabalho_dias: 7, risco_pesos: { raio_alto: 5, meu_fator: 1 }, wip: { em_andamento: 4 } };
    const a = mesclarConfig(usuario);
    expect(a.janela_retrabalho_dias).toBe(7);
    expect(a.risco_pesos["raio_alto"]).toBe(5);
    expect(a.risco_pesos["meu_fator"]).toBe(1);
    expect(a.risco_pesos["sem_cobertura"]).toBe(2);
    expect(mesclarConfig(a)).toEqual(a);
    for (let i = 0; i < 20; i++) {
      const r = prng(i + 1);
      const parcial = { janela_retrabalho_dias: 1 + Math.floor(r() * 30), buffer_planejamento: Math.round(r() * 50) / 100, wip: { x: 1 + Math.floor(r() * 5) } };
      const m = mesclarConfig(parcial);
      expect(mesclarConfig(m)).toEqual(m);
      expect(mesclarConfig(parcial)).toEqual(m);
    }
  });
  it("escala customizada válida passa; lerConfig devolve erros em vez de lançar", () => {
    const ok = lerConfig({ escala_id: "tam", escalas: [{ id: "tam", nome: "Tam", valores: [{ rotulo: "S", valor: 1 }, { rotulo: "L", valor: 4 }] }] });
    expect(ok.ok).toBe(true);
    const ruim = lerConfig({ janela_retrabalho_dias: -1 });
    expect(ruim.ok).toBe(false);
  });
});

describe("util e estatística", () => {
  it("percentil por interpolação linear (tabela à mão)", () => {
    const o = [10, 20, 30, 40, 50];
    expect(percentilOrdenado(o, 0)).toBe(10);
    expect(percentilOrdenado(o, 50)).toBe(30);
    expect(percentilOrdenado(o, 85)).toBeCloseTo(44, 10); // pos 3,4 => 40 + 0,4×10
    expect(percentilOrdenado(o, 95)).toBeCloseTo(48, 10);
    expect(percentilOrdenado(o, 100)).toBe(50);
    expect(percentilOrdenado([7], 85)).toBe(7);
    expect(percentilOrdenado([], 50)).toBeNull();
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
  });
  it("amostra < 5 => poucos_dados (nunca percentil inventado)", () => {
    const d = dispersao([1, 2, 3, 4].map((ms, i) => ({ ref: `r${i}`, ms })));
    expect(d).toMatchObject({ estado: "poucos_dados", n: 4, p50: null, p85: null, p95: null });
    expect(dispersao([1, 2, 3, 4, 5].map((ms, i) => ({ ref: `r${i}`, ms }))).p50).toBe(3);
  });
  it("datas: dia útil, feriado, dia útil anterior, instante sem hora vira fim do dia", () => {
    const c = configPadrao();
    expect(ehDiaUtil("2026-03-09", c)).toBe(true); // segunda
    expect(ehDiaUtil("2026-03-14", c)).toBe(false); // sábado
    expect(ehDiaUtil("2026-03-10", { ...c, feriados: ["2026-03-10"] })).toBe(false);
    expect(diaUtilAnterior("2026-03-09", c)).toBe("2026-03-06"); // segunda -> sexta
    expect(somarDias("2026-02-28", 1)).toBe("2026-03-01");
    expect(intervaloDias("2026-03-01", "2026-03-03")).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(instante("2026-03-10")).toEqual({ iso: "2026-03-10T23:59:59.999Z", preciso: false });
    expect(instante("2026-03-10T08:00:00Z")?.preciso).toBe(true);
    expect(instante("lixo")).toBeNull();
    expect(instante(null)).toBeNull();
  });
  it("hash e PRNG são determinísticos; ids são únicos e ordenáveis", () => {
    expect(hash("a")).toBe(hash("a"));
    expect(hash("a")).not.toBe(hash("b"));
    const a = prng(7); const b = prng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    let t = 1000;
    const id = criarGeradorId(() => t);
    const x = id("it"); t = 2000; const y = id("it"); const z = id("it");
    expect(new Set([x, y, z]).size).toBe(3);
    expect([x, y, z].sort()).toEqual([x, y, z]);
  });
  it("jaccard e redação de segredos", () => {
    expect(jaccard("cadastro de clientes", "cadastro de clientes")).toBe(1);
    expect(jaccard("login de usuario", "relatorio fiscal mensal")).toBe(0);
    const t = redigirSegredos("use token=abc123secret e ghp_abcdefghijklmnop1234 e Bearer abcdefghijklmnopqrstu");
    expect(t).not.toMatch(/abc123secret|ghp_abcdefghijklmnop1234|abcdefghijklmnopqrstu/);
  });
  it("erro nominal: human_only", () => {
    const e = apenasHumano("x");
    expect(e).toBeInstanceOf(ErroAgil);
    expect(e.subcode).toBe("human_only");
    expect(e.code).toBe("rule_violation");
  });
});

describe("membros e aliases (T-18.05)", () => {
  const m = (id: string, aliases: MembroAgil["aliases"], ativo = true): MembroAgil => ({ id, workspace_id: "ws1", tipo: "humano", rotulo: id, squad_id: null, horas_dia: 6, fator_foco: 0.6, pontos_sprint_fixo: null, ativo, aliases });
  const idx = indexarMembros([m("ana", [{ tipo: "agente", valor: "qa" }, { tipo: "email", valor: "Ana@x.com" }]), m("bia", [{ tipo: "agente", valor: "dev" }]), m("cris", [{ tipo: "agente", valor: "qa" }], false), m("duda", [{ tipo: "agente", valor: "revisor" }]), m("edu", [{ tipo: "agente", valor: "revisor" }])]);
  it("tabela de resolução", () => {
    expect(idx.resolver({ agente: "qa" })).toMatchObject({ membro_id: "ana", ambiguo: false }); // cris inativo não conta
    expect(idx.resolver({ email: "ana@x.com" })).toMatchObject({ membro_id: "ana" }); // caixa
    expect(idx.resolver({ agente: "dev", email: "ana@x.com" })).toMatchObject({ membro_id: null, ambiguo: true }); // dois membros
    expect(idx.resolver({ agente: "revisor" })).toMatchObject({ membro_id: null, ambiguo: true });
    expect(idx.resolver({ agente: "desconhecido" })).toEqual({ membro_id: null, ambiguo: false, aviso: null });
    expect(idx.resolver({})).toMatchObject({ membro_id: null });
    expect(idx.resolver({ agente: "revisor" }).aviso).toMatch(/sem dono/);
  });
});
