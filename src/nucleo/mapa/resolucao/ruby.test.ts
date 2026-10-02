import { describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import { lerManifesto } from "../manifestos";
import type { ImportBruto, SimboloBruto } from "../tipos";
import type { ArquivoParaResolver } from "./comum";
import { resolvedorRuby, sublinhado } from "./ruby";

// T-17.18 (Ruby): require_relative exata; require por load path / Zeitwerk heurística; gems; stdlib.

const imp = (especificador: string, tipo: ImportBruto["tipo"] = "require"): ImportBruto => ({ especificador, tipo, linha: 1, so_tipo: false, nomes: [] });
const sim = (q: string): SimboloBruto => ({ nome: q.split(".").pop() as string, qualificado: q, tipo: "classe", linha: 1, linha_fim: 1, exportado: true, visibilidade: "publica", complexidade: 0, assinatura: "", doc: null, decoradores: [] });
interface Arq { imports?: ImportBruto[]; simbolos?: SimboloBruto[]; herancas?: string[]; chamadas?: Array<{ alvo: string; receptor: string | null; tipo?: "chamada" | "instancia" }> }
const GEMFILE = lerManifesto("Gemfile", "gem 'rails'\ngem 'sidekiq-pro'\n")!;

function proj(arquivos: Record<string, Arq>) {
  const mapa = new Map<string, ArquivoParaResolver>();
  for (const [c, v] of Object.entries(arquivos))
    mapa.set(c, { caminho: c, linguagem: "ruby", extracao: { imports: v.imports ?? [], simbolos: v.simbolos ?? [], herancas: (v.herancas ?? []).map((b) => ({ classe: "X", base: b, tipo: "herda" as const, linha: 2 })), chamadas: (v.chamadas ?? []).map((x) => ({ de: null, alvo: x.alvo, receptor: x.receptor, tipo: x.tipo ?? ("chamada" as const), linha: 3 })) } });
  return resolvedorRuby.resolver({ arquivos: mapa, manifestos: [GEMFILE] });
}
const BASE: Record<string, Arq> = {
  "lib/util/texto.rb": {}, "lib/helper.rb": {}, "app/services/calculo.rb": { simbolos: [sim("Calculo")] },
  "app/models/admin/cliente_pedido.rb": { simbolos: [sim("Admin.ClientePedido")] }, "app/models/pedido.rb": { simbolos: [sim("Pedido")] },
};
const O = "app/jobs/job.rb";
const liga = (i: ImportBruto, uso: Arq = {}) => {
  const r = proj({ ...BASE, [O]: { imports: [i], ...uso } });
  return { r, l: r.ligacoes.find((x) => x.arquivo === O && x.especificador === i.especificador) };
};

describe("resolvedor Ruby: tabela", () => {
  it("sublinhado (underscore)", () => {
    expect(sublinhado("ClientePedido")).toBe("cliente_pedido");
    expect(sublinhado("HTTPClient")).toBe("http_client");
    expect(sublinhado("Pedido")).toBe("pedido");
  });
  const tabela: Array<[string, ImportBruto, string | null, "exata" | "heuristica"]> = [
    ["require_relative exata", imp("../services/calculo", "estatico"), "arq:app/services/calculo.rb", "exata"],
    ["require_relative com .rb", imp("../services/calculo.rb", "estatico"), "arq:app/services/calculo.rb", "exata"],
    ["require_relative de ./ irmão", imp("./job_base", "estatico"), null, "exata"],
    ["require por lib/ (load path)", imp("helper"), "arq:lib/helper.rb", "heuristica"],
    ["require por lib/ com subpasta", imp("util/texto"), "arq:lib/util/texto.rb", "heuristica"],
    ["require por autoload path app/services", imp("calculo"), "arq:app/services/calculo.rb", "heuristica"],
    ["stdlib", imp("json"), "ext:stdlib:json", "exata"],
    ["stdlib com subcaminho", imp("net/http"), "ext:stdlib:net", "exata"],
    ["gem do Gemfile", imp("rails"), "ext:gem:rails", "exata"],
    ["gem com hífen -> barra", imp("sidekiq/pro"), "ext:gem:sidekiq-pro", "exata"],
    ["desconhecido é listado", imp("fantasma"), null, "exata"],
    ["require_relative que escapa da raiz é recusado", imp("../../../../x", "estatico"), null, "exata"],
  ];
  for (const [nome, i, esperado, conf] of tabela)
    it(nome, () => {
      const { r, l } = liga(i);
      if (esperado === null) {
        expect(l?.para).toBeNull();
        expect(r.nao_resolvidos.length).toBeGreaterThan(0);
      } else {
        expect(l?.para).toBe(esperado);
        expect(l?.confianca).toBe(conf);
      }
    });
  it("Zeitwerk: herança por constante aninhada (Admin::ClientePedido)", () => {
    const { r } = liga(imp("json"), { herancas: ["Admin::ClientePedido"] });
    expect(r.arestas.find((a) => a.para === "arq:app/models/admin/cliente_pedido.rb")?.confianca).toBe("heuristica");
  });
  it("Zeitwerk: `Foo.new` e receptor constante", () => {
    const { r } = liga(imp("json"), { chamadas: [{ alvo: "new", receptor: "Pedido" }, { alvo: "Calculo", receptor: null, tipo: "instancia" }] });
    const alvos = r.arestas.map((a) => a.para);
    expect(alvos).toContain("arq:app/models/pedido.rb");
    expect(alvos).toContain("arq:app/services/calculo.rb");
  });
  it("constante definida no próprio arquivo não vira aresta", () => {
    const r = proj({ ...BASE, "app/models/pedido.rb": { simbolos: [sim("Pedido")], chamadas: [{ alvo: "x", receptor: "Pedido" }] } });
    expect(r.arestas).toEqual([]);
  });
  it("constante sem arquivo conhecido (de gem) é ignorada", () => {
    const { r } = liga(imp("json"), { herancas: ["ActiveRecord::Base"] });
    expect(r.arestas.every((a) => !a.para.includes("active"))).toBe(true);
  });
  it("não listar `require` dinâmico vazio", () => {
    expect(proj({ "a.rb": { imports: [imp("", "dinamico")] } }).ligacoes).toEqual([]);
  });
});

describe("resolvedor Ruby: fixture real", () => {
  it("pedido.rb: json stdlib, calculo relativo (ausente na fixture) listado", async () => {
    const { ctx } = await montarContexto("ruby");
    const r = resolvedorRuby.resolver(ctx);
    const l = (e: string) => r.ligacoes.find((x) => x.arquivo === "app/models/pedido.rb" && x.especificador === e);
    expect(l("json")?.para).toBe("ext:stdlib:json");
    expect(l("../services/calculo")?.para).toBeNull();
    expect(r.nao_resolvidos.some((n) => n.especificador === "../services/calculo")).toBe(true);
  });
});
