import { describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import { lerManifesto } from "../manifestos";
import type { ImportBruto, SimboloBruto } from "../tipos";
import type { ArquivoParaResolver } from "./comum";
import { resolvedorCsharp, tiposDoArquivo } from "./csharp";

// T-17.17 (C#): using -> namespace (heurística) afinado pelo tipo usado (única -> exata); static/alias; projeto.

const imp = (especificador: string, nomes: Array<{ nome: string; alias: string | null }> = []): ImportBruto => ({ especificador, tipo: "estatico", linha: 1, so_tipo: false, nomes });
const sim = (q: string, tipo: SimboloBruto["tipo"] = "classe"): SimboloBruto => ({ nome: q.split(".").pop() as string, qualificado: q, tipo, linha: 1, linha_fim: 1, exportado: true, visibilidade: "publica", complexidade: 0, assinatura: "", doc: null, decoradores: [] });

interface Arq { imports?: ImportBruto[]; simbolos?: SimboloBruto[]; herancas?: Array<{ classe: string; base: string }>; chamadas?: Array<{ alvo: string; receptor: string | null; tipo?: "chamada" | "instancia" | "referencia" }> }
function proj(arquivos: Record<string, Arq>, manifestos: Parameters<typeof resolvedorCsharp.resolver>[0]["manifestos"] = []) {
  const mapa = new Map<string, ArquivoParaResolver>();
  for (const [c, v] of Object.entries(arquivos))
    mapa.set(c, { caminho: c, linguagem: "csharp", extracao: { imports: v.imports ?? [], simbolos: v.simbolos ?? [], herancas: (v.herancas ?? []).map((h) => ({ ...h, tipo: "herda" as const, linha: 2 })), chamadas: (v.chamadas ?? []).map((c2) => ({ de: null, alvo: c2.alvo, receptor: c2.receptor, tipo: c2.tipo ?? ("chamada" as const), linha: 3 })) } });
  return resolvedorCsharp.resolver({ arquivos: mapa, manifestos });
}

const BASE: Record<string, Arq> = {
  "Domain/Pedido.cs": { simbolos: [sim("Loja.Domain.Pedido"), sim("Loja.Domain.Pedido.Item"), sim("Loja.Domain.Pedido.Total", "metodo")] },
  "Domain/Cliente.cs": { simbolos: [sim("Loja.Domain.Cliente")] },
  "Data/Repo.cs": { simbolos: [sim("Loja.Data.PedidoRepository")] },
  "Outro/Pedido.cs": { simbolos: [sim("Outro.Pedido")] },
};
const O = "Web/Ctl.cs";
const liga = (imports: ImportBruto[], usos: Arq = {}, extra: Record<string, Arq> = {}, man: Parameters<typeof proj>[1] = []) => {
  const r = proj({ ...BASE, ...extra, [O]: { imports, simbolos: [sim("Loja.Web.Ctl")], ...usos } }, man);
  return { r, l: r.ligacoes.filter((x) => x.arquivo === O) };
};

describe("resolvedor C#: tabela", () => {
  it("tiposDoArquivo ignora aninhados e membros", () => {
    const t = tiposDoArquivo({ caminho: "x", linguagem: "csharp", extracao: { imports: [], simbolos: BASE["Domain/Pedido.cs"]!.simbolos! } });
    expect(t.map((x) => x.fqn)).toEqual(["Loja.Domain.Pedido"]);
    expect(t[0]?.ns).toBe("Loja.Domain");
  });
  it("using sem uso de tipo liga a todos os arquivos do namespace (heurística)", () => {
    const { l } = liga([imp("Loja.Domain")]);
    expect(l[0]?.alvos?.sort()).toEqual(["arq:Domain/Cliente.cs", "arq:Domain/Pedido.cs"]);
    expect(l[0]?.confianca).toBe("heuristica");
  });
  it("tipo usado e único entre os using -> exata, só o arquivo do tipo", () => {
    const { l } = liga([imp("Loja.Domain")], { chamadas: [{ alvo: "Pedido", receptor: null, tipo: "instancia" }] });
    expect(l[0]?.alvos).toEqual(["arq:Domain/Pedido.cs"]);
    expect(l[0]?.confianca).toBe("exata");
  });
  it("mesmo nome em dois namespaces com using nos dois -> heurística", () => {
    const { l } = liga([imp("Loja.Domain"), imp("Outro")], { chamadas: [{ alvo: "Pedido", receptor: null, tipo: "instancia" }] });
    expect(l.every((x) => x.confianca === "heuristica")).toBe(true);
    expect(l.flatMap((x) => x.alvos ?? []).sort()).toEqual(["arq:Domain/Pedido.cs", "arq:Outro/Pedido.cs"]);
  });
  it("só um using -> a ambiguidade de outro namespace não visível não afeta", () => {
    const { l } = liga([imp("Loja.Domain")], { herancas: [{ classe: "Ctl", base: "Pedido" }] });
    expect(l[0]?.confianca).toBe("exata");
  });
  it("tipo usado por receptor (`Cliente.Criar()`)", () => {
    const { l } = liga([imp("Loja.Domain")], { chamadas: [{ alvo: "Criar", receptor: "Cliente" }] });
    expect(l[0]?.alvos).toEqual(["arq:Domain/Cliente.cs"]);
  });
  it("using static aponta para o tipo", () => {
    const { l } = liga([imp("Loja.Data.PedidoRepository", [{ nome: "static", alias: null }])]);
    expect(l[0]).toMatchObject({ para: "arq:Data/Repo.cs", confianca: "exata" });
  });
  it("alias de tipo (using Repo = X.Y)", () => {
    const { l } = liga([imp("Loja.Data.PedidoRepository", [{ nome: "*", alias: "Repo" }])]);
    expect(l[0]?.para).toBe("arq:Data/Repo.cs");
  });
  it("alias de namespace", () => {
    const { l } = liga([imp("Loja.Domain", [{ nome: "*", alias: "D" }])]);
    expect(l[0]?.alvos).toHaveLength(2);
  });
  it("System é stdlib", () => expect(liga([imp("System.Collections.Generic")]).l[0]?.para).toBe("ext:stdlib:System.Collections"));
  it("using static de System", () => expect(liga([imp("System.Math", [{ nome: "static", alias: null }])]).l[0]?.para).toBe("ext:stdlib:System.Math"));
  it("pacote NuGet declarado no csproj", () => {
    const man = [lerManifesto("Web/Web.csproj", '<PackageReference Include="Newtonsoft.Json" Version="13" />')!];
    expect(liga([imp("Newtonsoft.Json.Linq")], {}, {}, man).l[0]?.para).toBe("ext:nuget:Newtonsoft.Json");
  });
  it("namespace desconhecido vira externo nuget (2 segmentos)", () => expect(liga([imp("Acme.Util.Deep")]).l[0]?.para).toBe("ext:nuget:Acme.Util"));
  it("namespace pai do projeto sem tipos próprios não vira externo", () => {
    const { l } = liga([imp("Loja")]);
    expect(l[0]?.para).toBeNull();
  });
  it("namespace do próprio arquivo é implícito: tipo usado no mesmo namespace gera aresta sem using", () => {
    const r = proj({ ...BASE, "Domain/Servico.cs": { simbolos: [sim("Loja.Domain.Servico")], chamadas: [{ alvo: "Cliente", receptor: null, tipo: "instancia" }] } });
    expect(r.arestas.find((a) => a.de === "arq:Domain/Servico.cs")?.para).toBe("arq:Domain/Cliente.cs");
  });
  it("namespace pai é visível implicitamente (Loja.Web vê Loja.X)", () => {
    const r = proj({ "Raiz/Base.cs": { simbolos: [sim("Loja.Base")] }, "Web/W.cs": { simbolos: [sim("Loja.Web.W")], herancas: [{ classe: "W", base: "Base" }] } });
    expect(r.arestas.map((a) => a.para)).toEqual(["arq:Raiz/Base.cs"]);
  });
  it("DI: classe e interface registradas na mesma linha ligam os dois arquivos", () => {
    const r = proj({
      "Domain/IRepo.cs": { simbolos: [sim("Loja.Domain.IRepo", "interface")] },
      "Domain/Repo.cs": { simbolos: [sim("Loja.Domain.Repo")] },
      "Web/Startup.cs": { imports: [imp("Loja.Domain")], simbolos: [sim("Loja.Web.Startup")], herancas: [{ classe: "Repo", base: "IRepo" }] },
    });
    expect(r.arestas.filter((a) => a.de === "arq:Web/Startup.cs").map((a) => a.para).sort()).toEqual(["arq:Domain/IRepo.cs", "arq:Domain/Repo.cs"]);
  });
  it("ProjectReference: tipo de projeto não referenciado cai para heurística", () => {
    const man = [lerManifesto("Web/Web.csproj", '<ProjectReference Include="..\\Dados\\Dados.csproj" />')!, lerManifesto("Dados/Dados.csproj", "<Project/>")!, lerManifesto("Domain/Domain.csproj", "<Project/>")!];
    const { l } = liga([imp("Loja.Domain")], { chamadas: [{ alvo: "Pedido", receptor: null, tipo: "instancia" }] }, {}, man);
    expect(l[0]?.confianca).toBe("heuristica");
    const man2 = [lerManifesto("Web/Web.csproj", '<ProjectReference Include="..\\Domain\\Domain.csproj" />')!, lerManifesto("Domain/Domain.csproj", "<Project/>")!];
    expect(liga([imp("Loja.Domain")], { chamadas: [{ alvo: "Pedido", receptor: null, tipo: "instancia" }] }, {}, man2).l[0]?.confianca).toBe("exata");
  });
  it("tipo aninhado não é alvo próprio (Pedido.Item resolve no arquivo de Pedido)", () => {
    const { l } = liga([imp("Loja.Domain")], { chamadas: [{ alvo: "Item", receptor: "Pedido" }] });
    expect(l[0]?.alvos).toEqual(["arq:Domain/Pedido.cs"]);
  });
});

describe("resolvedor C#: fixture real", () => {
  it("PedidosController: using Loja.Domain (sem arquivos) é namespace do projeto; System é stdlib; alias resolve", async () => {
    const { ctx } = await montarContexto("csharp");
    const r = resolvedorCsharp.resolver(ctx);
    const l = (e: string) => r.ligacoes.find((x) => x.arquivo === "Controllers/PedidosController.cs" && x.especificador === e);
    expect(l("System")?.para).toBe("ext:stdlib:System");
    expect(l("Loja.Data.PedidoRepository")?.confianca).toBeDefined();
    expect(l("System.Math")?.para).toBe("ext:stdlib:System.Math");
  });
});
