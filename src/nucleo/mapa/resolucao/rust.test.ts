import { describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import { lerManifesto } from "../manifestos";
import type { ImportBruto } from "../tipos";
import type { ArquivoParaResolver } from "./comum";
import { caminhoDeModulo, resolvedorRust } from "./rust";

// T-17.18 (Rust): `mod x;`, crate/self/super, nomes que são submódulos, workspace, externo cargo, stdlib.

const imp = (especificador: string, nomes: string[] = [], tipo: ImportBruto["tipo"] = "estatico"): ImportBruto => ({ especificador, tipo, linha: 1, so_tipo: false, nomes: nomes.map((n) => ({ nome: n, alias: null })) });

function proj(arquivos: Record<string, ImportBruto[]>, manifestos: Parameters<typeof resolvedorRust.resolver>[0]["manifestos"] = []) {
  const mapa = new Map<string, ArquivoParaResolver>();
  for (const [c, imports] of Object.entries(arquivos)) mapa.set(c, { caminho: c, linguagem: "rust", extracao: { imports, simbolos: [] } });
  return resolvedorRust.resolver({ arquivos: mapa, manifestos });
}
const alvo = (arq: string, i: ImportBruto, extra: Record<string, ImportBruto[]> = {}) => {
  const r = proj({ "src/lib.rs": [], "src/a.rs": [], "src/a/b.rs": [], "src/c/mod.rs": [], "src/c/d.rs": [], ...extra, [arq]: [i] });
  return { r, l: r.ligacoes.find((x) => x.arquivo === arq) };
};

describe("resolvedor Rust: tabela", () => {
  it("caminhoDeModulo", () => {
    expect(caminhoDeModulo("src/lib.rs", "src")).toEqual([]);
    expect(caminhoDeModulo("src/a/b.rs", "src")).toEqual(["a", "b"]);
    expect(caminhoDeModulo("src/c/mod.rs", "src")).toEqual(["c"]);
    expect(caminhoDeModulo("outro/x.rs", "src")).toBeNull();
  });
  const L = "src/lib.rs";
  const tabela: Array<[string, string, ImportBruto, string | null]> = [
    ["mod x; na raiz -> x.rs", L, imp("mod:a"), "arq:src/a.rs"],
    ["mod x; -> x/mod.rs", L, imp("mod:c"), "arq:src/c/mod.rs"],
    ["mod x; dentro de módulo de arquivo (a.rs -> a/b.rs)", "src/a.rs", imp("mod:b"), "arq:src/a/b.rs"],
    ["mod x; dentro de mod.rs", "src/c/mod.rs", imp("mod:d"), "arq:src/c/d.rs"],
    ["mod inexistente é listado", L, imp("mod:zzz"), null],
    ["use crate::a", "src/c/d.rs", imp("crate::a", ["Item"]), "arq:src/a.rs"],
    ["use crate::a::b", "src/c/d.rs", imp("crate::a::b", ["Coisa"]), "arq:src/a/b.rs"],
    ["use crate::c::d como item de módulo", "src/a.rs", imp("crate::c", ["d"]), "arq:src/c/mod.rs"],
    ["use self::b", "src/a.rs", imp("self::b", ["X"]), "arq:src/a/b.rs"],
    ["use super::x de a::b (pai = a)", "src/a/b.rs", imp("super", ["x"]), "arq:src/a.rs"],
    ["use super::x de a (pai = raiz)", "src/a.rs", imp("super", ["x"]), "arq:src/lib.rs"],
    ["use super::super (acima da raiz) é recusado", "src/a.rs", imp("super::super::x"), null],
    ["use crate::inexistente é listado", "src/a.rs", imp("crate::nao::existe", ["X"]), "arq:src/lib.rs"],
    ["std", L, imp("std::collections", ["HashMap"]), "ext:stdlib:std"],
    ["core", L, imp("core::fmt"), "ext:stdlib:core"],
    ["dependência", L, imp("serde_json", ["Value"]), "ext:cargo:serde-json"],
    ["pub use vira reexporta", L, imp("crate::a", ["X"], "reexport"), "arq:src/a.rs"],
  ];
  for (const [nome, arq, i, esperado] of tabela)
    it(nome, () => {
      const { r, l } = alvo(arq, i);
      if (esperado === null) {
        expect(l?.para).toBeNull();
        expect(r.nao_resolvidos.length).toBeGreaterThan(0);
      } else expect(l?.para).toBe(esperado);
    });
  it("`use crate::nao::existe` cai no módulo mais profundo conhecido (raiz) sem inventar arquivo", () => {
    const { l } = alvo("src/a.rs", imp("crate::nao::existe", ["X"]));
    expect(l?.para).toBe("arq:src/lib.rs");
  });
  it("nome importado que é submódulo gera aresta extra", () => {
    const { r } = alvo("src/lib.rs", imp("crate::a", ["b"]));
    expect(r.arestas.map((a) => a.para).sort()).toEqual(["arq:src/a.rs", "arq:src/a/b.rs"]);
  });
  it("pub use gera `reexporta`", () => {
    const { r } = alvo("src/lib.rs", imp("crate::a", ["X"], "reexport"));
    expect(r.arestas[0]?.tipo).toBe("reexporta");
  });
  it("workspace: outro crate pelo nome do Cargo.toml", () => {
    const man = [lerManifesto("crates/a/Cargo.toml", '[package]\nname = "crate-a"\n')!, lerManifesto("crates/b/Cargo.toml", '[package]\nname = "crate-b"\n')!];
    const r = proj({ "crates/a/src/lib.rs": [], "crates/a/src/util.rs": [], "crates/b/src/lib.rs": [imp("crate_a::util", ["f"])] }, man);
    expect(r.ligacoes[0]?.para).toBe("arq:crates/a/src/util.rs");
  });
  it("atalho: `use modulo_irmao::x` quando o primeiro segmento é módulo filho", () => {
    const { l } = alvo("src/lib.rs", imp("a", ["X"]));
    expect(l?.para).toBe("arq:src/a.rs");
  });
});

describe("resolvedor Rust: fixture real", () => {
  it("main.rs: mod modelo; crate::modelo e crate::util inexistente", async () => {
    const { ctx } = await montarContexto("rust");
    const r = resolvedorRust.resolver(ctx);
    const l = (e: string) => r.ligacoes.find((x) => x.arquivo === "src/main.rs" && x.especificador === e);
    expect(l("mod:modelo")?.para).toBe("arq:src/modelo.rs");
    expect(l("crate::modelo")?.para).toBe("arq:src/modelo.rs");
    expect(r.ligacoes.filter((x) => x.arquivo === "src/main.rs" && x.especificador.startsWith("std")).every((x) => x.para === "ext:stdlib:std")).toBe(true);
    expect(l("axum")?.para).toBe("ext:cargo:axum");
    expect(r.ligacoes.find((x) => x.arquivo === "src/modelo.rs" && x.especificador === "sqlx")?.para).toBe("ext:cargo:sqlx");
  });
});
