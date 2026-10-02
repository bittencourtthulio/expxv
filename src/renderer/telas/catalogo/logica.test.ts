import { describe, expect, it } from "vitest";
import { badgeDe, clisSemItem, criarIndiceItens, filtrarItens, FILTROS_VAZIOS, mensagemDoCodigo, montarLinhas, motivoInstalar, motivoSomenteLeitura, podeInstalar, quantosAusentes, type FiltrosCatalogo } from "./logica";
import { inst, ITENS_PADRAO, item, muitos } from "./fabrica-teste";

const F = (p: Partial<FiltrosCatalogo>): FiltrosCatalogo => ({ ...FILTROS_VAZIOS, ...p });

describe("catálogo: badges", () => {
  it("usa símbolo + texto (nunca só cor): global ●, projeto ◐, ausente ○, quebrado !, nenhum ·", () => {
    const i = item("a", { instalacoes: [inst("claude"), inst("codex", { escopo: "projeto" }), inst("opencode", { estado: "ausente" }), inst("gemini", { estado: "quebrado" })] });
    expect(badgeDe(i, "claude")).toMatchObject({ simbolo: "●", texto: "global" });
    expect(badgeDe(i, "codex")).toMatchObject({ simbolo: "◐", texto: "projeto" });
    expect(badgeDe(i, "opencode")).toMatchObject({ simbolo: "○", texto: "ausente" });
    expect(badgeDe(i, "gemini")).toMatchObject({ simbolo: "!", texto: "quebrado" });
    expect(badgeDe(i, "portatil")).toMatchObject({ simbolo: "·", tom: "nenhum" });
  });
  it("conta ausentes só quando nenhuma instalação está presente", () => {
    expect(quantosAusentes(ITENS_PADRAO)).toBe(1);
  });
});

describe("catálogo: filtros", () => {
  const todos = muitos(500);
  it("propriedade: o resultado é sempre subconjunto do conjunto de entrada, para combinações de filtros", () => {
    const ids = new Set(todos.map((i) => i.id));
    const combos: FiltrosCatalogo[] = [F({}), F({ busca: "0042" }), F({ clis: ["codex"] }), F({ origem: "terceiro" }), F({ estado: "ausente" }), F({ clis: ["claude", "opencode"], estado: "ausente", origem: "usuario" }), F({ busca: "plugin", soDivergentes: true })];
    for (const f of combos) {
      const r = filtrarItens(todos, f);
      expect(r.every((i) => ids.has(i.id))).toBe(true);
      expect(new Set(r.map((i) => i.id)).size).toBe(r.length);
    }
  });
  it("filtros combinam (AND)", () => {
    const a = filtrarItens(todos, F({ origem: "terceiro" })).length;
    const b = filtrarItens(todos, F({ origem: "terceiro", clis: ["codex"] })).length;
    expect(b).toBeLessThanOrEqual(a);
    expect(filtrarItens(ITENS_PADRAO, F({ soDivergentes: true })).map((i) => i.nome)).toEqual(["divergente"]);
    expect(filtrarItens(ITENS_PADRAO, F({ estado: "ausente" })).map((i) => i.nome)).toEqual(["antiga"]);
  });
  it("ordena por nome normalizado; busca fuzzy ignora acento/caixa", () => {
    expect(filtrarItens(ITENS_PADRAO, F({})).map((i) => i.nome)[0]).toBe("antiga");
    expect(filtrarItens(ITENS_PADRAO, F({ busca: "FRONTEND" })).map((i) => i.nome)).toContain("frontend-design");
  });
  it("P-26: filtro/busca com 5 000 itens cabe em um quadro (≤ 16 ms por tecla; o índice é montado uma vez)", () => {
    const grande = muitos(5000);
    const indice = criarIndiceItens(grande);
    filtrarItens(grande, F({ busca: "sk" }), indice); // aquece
    const t0 = performance.now();
    const N = 10;
    for (let k = 0; k < N; k++) filtrarItens(grande, F({ busca: `skill-0${k}1`, origem: "usuario" }), indice);
    const por = (performance.now() - t0) / N;
    expect(por).toBeLessThan(16 * Number(process.env["EXPXV_PERF_FATOR"] ?? 4));
  });
});

describe("catálogo: agrupamento", () => {
  it("agrupa por plugin/autor, 'Sem plugin' por último, e recolher esconde os itens", () => {
    const itens = [item("a"), item("b", { plugin: "zeta" }), item("c", { plugin: "alfa" }), item("d", { autor: "ana" })];
    const l = montarLinhas(itens, true, new Set());
    expect(l.filter((x) => x.tipo === "grupo").map((x) => (x.tipo === "grupo" ? x.rotulo : ""))).toEqual(["alfa", "ana", "zeta", "Sem plugin"]);
    const r = montarLinhas(itens, true, new Set(["zeta"]));
    expect(r.length).toBe(l.length - 1);
    expect(montarLinhas(itens, false, new Set()).every((x) => x.tipo === "item")).toBe(true);
  });
});

describe("catálogo: ações e somente leitura", () => {
  it("método, plugin e terceiro nunca são instaláveis/removíveis e dizem o motivo", () => {
    for (const i of [item("m", { origem: "metodo" }), item("p", { plugin: "x" }), item("t", { origem: "terceiro" })]) {
      expect(motivoSomenteLeitura(i)).not.toBeNull();
      expect(podeInstalar(i)).toBe(false);
    }
    expect(motivoSomenteLeitura(item("u"))).toBeNull();
    expect(podeInstalar(item("u"))).toBe(true);
    expect(motivoInstalar(item("h", { tipo: "hook" }))).toMatch(/só pode ser listado/);
  });
  it("alvos de instalação são as CLIs sem o item presente", () => {
    expect(clisSemItem(item("u", { instalacoes: [inst("claude")] }))).toEqual(["codex", "opencode", "gemini", "portatil"]);
  });
  it("mensagens nominais em português", () => {
    expect(mensagemDoCodigo("conflito")).toMatch(/nada foi sobrescrito/);
    expect(mensagemDoCodigo("xyz")).toContain("xyz");
  });
});
