import { describe, expect, it } from "vitest";
import { agregarSelos, alternarFixada, alternarGrupo, CHAVE_MENU, formatarSelo, gravarPrefs, lerPrefs, MAX_FIXADAS, PREFS_PADRAO, sanearPrefs } from "./menu-grupos";
import { GRUPOS, TELAS, telasDoGrupo, grupoDaTela } from "../casca/telas";

const armazem = (inicial?: string) => {
  const m = new Map<string, string>(inicial === undefined ? [] : [[CHAVE_MENU, inicial]]);
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("taxonomia da navegação agrupada", () => {
  it("tem no máximo 7 grupos e cada tela pertence a exatamente um grupo existente", () => {
    expect(GRUPOS.length).toBeLessThanOrEqual(7);
    const ids = new Set(GRUPOS.map((g) => g.id));
    expect(ids.size).toBe(GRUPOS.length);
    for (const t of TELAS) {
      expect(ids.has(t.grupo), `grupo de ${t.id}`).toBe(true);
      expect(GRUPOS.filter((g) => telasDoGrupo(g.id).some((x) => x.id === t.id))).toHaveLength(1);
      expect(grupoDaTela(t.id)).toBe(t.grupo);
    }
    expect(GRUPOS.flatMap((g) => telasDoGrupo(g.id))).toHaveLength(TELAS.length);
    for (const g of GRUPOS) expect(telasDoGrupo(g.id).length, `grupo vazio: ${g.id}`).toBeGreaterThan(0);
  });
  it("ids de tela únicos", () => {
    expect(new Set(TELAS.map((t) => t.id)).size).toBe(TELAS.length);
  });
});

describe("preferências do menu", () => {
  it("padrão: só Trabalho aberto, nada fixado", () => {
    expect(lerPrefs(armazem())).toEqual(PREFS_PADRAO);
    expect(lerPrefs(null)).toEqual(PREFS_PADRAO);
  });
  it("acordeão: sanear mantém só um grupo aberto (o último)", () => {
    expect(sanearPrefs({ abertos: ["codigo", "sistema"] }).abertos).toEqual(["sistema"]);
  });

  it("persiste e relê grupos abertos, fixados e modo só-ícones", () => {
    const a = armazem();
    gravarPrefs({ abertos: ["sistema"], fixados: ["terminais", "inicio"], compacto: true }, a);
    expect(lerPrefs(a)).toEqual({ abertos: ["sistema"], fixados: ["terminais", "inicio"], compacto: true });
  });
  it("sanea storage corrompido, ids desconhecidos, duplicados e excesso de fixados", () => {
    expect(lerPrefs(armazem("{nao json"))).toEqual(PREFS_PADRAO);
    const p = sanearPrefs({ abertos: ["gestao", "gestao", "xx", 3], fixados: ["inicio", "inicio", "nada", "missoes", "terminais", "config"], compacto: "sim" });
    expect(p).toEqual({ abertos: ["gestao"], fixados: ["inicio", "missoes", "terminais"], compacto: false });
  });
  it("gravar sem storage não lança", () => {
    expect(() => gravarPrefs(PREFS_PADRAO, { getItem: () => null, setItem: () => { throw new Error("cheio"); } })).not.toThrow();
  });
  it("alternar grupo é idempotente quando o estado desejado já vale", () => {
    const p = PREFS_PADRAO;
    expect(alternarGrupo(p, "trabalho", true)).toBe(p);
    expect(alternarGrupo(p, "codigo").abertos).toEqual(["codigo"]); // acordeão: abrir um fecha o outro
    expect(alternarGrupo(p, "trabalho").abertos).toEqual([]);
  });
  it("fixa até 3; a quarta tira a mais antiga; desafixar remove", () => {
    let p = PREFS_PADRAO;
    for (const t of ["inicio", "missoes", "terminais", "config"] as const) p = alternarFixada(p, t);
    expect(p.fixados).toEqual(["missoes", "terminais", "config"]);
    expect(p.fixados).toHaveLength(MAX_FIXADAS);
    expect(alternarFixada(p, "missoes").fixados).toEqual(["terminais", "config"]);
  });
});

describe("selos agregados", () => {
  it("soma as telas do grupo e propaga crítico; ignora zero", () => {
    expect(agregarSelos({ alertas: { valor: 3, critico: true }, agil: { valor: 2 } }, ["agil", "relatorios", "alertas"])).toEqual({ valor: 5, critico: true });
    expect(agregarSelos({ alertas: { valor: 0 } }, ["alertas"])).toBeNull();
    expect(agregarSelos({}, ["alertas"])).toBeNull();
    expect(formatarSelo(120)).toBe("99+");
  });
});
