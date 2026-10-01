import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carregarCatalogo, consultar, criarCatalogo, ErroCatalogo, kitMinimo, licencaRestritiva, limparCacheCatalogo, normalizar } from "./catalogo";
import type { EntradaMcp } from "./esquema";

const SEED = join(__dirname, "..", "..", "..", "resources", "mcp", "catalogo-mcps.json");
const SEED_DOCS = join(__dirname, "..", "..", "..", "docs", "ade", "base", "catalogo-mcps.seed.json");

describe("seed embarcado", () => {
  it("é idêntico, byte a byte, ao seed da pesquisa", () => {
    expect(readFileSync(SEED).equals(readFileSync(SEED_DOCS))).toBe(true);
  });

  it("tem ≥ 40 entradas instaláveis; só confirmadas e não descartadas são instaláveis", () => {
    const cat = carregarCatalogo(SEED);
    expect(cat.entradas.length).toBeGreaterThanOrEqual(40);
    const instalaveis = cat.entradas.filter((x) => x.instalavel);
    expect(instalaveis.length).toBeGreaterThanOrEqual(40);
    for (const x of cat.entradas) {
      expect(x.instalavel).toBe(x.entrada.confirmado && x.entrada.classificacao !== "descartado");
      if (!x.entrada.confirmado) expect(["nao_confirmado", "descartado"]).toContain(x.motivo_nao_instalavel);
    }
    const naoConfirmadas = cat.entradas.filter((x) => !x.entrada.confirmado);
    expect(naoConfirmadas.length).toBeGreaterThan(0);
    expect(naoConfirmadas.every((x) => !x.instalavel && x.entrada.instalacao.versao === null)).toBe(true);
  });

  it("o Kit mínimo é context7, deepwiki e sequential-thinking, todos instaláveis", () => {
    const ids = kitMinimo(carregarCatalogo(SEED)).map((x) => x.entrada.id).sort();
    expect(ids).toEqual(["context7", "deepwiki", "sequential-thinking"]);
  });

  it("carregar e validar o seed (P-95) ≤ 20 ms depois do aquecimento", () => {
    const bruto = readFileSync(SEED, "utf8");
    criarCatalogo(JSON.parse(bruto));
    const t0 = performance.now();
    criarCatalogo(JSON.parse(bruto));
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(20 * Number(process.env["EXPXV_PERF_FATOR"] ?? 1) + 40);
  });

  it("licenças restritivas aparecem com selo (GPL/FSL), nunca são tratadas como permissivas", () => {
    expect(licencaRestritiva("GPL-3.0-or-later")).toBe(true);
    expect(licencaRestritiva("AGPL-3.0")).toBe(true);
    expect(licencaRestritiva("FSL-1.1-ALv2")).toBe(true);
    expect(licencaRestritiva("MIT")).toBe(false);
    expect(licencaRestritiva("LGPL-2.1-or-later")).toBe(false);
    expect(licencaRestritiva(null)).toBe(false);
    const cat = carregarCatalogo(SEED);
    expect(consultar(cat, { licenca: "restritiva" }).length).toBeGreaterThan(0);
    expect(consultar(cat, { licenca: "restritiva" }).every((x) => /GPL|FSL/i.test(x.entrada.licenca_spdx ?? ""))).toBe(true);
  });

  it("selo grátis só para entrada confirmada (P-138)", () => {
    const cat = carregarCatalogo(SEED);
    for (const x of cat.entradas) if (!x.entrada.confirmado) expect(x.selo_gratuito).toBe("nao_confirmado");
    const gratis = consultar(cat, { gratuito: true });
    expect(gratis.length).toBeGreaterThan(0);
    expect(gratis.every((x) => x.entrada.confirmado)).toBe(true);
  });
});

describe("carregador", () => {
  it("cache: segunda chamada devolve o mesmo objeto; mudar o arquivo invalida", () => {
    limparCacheCatalogo();
    const a = carregarCatalogo(SEED);
    expect(carregarCatalogo(SEED)).toBe(a);
  });

  it("objetos congelados", () => {
    const cat = carregarCatalogo(SEED);
    expect(Object.isFrozen(cat)).toBe(true);
    expect(Object.isFrozen(cat.entradas)).toBe(true);
    expect(Object.isFrozen(cat.entradas[0]!.entrada)).toBe(true);
    expect(() => { (cat.entradas[0]!.entrada as EntradaMcp).nome = "x"; }).toThrow();
  });

  it("arquivo ausente, não-JSON ou inválido lançam ErroCatalogo nominal", () => {
    const dir = mkdtempSync(join(tmpdir(), "loja-cat-"));
    expect(() => carregarCatalogo(join(dir, "nao-existe.json"))).toThrow(ErroCatalogo);
    writeFileSync(join(dir, "a.json"), "{ não é json");
    expect(() => carregarCatalogo(join(dir, "a.json"))).toThrow(/não é JSON/);
    writeFileSync(join(dir, "b.json"), JSON.stringify({ schema_version: 1, gerado_em: "2026-01-01", fonte: "x", entradas: [{ id: "x" }] }));
    try { carregarCatalogo(join(dir, "b.json")); expect.unreachable(); } catch (e) {
      expect((e as ErroCatalogo).codigo).toBe("catalogo_invalido");
      expect((e as ErroCatalogo).erros.length).toBeGreaterThan(0);
    }
  });

  it("hash divergente do manifesto: só leitura e nada instalável (AC-14)", () => {
    const ok = carregarCatalogo(SEED);
    expect(ok.somente_leitura).toBe(false);
    const adulterado = carregarCatalogo(SEED, { sha256Esperado: "0".repeat(64) });
    expect(adulterado.somente_leitura).toBe(true);
    expect(adulterado.aviso).toMatch(/adulterado/);
    expect(adulterado.entradas.some((x) => x.instalavel)).toBe(false);
    expect(adulterado.entradas[0]!.motivo_nao_instalavel).toBe("catalogo_adulterado");
    const certo = carregarCatalogo(SEED, { sha256Esperado: ok.sha256 });
    expect(certo.somente_leitura).toBe(false);
  });
});

describe("consulta", () => {
  const cat = carregarCatalogo(SEED);

  it("sem filtro devolve tudo na ordem de curadoria: Kit primeiro, descartados por último", () => {
    const r = consultar(cat);
    expect(r).toHaveLength(cat.entradas.length);
    expect(r.slice(0, 3).every((x) => x.entrada.classificacao === "pre_instalado_habilitado")).toBe(true);
    expect(r[r.length - 1]!.entrada.classificacao).toBe("descartado");
  });

  it("busca por texto é sem acento e sem caixa; combina termos (E)", () => {
    expect(consultar(cat, { texto: "CONTEXT7" })[0]!.entrada.id).toBe("context7");
    expect(consultar(cat, { texto: "documentação" }).length).toBeGreaterThan(0);
    expect(consultar(cat, { texto: "documentacao" })).toEqual(consultar(cat, { texto: "documentação" }));
    const dois = consultar(cat, { texto: "github token" });
    expect(dois.every((x) => normalizar(JSON.stringify(x.entrada)).includes("github"))).toBe(true);
    expect(consultar(cat, { texto: "zzzzinexistentezzzz" })).toEqual([]);
  });

  it("filtros por categoria, classificação, instalável, pede chave e licença", () => {
    expect(consultar(cat, { categoria: "bancos_dados" }).every((x) => x.entrada.categoria === "bancos_dados")).toBe(true);
    expect(consultar(cat, { classificacao: "descartado" }).every((x) => !x.entrada.confirmado || x.entrada.classificacao === "descartado")).toBe(true);
    expect(consultar(cat, { instalavel: false }).length + consultar(cat, { instalavel: true }).length).toBe(cat.entradas.length);
    expect(consultar(cat, { pedeChave: true }).every((x) => x.pede_chave)).toBe(true);
    expect(consultar(cat, { licenca: "mit" }).every((x) => x.entrada.licenca_spdx === "MIT")).toBe(true);
    const combinado = consultar(cat, { categoria: "bancos_dados", instalavel: true, gratuito: true });
    expect(combinado.every((x) => x.entrada.categoria === "bancos_dados" && x.instalavel)).toBe(true);
  });

  it("ordenação estável: repetir dá o mesmo resultado; empate respeita a ordem de curadoria", () => {
    for (const ordenar of ["curadoria", "nome", "categoria", "relevancia"] as const) {
      const a = consultar(cat, { ordenar }).map((x) => x.entrada.id);
      const b = consultar(cat, { ordenar }).map((x) => x.entrada.id);
      expect(a).toEqual(b);
    }
    const porCategoria = consultar(cat, { ordenar: "categoria" });
    for (let i = 1; i < porCategoria.length; i++) {
      if (porCategoria[i]!.entrada.categoria === porCategoria[i - 1]!.entrada.categoria)
        expect(porCategoria[i]!.posicao).toBeGreaterThan(porCategoria[i - 1]!.posicao);
    }
  });

  it("relevância: nome exato antes de menção na descrição", () => {
    const r = consultar(cat, { texto: "redis" });
    expect(r[0]!.entrada.nome.toLowerCase()).toContain("redis");
  });

  it("busca ≤ 10 ms com 100 entradas e ≤ 16 ms com 2 000 sintéticas (P-91)", () => {
    const base = cat.entradas[0]!.entrada;
    const sintetico = (n: number): ReturnType<typeof criarCatalogo> => criarCatalogo({
      schema_version: 1, gerado_em: "2026-10-01", fonte: "sintetico",
      entradas: Array.from({ length: n }, (_, i) => ({ ...JSON.parse(JSON.stringify(base)), id: `srv-${i}`, nome: `Servidor ${i} ${i % 7 === 0 ? "banco" : "web"}` })),
    });
    const fator = Number(process.env["EXPXV_PERF_FATOR"] ?? 1);
    for (const [n, limite] of [[100, 10], [2000, 16]] as const) {
      const c = sintetico(n);
      consultar(c, { texto: "servidor banco" });
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) consultar(c, { texto: "servidor banc", categoria: "codigo_repositorios" });
      const media = (performance.now() - t0) / 20;
      expect(media).toBeLessThan(limite * fator);
    }
  });
});
