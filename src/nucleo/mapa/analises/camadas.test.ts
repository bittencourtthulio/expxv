import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { avaliarRegras, ehArquivoDeRegras, importarRegras, type ArquivoConfig } from "../regras-fronteira";
import { calcularCamadas } from "./camadas";

const FIX = join(__dirname, "../../../../tests/fixtures/mapa/analises/regras");
const cfg = (caminhoFixture: string, comoCaminho = caminhoFixture): ArquivoConfig => ({ caminho: comoCaminho, texto: readFileSync(join(FIX, caminhoFixture), "utf8") });

describe("importadores de regras (um arquivo de cada ferramenta)", () => {
  it("deptrac: pares fora do ruleset viram proibições com a linha da camada de origem", () => {
    const { regras, avisos } = importarRegras([cfg("deptrac.yaml", "deptrac.yaml")]);
    expect(avisos).toEqual([]);
    const pares = regras.map((r) => `${r.origem}>${r.destino}@${r.fonte.linha}`).sort();
    expect(pares).toEqual(["Controller>Repository@18", "Repository>Controller@22", "Repository>Service@22", "Service>Controller@20"]);
    expect(regras.every((r) => r.ferramenta === "deptrac" && r.tipo === "proibida" && r.fonte.arquivo === "deptrac.yaml")).toBe(true);
  });

  it("import-linter: INI (layers e forbidden) e pyproject.toml", () => {
    const ini = importarRegras([cfg(".importlinter", ".importlinter")]);
    const nomes = ini.regras.map((r) => `${r.nome}|${r.origem}>${r.destino}`).sort();
    expect(nomes).toEqual(["Camadas do app|dominio>web", "Camadas do app|infra>dominio", "Camadas do app|infra>web", "Dominio sem requests|app.dominio>app.web"]);
    const toml = importarRegras([cfg("pyproject.toml", "pyproject.toml")]);
    expect(toml.regras.map((r) => `${r.origem}>${r.destino}`)).toEqual(["servicos>api"]);
    expect(toml.regras[0]?.fonte).toEqual({ arquivo: "pyproject.toml", linha: 7 });
  });

  it("dependency-cruiser: JSON importado (só regras com caminho); .js não é lido e vira aviso", () => {
    const r = importarRegras([cfg(".dependency-cruiser.json", ".dependency-cruiser.json"), cfg(".dependency-cruiser.js", ".dependency-cruiser.js")]);
    expect(r.regras).toHaveLength(1);
    expect(r.regras[0]).toMatchObject({ nome: "ui-nao-toca-banco", fonte: { arquivo: ".dependency-cruiser.json", linha: 4 } });
    expect(r.avisos).toEqual([expect.stringContaining("executaria código do projeto")]);
  });

  it("Packwerk: pacote com enforce_dependencies sem a dependência declarada", () => {
    const r = importarRegras([cfg("packs/pagamentos/package.yml", "packs/pagamentos/package.yml"), cfg("packs/pedidos/package.yml", "packs/pedidos/package.yml")]);
    expect(r.regras.map((x) => `${x.origem}>${x.destino}`)).toEqual(["packs/pedidos>packs/pagamentos"]);
  });

  it("YAML inválido e arquivos não relacionados não lançam", () => {
    expect(importarRegras([{ caminho: "deptrac.yaml", texto: "a: [b" }, { caminho: "README.md", texto: "x" }]).avisos).toHaveLength(1);
    expect(ehArquivoDeRegras("a/.dependency-cruiser.cjs")).toBe(true);
    expect(ehArquivoDeRegras("src/a.ts")).toBe(false);
  });
});

describe("violações citam a regra e a importação", () => {
  it("deptrac e dependency-cruiser", () => {
    const { regras } = importarRegras([cfg("deptrac.yaml", "deptrac.yaml"), cfg(".dependency-cruiser.json", ".dependency-cruiser.json")]);
    const v = avaliarRegras(regras, [
      { de: "src/Controller/A.php", para: "src/Repository/R.php", linha: 7 },
      { de: "src/Controller/A.php", para: "src/Service/S.php", linha: 8 },
      { de: "src/ui/tela.ts", para: "src/db/conexao.ts", linha: 3 },
    ]);
    expect(v.map((x) => `${x.evidencia} <- ${x.regra_fonte}`).sort()).toEqual(["src/Controller/A.php:7 <- deptrac.yaml:18", "src/ui/tela.ts:3 <- .dependency-cruiser.json:4"]);
    expect(v.every((x) => x.regra.descricao.length > 0)).toBe(true);
  });
});

describe("calcularCamadas", () => {
  const arquivos = ["web/a.ts", "web/b.ts", "dominio/d.ts", "infra/i.ts", "util/u.ts", "ciclo1/x.ts", "ciclo2/y.ts"].map((caminho) => ({ caminho }));
  const importacoes = [
    { de: "web/a.ts", para: "dominio/d.ts", linha: 1 },
    { de: "web/b.ts", para: "dominio/d.ts", linha: 2 },
    { de: "dominio/d.ts", para: "infra/i.ts", linha: 3 },
    { de: "infra/i.ts", para: "util/u.ts", linha: 4 },
    { de: "dominio/d.ts", para: "util/u.ts", linha: 5 },
    { de: "ciclo1/x.ts", para: "ciclo2/y.ts", linha: 1 },
    { de: "ciclo1/x.ts", para: "ciclo2/y.ts", linha: 2 },
    { de: "ciclo2/y.ts", para: "ciclo1/x.ts", linha: 9 },
    { de: "ciclo2/y.ts", para: "util/u.ts", linha: 10 },
  ];
  const r = calcularCamadas({ arquivos, importacoes });
  const mod = (m: string) => r.modulos.find((x) => x.modulo === m)!;

  it("projeto em três camadas: níveis inferidos, ca/ce e instabilidade", () => {
    expect([mod("util").camada, mod("infra").camada, mod("dominio").camada, mod("web").camada]).toEqual([0, 1, 2, 3]);
    expect(mod("dominio")).toMatchObject({ ca: 1, ce: 2, instabilidade: 0.667, arquivos: 1 });
    expect(mod("util")).toMatchObject({ ca: 3, ce: 0, instabilidade: 0 });
  });
  it("módulos em ciclo agrupados com o mesmo nível e a aresta mais fraca como violação candidata", () => {
    expect(mod("ciclo1").ciclo_id).toBe(1);
    expect(mod("ciclo1").camada).toBe(mod("ciclo2").camada);
    expect(r.ciclos).toEqual([{ id: 1, modulos: ["ciclo1", "ciclo2"], quebrar: [{ de: "ciclo2", para: "ciclo1", peso: 1 }, { de: "ciclo1", para: "ciclo2", peso: 2 }] }]);
    expect(r.violacoes_candidatas.find((v) => v.de_modulo === "ciclo2")).toMatchObject({ origem: "inferida", de_modulo: "ciclo2", para_modulo: "ciclo1", evidencias: ["ciclo2/y.ts:9"] });
  });
  it("DSM ordenada da camada mais alta para a mais baixa", () => {
    expect(r.dsm.modulos[0]).toBe("web");
    expect(r.dsm.modulos.at(-1)).toBe("util");
    const i = r.dsm.modulos.indexOf("web");
    const j = r.dsm.modulos.indexOf("dominio");
    expect(r.dsm.celulas[i]![j]).toBe(2);
    expect(r.dsm.celulas[j]![i]).toBe(0);
  });
  it("camadas manuais: depender de camada mais alta é violação com evidência", () => {
    const m = calcularCamadas({
      arquivos,
      importacoes: [...importacoes, { de: "infra/i.ts", para: "web/a.ts", linha: 42 }],
      manuais: [{ nome: "Apresentação", nivel: 3, pastas: ["web"] }, { nome: "Infra", nivel: 1, pastas: ["infra"] }],
    });
    expect(m.modulos.find((x) => x.modulo === "web")?.camada_manual).toBe("Apresentação");
    expect(m.violacoes_candidatas.find((v) => v.origem === "manual")).toMatchObject({ de_modulo: "infra", para_modulo: "web", evidencias: ["infra/i.ts:42"] });
  });
  it("regras importadas geram violações no resultado", () => {
    const { regras } = importarRegras([cfg(".dependency-cruiser.json", ".dependency-cruiser.json")]);
    const v = calcularCamadas({ arquivos: [{ caminho: "src/ui/t.ts" }, { caminho: "src/db/c.ts" }], importacoes: [{ de: "src/ui/t.ts", para: "src/db/c.ts", linha: 3 }], regras });
    expect(v.violacoes_regras).toHaveLength(1);
  });
  it("sem arestas: tudo no nível 0", () => {
    expect(calcularCamadas({ arquivos: [{ caminho: "a/x.ts" }], importacoes: [] }).modulos).toEqual([{ modulo: "a", camada: 0, camada_manual: null, ca: 0, ce: 0, instabilidade: 0, ciclo_id: null, arquivos: 1 }]);
  });
});
