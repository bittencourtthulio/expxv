import { describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import type { Manifesto } from "../manifestos";
import type { ImportBruto, SimboloBruto } from "../tipos";
import type { ArquivoParaResolver } from "./comum";
import { pacoteDoCaminho, resolvedorJava } from "./java";

// T-17.17 (Java): tabela de casos + fixture Java real (Maven mínimo).

const imp = (especificador: string, curinga = false): ImportBruto => ({ especificador, tipo: "estatico", linha: 1, so_tipo: false, nomes: curinga ? [{ nome: "*", alias: null }] : [] });
const sim = (nome: string, tipo: SimboloBruto["tipo"] = "classe"): SimboloBruto => ({ nome, qualificado: nome, tipo, linha: 1, linha_fim: 1, exportado: true, visibilidade: "publica", complexidade: 0, assinatura: nome, doc: null, decoradores: [] });

function proj(arquivos: Record<string, { imports?: ImportBruto[]; simbolos?: string[]; herancas?: string[]; chamadas?: Array<{ alvo: string; receptor: string | null }> }>, manifestos: Manifesto[] = []) {
  const mapa = new Map<string, ArquivoParaResolver>();
  for (const [c, v] of Object.entries(arquivos))
    mapa.set(c, {
      caminho: c, linguagem: "java",
      extracao: {
        imports: v.imports ?? [], simbolos: (v.simbolos ?? []).map((n) => sim(n)),
        herancas: (v.herancas ?? []).map((b) => ({ classe: "X", base: b, tipo: "herda" as const, linha: 3 })),
        chamadas: (v.chamadas ?? []).map((x) => ({ de: null, alvo: x.alvo, receptor: x.receptor, tipo: "chamada" as const, linha: 4 })),
      },
    });
  return resolvedorJava.resolver({ arquivos: mapa, manifestos });
}

const M = "src/main/java";
const BASE = {
  [`${M}/br/app/dominio/Pedido.java`]: { simbolos: ["Pedido"] },
  [`${M}/br/app/dominio/Item.java`]: { simbolos: ["Item"] },
  [`${M}/br/app/util/Fmt.java`]: { simbolos: ["Fmt"] },
};

function liga(origem: string, i: ImportBruto) {
  const r = proj({ ...BASE, [`${M}/br/app/web/C.java`]: { imports: [i] } });
  return { r, l: r.ligacoes.find((x) => x.arquivo === `${M}/br/app/web/C.java`) };
}

describe("resolvedor Java: tabela", () => {
  it("pacoteDoCaminho", () => {
    expect(pacoteDoCaminho("src/main/java/br/app/X.java")).toBe("br.app");
    expect(pacoteDoCaminho("mod/src/test/java/br/T.java")).toBe("br");
    expect(pacoteDoCaminho("app/java/a/b/X.java")).toBe("a.b");
    expect(pacoteDoCaminho("src/a/X.java")).toBe("a");
    expect(pacoteDoCaminho("X.java")).toBeNull();
    expect(pacoteDoCaminho("src/main/java/X.java")).toBe("");
  });
  const tabela: Array<[string, ImportBruto, string | null, "exata" | "heuristica"]> = [
    ["FQN de classe", imp("br.app.dominio.Pedido"), `arq:${M}/br/app/dominio/Pedido.java`, "exata"],
    ["classe aninhada", imp("br.app.dominio.Pedido.Status"), `arq:${M}/br/app/dominio/Pedido.java`, "exata"],
    ["static import de método", imp("br.app.util.Fmt"), `arq:${M}/br/app/util/Fmt.java`, "exata"],
    ["static curinga de classe", imp("br.app.util.Fmt", true), `arq:${M}/br/app/util/Fmt.java`, "exata"],
    ["JDK", imp("java.util.List"), "ext:stdlib:java.util", "exata"],
    ["javax", imp("javax.persistence.Entity"), "ext:stdlib:javax.persistence", "exata"],
    ["biblioteca externa", imp("org.springframework.web.Foo"), "ext:maven:org.springframework.web", "exata"],
    ["curinga externo", imp("org.springframework.web.bind", true), "ext:maven:org.springframework.web", "exata"],
    ["curinga JDK", imp("java.util", true), "ext:stdlib:java.util", "exata"],
    ["classe inexistente em pacote do projeto é listada", imp("br.app.dominio.Fantasma"), null, "heuristica"],
  ];
  for (const [nome, i, esperado, conf] of tabela)
    it(nome, () => {
      const { r, l } = liga("", i);
      if (esperado === null) {
        expect(l?.para).toBeNull();
        expect(r.nao_resolvidos).toHaveLength(1);
      } else {
        expect(l?.para).toBe(esperado);
        expect(l?.confianca).toBe(conf);
      }
    });
  it("curinga de pacote do projeto liga a todos os arquivos do pacote (heurística), exceto o próprio", () => {
    const { l } = liga("", imp("br.app.dominio", true));
    expect(l?.alvos).toEqual([`arq:${M}/br/app/dominio/Item.java`, `arq:${M}/br/app/dominio/Pedido.java`]);
    expect(l?.confianca).toBe("heuristica");
  });
  it("mesmo pacote sem import: herança, instância e receptor de tipo", () => {
    const r = proj({
      ...BASE,
      [`${M}/br/app/dominio/Servico.java`]: { simbolos: ["Servico"], herancas: ["Pedido"], chamadas: [{ alvo: "Item", receptor: null }, { alvo: "calcular", receptor: "Item" }, { alvo: "x", receptor: "this" }] },
    });
    const alvos = r.arestas.filter((a) => a.de === `arq:${M}/br/app/dominio/Servico.java`).map((a) => a.para).sort();
    expect(alvos).toEqual([`arq:${M}/br/app/dominio/Item.java`, `arq:${M}/br/app/dominio/Pedido.java`]);
  });
  it("nome importado explicitamente não gera aresta implícita duplicada", () => {
    const r = proj({ ...BASE, [`${M}/br/app/dominio/S.java`]: { imports: [imp("br.app.util.Fmt")], chamadas: [{ alvo: "Fmt", receptor: null }] } });
    expect(r.arestas.filter((a) => a.para.endsWith("Fmt.java"))).toHaveLength(1);
  });
  it("tipo de outro pacote com mesmo nome simples não vira aresta implícita", () => {
    const r = proj({ ...BASE, [`${M}/br/app/web/C.java`]: { herancas: ["Pedido"] } });
    expect(r.arestas).toEqual([]);
  });
  it("multi-módulo: dependência declarada = exata; sem declaração = heurística", () => {
    const man = (pasta: string, nome: string, deps: string[]): Manifesto =>
      ({ arquivo: `${pasta}/pom.xml`, tipo: "pom.xml", eco: "maven", pasta, nome, deps: deps.map((d) => ({ nome: d, versao: null, versao_lock: null, dev: false, eco: "maven" as const, linha: 1 })), comandos: [], modulos: [], referencias: [], main: null, bin: [], exports_alvos: [], psr4: [], classmap: [], go_modulo: null, go_replaces: [], raizes_python: [], lacunas: [] });
    const arquivos = { "core/src/main/java/a/Core.java": { simbolos: ["Core"] }, "web/src/main/java/b/W.java": { imports: [imp("a.Core")] } };
    const com = proj(arquivos, [man("core", "core", []), man("web", "web", ["x:core"])]);
    const sem = proj(arquivos, [man("core", "core", []), man("web", "web", ["x:outra"])]);
    expect(com.ligacoes.find((l) => l.arquivo.startsWith("web"))?.confianca).toBe("exata");
    expect(sem.ligacoes.find((l) => l.arquivo.startsWith("web"))?.confianca).toBe("heuristica");
  });
});

describe("resolvedor Java: fixture real", () => {
  it("PedidoController -> Pedido exata; PedidoService (ausente) listado; JDK e Spring externos", async () => {
    const { ctx } = await montarContexto("java");
    const r = resolvedorJava.resolver(ctx);
    const c = "src/main/java/br/app/web/PedidoController.java";
    const l = (e: string) => r.ligacoes.find((x) => x.arquivo === c && x.especificador === e);
    expect(l("br.app.dominio.Pedido")?.para).toBe("arq:src/main/java/br/app/dominio/Pedido.java");
    expect(l("br.app.dominio.PedidoService")?.para).toBeNull();
    expect(r.nao_resolvidos.some((n) => n.especificador === "br.app.dominio.PedidoService")).toBe(true);
    expect(l("java.util")?.para).toBe("ext:stdlib:java.util");
    expect(l("org.springframework.web.bind.annotation")?.para?.startsWith("ext:maven:org.springframework")).toBe(true);
    expect(l("br.app.util.Formato")?.para).toBe("ext:maven:br.app.util");
  });
});
