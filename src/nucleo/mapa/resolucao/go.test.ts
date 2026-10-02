import { describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import { lerManifesto } from "../manifestos";
import type { ImportBruto, SimboloBruto } from "../tipos";
import type { ArquivoParaResolver } from "./comum";
import { resolvedorGo } from "./go";

// T-17.18 (Go): módulo local + diretório = pacote, refino por símbolo, vendor, replace local, stdlib, externo.

const GOMOD = [
  "module exemplo.com/loja",
  "require (",
  "\tgithub.com/spf13/cobra v1.8.0",
  "\tgithub.com/lib/pq v1.10.0",
  ")",
  "replace exemplo.com/lib => ./third/lib",
  "replace github.com/remoto/x => github.com/fork/x v1.0.0",
].join("\n");
const manifestos = [lerManifesto("go.mod", GOMOD)!];

const imp = (especificador: string, alias?: string, linha = 1): ImportBruto => ({ especificador, tipo: "estatico", linha, so_tipo: false, nomes: alias === undefined ? [] : [{ nome: "*", alias }] });
const sim = (nome: string): SimboloBruto => ({ nome, qualificado: nome, tipo: "funcao", linha: 1, linha_fim: 1, exportado: true, visibilidade: null, complexidade: 1, assinatura: "", doc: null, decoradores: [] });

function proj(arquivos: Record<string, { imports?: ImportBruto[]; simbolos?: string[]; chamadas?: Array<{ alvo: string; receptor: string }> }>, man = manifestos) {
  const mapa = new Map<string, ArquivoParaResolver>();
  for (const [c, v] of Object.entries(arquivos))
    mapa.set(c, { caminho: c, linguagem: "go", extracao: { imports: v.imports ?? [], simbolos: (v.simbolos ?? []).map(sim), chamadas: (v.chamadas ?? []).map((x) => ({ de: null, alvo: x.alvo, receptor: x.receptor, tipo: "chamada" as const, linha: 2 })) } });
  return resolvedorGo.resolver({ arquivos: mapa, manifestos: man });
}

const BASE = {
  "internal/loja/loja.go": { simbolos: ["Criar", "Listar"] },
  "internal/loja/util.go": { simbolos: ["Ajuda"] },
  "internal/loja/loja_test.go": { simbolos: ["TesteX"] },
  "third/lib/lib.go": { simbolos: ["L"] },
  "vendor/github.com/acme/v/v.go": { simbolos: ["V"] },
};
const ORIGEM = "cmd/main.go";
function liga(i: ImportBruto, extra: Parameters<typeof proj>[0] = {}, chamadas: Array<{ alvo: string; receptor: string }> = []) {
  const r = proj({ ...BASE, ...extra, [ORIGEM]: { imports: [i], chamadas } });
  return { r, l: r.ligacoes.find((x) => x.arquivo === ORIGEM) };
}

describe("resolvedor Go: tabela", () => {
  it("stdlib", () => expect(liga(imp("net/http")).l?.para).toBe("ext:stdlib:net/http"));
  it("stdlib de um segmento", () => expect(liga(imp("fmt")).l?.para).toBe("ext:stdlib:fmt"));
  it("externo conhecido do go.mod", () => expect(liga(imp("github.com/spf13/cobra/doc")).l?.para).toBe("ext:go:github.com/spf13/cobra"));
  it("externo desconhecido usa 3 primeiros segmentos", () => expect(liga(imp("github.com/x/y/z/w")).l?.para).toBe("ext:go:github.com/x/y"));
  it("domínio curto fica inteiro", () => expect(liga(imp("gopkg.in/yaml.v3")).l?.para).toBe("ext:go:gopkg.in/yaml.v3"));
  it("pacote local liga a todos os arquivos não-teste (sem refino)", () => {
    const { l } = liga(imp("exemplo.com/loja/internal/loja"));
    expect(l?.alvos).toEqual(["arq:internal/loja/loja.go", "arq:internal/loja/util.go"]);
    expect(l?.confianca).toBe("exata");
  });
  it("arquivo de teste nunca é alvo", () => expect(liga(imp("exemplo.com/loja/internal/loja")).l?.alvos).not.toContain("arq:internal/loja/loja_test.go"));
  it("refino por símbolo usado (`loja.Criar`)", () => {
    const { l, r } = liga(imp("exemplo.com/loja/internal/loja"), {}, [{ alvo: "Criar", receptor: "loja" }]);
    expect(l?.alvos).toEqual(["arq:internal/loja/loja.go"]);
    expect(r.arestas).toHaveLength(1);
  });
  it("refino respeita alias", () => {
    const { l } = liga(imp("exemplo.com/loja/internal/loja", "lj"), {}, [{ alvo: "Ajuda", receptor: "lj" }]);
    expect(l?.alvos).toEqual(["arq:internal/loja/util.go"]);
  });
  it("import em branco `_` liga ao pacote inteiro", () => {
    const { l } = liga(imp("exemplo.com/loja/internal/loja", "_"), {}, [{ alvo: "Criar", receptor: "_" }]);
    expect(l?.alvos).toHaveLength(2);
  });
  it("import ponto liga ao pacote inteiro", () => expect(liga(imp("exemplo.com/loja/internal/loja", ".")).l?.alvos).toHaveLength(2));
  it("replace local respeitado", () => expect(liga(imp("exemplo.com/lib")).l?.para).toBe("arq:third/lib/lib.go"));
  it("replace remoto ignorado (vira externo)", () => expect(liga(imp("github.com/remoto/x")).l?.para).toBe("ext:go:github.com/remoto/x"));
  it("vendor/", () => expect(liga(imp("github.com/acme/v")).l?.para).toBe("arq:vendor/github.com/acme/v/v.go"));
  it("pacote do módulo sem arquivos no projeto é listado", () => {
    const { l, r } = liga(imp("exemplo.com/loja/internal/fantasma"));
    expect(l?.para).toBeNull();
    expect(r.nao_resolvidos).toHaveLength(1);
  });
  it("import do próprio pacote não gera aresta nem lacuna", () => {
    const r = proj({ "internal/loja/a.go": { imports: [imp("exemplo.com/loja/internal/loja")] } });
    expect(r.arestas).toEqual([]);
    expect(r.nao_resolvidos).toEqual([]);
  });
  it("sufixo de versão major no caminho usa o segmento anterior como nome local", () => {
    const { l } = liga(imp("exemplo.com/loja/internal/loja/v2"), { "internal/loja/v2/x.go": { simbolos: ["Z"] } }, [{ alvo: "Z", receptor: "loja" }]);
    expect(l?.alvos).toEqual(["arq:internal/loja/v2/x.go"]);
  });
  it("módulo sem go.mod: tudo com domínio é externo", () => {
    const r = proj({ [ORIGEM]: { imports: [imp("exemplo.com/loja/internal/loja")] } }, []);
    expect(r.ligacoes[0]?.para).toBe("ext:go:exemplo.com/loja/internal");
  });
});

describe("resolvedor Go: fixture real", () => {
  it("cmd/main.go -> internal/loja exata; cobra externo; fmt stdlib", async () => {
    const { ctx } = await montarContexto("go");
    const r = resolvedorGo.resolver({ ...ctx, manifestos: [lerManifesto("go.mod", "module exemplo.com/loja\nrequire github.com/spf13/cobra v1\n")!] });
    const l = (e: string) => r.ligacoes.find((x) => x.arquivo === "cmd/main.go" && x.especificador === e);
    expect(l("exemplo.com/loja/internal/loja")?.para).toBe("arq:internal/loja/loja.go");
    expect(l("github.com/spf13/cobra")?.para).toBe("ext:go:github.com/spf13/cobra");
    expect(l("fmt")?.para).toBe("ext:stdlib:fmt");
    const lojaLib = r.ligacoes.filter((x) => x.arquivo === "internal/loja/loja.go");
    expect(lojaLib.find((x) => x.especificador === "database/sql")?.para).toBe("ext:stdlib:database/sql");
    expect(lojaLib.find((x) => x.especificador === "github.com/lib/pq")?.para).toBe("ext:go:github.com/lib/pq");
  });
});
