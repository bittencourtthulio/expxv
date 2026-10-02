import { describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import type { ImportBruto } from "../tipos";
import type { ArquivoParaResolver } from "./comum";
import { raizesPython, resolvedorPython } from "./python";

// T-17.16 (Python): tabela de casos com ImportBruto sintético (convenção do extrator: `from ..pkg.m import y` ->
// especificador "..pkg.m", `import a.b.c` -> "a.b.c", `import a.b as x` -> nomes [{*, x}]) e fixture real.

const imp = (especificador: string, nomes: string[] = [], linha = 1, tipo: ImportBruto["tipo"] = "estatico"): ImportBruto => ({
  especificador, tipo, linha, so_tipo: false, nomes: nomes.map((n) => ({ nome: n, alias: null })),
});

function projeto(arquivos: Record<string, ImportBruto[]>, manifestos: Parameters<typeof resolvedorPython.resolver>[0]["manifestos"] = []) {
  const mapa = new Map<string, ArquivoParaResolver>();
  for (const [c, imports] of Object.entries(arquivos)) mapa.set(c, { caminho: c, linguagem: "python", extracao: { simbolos: [], imports } });
  return resolvedorPython.resolver({ arquivos: mapa, manifestos });
}

const BASE = {
  "app/__init__.py": [],
  "app/models.py": [],
  "app/util/__init__.py": [],
  "app/util/texto.py": [],
  "app/util/num.py": [],
  "lib/solto.py": [],
  "ns/modulo.py": [],
};

function alvo(arquivo: string, i: ImportBruto, extra: Record<string, ImportBruto[]> = {}) {
  const r = projeto({ ...BASE, ...extra, [arquivo]: [i] });
  return { r, ligacao: r.ligacoes.find((l) => l.arquivo === arquivo), arestas: r.arestas.filter((a) => a.de === `arq:${arquivo}`).map((a) => a.para).sort() };
}

describe("resolvedor Python: tabela de casos", () => {
  const A = "app/servico.py";
  const tabela: Array<[string, string, ImportBruto, string | null, string[]?]> = [
    ["absoluto de módulo", A, imp("app.models"), "arq:app/models.py"],
    ["absoluto de pacote -> __init__", A, imp("app.util"), "arq:app/util/__init__.py"],
    ["absoluto aninhado", A, imp("app.util.texto"), "arq:app/util/texto.py"],
    ["from pkg import submódulo", A, imp("app.util", ["texto"]), "arq:app/util/__init__.py", ["arq:app/util/__init__.py", "arq:app/util/texto.py"]],
    ["from pkg import símbolo (não é submódulo)", A, imp("app.models", ["Modelo"]), "arq:app/models.py", ["arq:app/models.py"]],
    ["relativo nível 1", A, imp(".models"), "arq:app/models.py"],
    ["relativo nível 2 a partir de subpacote", "app/util/x.py", imp("..models"), "arq:app/models.py"],
    ["from . import irmão", "app/util/x.py", imp(".", ["texto"]), "arq:app/util/__init__.py", ["arq:app/util/__init__.py", "arq:app/util/texto.py"]],
    ["from .. import módulo", "app/util/x.py", imp("..", ["models"]), "arq:app/__init__.py", ["arq:app/__init__.py", "arq:app/models.py"]],
    ["relativo com subpacote", A, imp(".util.num"), "arq:app/util/num.py"],
    ["stdlib", A, imp("os"), "ext:stdlib:os"],
    ["stdlib com ponto", A, imp("os.path"), "ext:stdlib:os"],
    ["pip normaliza nome", A, imp("Flask_Cors"), "ext:pip:flask-cors"],
    ["pip com submódulo", A, imp("requests.adapters"), "ext:pip:requests"],
    ["raiz alternativa (lib/ não é raiz; solto.py via pasta)", A, imp("lib.solto"), "arq:lib/solto.py"],
    ["pacote de namespace: from ns import modulo", A, imp("ns", ["modulo"]), null, ["arq:ns/modulo.py"]],
    ["namespace: import ns.modulo", A, imp("ns.modulo"), "arq:ns/modulo.py"],
    ["local inexistente (submódulo ausente) é listado", A, imp("app.nao_existe"), null],
    ["relativo inexistente é listado", A, imp(".fantasma"), null],
    ["relativo que sobe além da raiz é recusado", "app/x.py", imp("...demais"), null],
    ["importlib literal resolve", A, imp("app.models", [], 1, "dinamico"), "arq:app/models.py"],
    ["importlib literal inexistente vira dinâmico", A, imp("app.nada", [], 1, "dinamico"), null],
    ["import a.b as x (nomes *)", A, { ...imp("app.models"), nomes: [{ nome: "*", alias: "m" }] }, "arq:app/models.py", ["arq:app/models.py"]],
  ];
  for (const [nome, arquivo, i, esperado, arestasEsp] of tabela)
    it(nome, () => {
      const { r, ligacao, arestas } = alvo(arquivo, i);
      expect(ligacao).toBeDefined();
      if (esperado !== null) expect(ligacao?.para).toBe(esperado);
      else if (arestasEsp === undefined) {
        expect(ligacao?.para).toBeNull();
        expect(r.nao_resolvidos.length).toBe(1);
      }
      if (arestasEsp !== undefined) expect(arestas).toEqual([...arestasEsp].sort());
    });

  it("motivos: fora_da_raiz e dinamico", () => {
    expect(alvo("app/x.py", imp("...demais")).r.nao_resolvidos[0]?.motivo).toBe("fora_da_raiz");
    expect(alvo(A, imp("app.nada", [], 1, "dinamico")).r.nao_resolvidos[0]?.motivo).toBe("dinamico");
  });
  it("`from .x import y` dentro de __init__.py vira reexporta", () => {
    const r = projeto({ ...BASE, "app/util/__init__.py": [imp(".texto", ["limpar"])] });
    expect(r.arestas.find((a) => a.de === "arq:app/util/__init__.py")?.tipo).toBe("reexporta");
  });
  it("raiz src/ e raízes do pyproject", () => {
    const r = projeto({ "src/pkg/__init__.py": [], "src/pkg/a.py": [imp("pkg.b")], "src/pkg/b.py": [] });
    expect(r.ligacoes.find((l) => l.arquivo === "src/pkg/a.py")?.para).toBe("arq:src/pkg/b.py");
    const ctx = { arquivos: new Map(), manifestos: [{ eco: "pip", raizes_python: ["backend"], pasta: "" }] } as never;
    expect(raizesPython(ctx)).toContain("backend");
  });
  it("pacote de topo aninhado (pasta com __init__.py) vira raiz", () => {
    const r = projeto({ "servicos/api/__init__.py": [], "servicos/api/a.py": [imp("api.b")], "servicos/api/b.py": [] });
    expect(r.ligacoes.find((l) => l.arquivo === "servicos/api/a.py")?.para).toBe("arq:servicos/api/b.py");
  });
  it("script fora de pacote importa irmão da própria pasta (heurística)", () => {
    const r = projeto({ "scripts/run.py": [imp("helper")], "scripts/helper.py": [] });
    const l = r.ligacoes.find((x) => x.arquivo === "scripts/run.py");
    expect(l?.para).toBe("arq:scripts/helper.py");
    expect(l?.confianca).toBe("heuristica");
  });
});

describe("resolvedor Python: fixture real", () => {
  it("todos os imports do projeto resolvem ou são listados; relativos concordam com o gabarito", async () => {
    const { ctx } = await montarContexto("python");
    const r = resolvedorPython.resolver(ctx);
    const total = r.ligacoes.length;
    expect(total).toBeGreaterThan(5);
    expect(r.ligacoes.filter((l) => l.para === null).length).toBe(r.nao_resolvidos.length + r.ligacoes.filter((l) => l.para === null && !r.nao_resolvidos.some((n) => n.arquivo === l.arquivo && n.especificador === l.especificador && n.linha === l.linha)).length);
    // todo import `os`/`sys` é stdlib
    for (const l of r.ligacoes.filter((x) => x.especificador === "os" || x.especificador === "sys")) expect(l.para?.startsWith("ext:stdlib:")).toBe(true);
    // todo relativo que tem alvo no projeto aponta para arquivo do projeto
    for (const l of r.ligacoes.filter((x) => x.especificador.startsWith(".") && x.para !== null)) expect(ctx.arquivos.has((l.para as string).slice(4))).toBe(true);
  });
});
