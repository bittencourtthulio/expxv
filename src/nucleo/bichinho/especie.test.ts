import { describe, expect, it } from "vitest";
import { ESPECIES, ESPECIES_LEGADAS } from "../../compartilhado/bichinho";
import { CATALOGO } from "./catalogo";
import { escolherEspecie, especieEfetiva, hashEstavel } from "./especie";
import { detectarSinais } from "./sinais";
import { leitorDeObjeto, muitos } from "./teste-util";

type Caso = [string, Record<string, string>, string];

const PKG = (extra: object = {}): string => JSON.stringify(extra);

// tabela espécie × sinais (D-461): cada linha é um projeto sintético e a espécie esperada
const CASOS: Caso[] = [
  ["Rust puro", { "Cargo.toml": "", ...muitos("src", "rs", 6) }, "caranguejo"],
  ["Python com pyproject", { "pyproject.toml": "[project]\nname='x'", ...muitos("src", "py", 5) }, "piton"],
  ["Python com requirements", { "requirements.txt": "requests", ...muitos("", "py", 3) }, "piton"],
  ["Go com go.mod", { "go.mod": "module x", ...muitos("cmd", "go", 4), ...muitos("pkg", "go", 3) }, "esquilo"],
  ["JavaScript puro", { "package.json": PKG({ main: "i.js" }), ...muitos("src", "js", 6) }, "raposa"],
  ["TypeScript com tsconfig", { "package.json": PKG(), "tsconfig.json": "{}", ...muitos("src", "ts", 8) }, "camaleao"],
  ["TypeScript + React", { "package.json": PKG({ dependencies: { react: "1" } }), "tsconfig.json": "{}", ...muitos("src", "tsx", 8) }, "camaleao"],
  ["Java com pom", { "pom.xml": "<spring/>", ...muitos("src", "java", 6) }, "lontra"],
  ["Kotlin com gradle kts", { "build.gradle.kts": "", ...muitos("src", "kt", 6) }, "lontra"],
  ["C# com csproj", { "App.csproj": "", ...muitos("", "cs", 5) }, "tucano"],
  ["PHP com composer", { "composer.json": "{\"require\":{\"laravel/framework\":\"1\"}}", ...muitos("app", "php", 6) }, "elefante"],
  ["Ruby com Gemfile", { Gemfile: "", ...muitos("lib", "rb", 5) }, "ourico"],
  ["C com Makefile", { Makefile: "", ...muitos("src", "c", 6), ...muitos("src", "h", 4) }, "urso"],
  ["C++ com CMake", { "CMakeLists.txt": "", ...muitos("src", "cpp", 6) }, "urso"],
  ["Python de dados (pandas)", { "requirements.txt": "pandas\nnumpy", ...muitos("", "py", 3) }, "coruja"],
  ["Python de ML (torch)", { "pyproject.toml": "dependencies=['torch']", ...muitos("src", "py", 6) }, "coruja"],
  ["Notebooks", { "a.ipynb": "", "b.ipynb": "", "c.ipynb": "", "requirements.txt": "x" }, "coruja"],
  ["Terraform", { "main.tf": "", "vars.tf": "", "out.tf": "" }, "polvo"],
  ["Helm chart", { "Chart.yaml": "", "values.yaml": "" }, "polvo"],
  ["Docs em Markdown", { "mkdocs.yml": "", ...muitos("docs", "md", 8) }, "gato"],
  ["Só Markdown", { ...muitos("", "md", 9) }, "gato"],
  ["Flutter", { "pubspec.yaml": "dependencies:\n  flutter:\n", ...muitos("lib", "dart", 6) }, "sapo"],
  ["Swift package", { "Package.swift": "", ...muitos("src", "swift", 5) }, "sapo"],
  ["React Native (TS)", { "package.json": PKG({ dependencies: { "react-native": "1" } }), "tsconfig.json": "{}", ...muitos("src", "tsx", 5) }, "sapo"],
];

describe("espécie × sinais do projeto (≥ 20 casos)", () => {
  for (const [nome, arquivos, esperada] of CASOS) {
    it(`${nome} → ${esperada}`, () => {
      const r = escolherEspecie(detectarSinais(leitorDeObjeto(arquivos)), "meu-projeto");
      expect(r.especie).toBe(esperada);
      expect(r.sem_sinais).toBe(false);
      expect(r.motivo.length).toBeGreaterThan(0);
    });
  }

  it("cobre as 14 espécies originais (as preferidas das suas stacks) e o catálogo tem as 100", () => {
    const vistas = new Set(CASOS.map((c) => c[2]));
    for (const e of ESPECIES_LEGADAS) expect(vistas.has(e), e).toBe(true);
    expect(ESPECIES).toHaveLength(100);
    expect(Object.keys(CATALOGO).sort()).toEqual([...ESPECIES].sort());
  });

  it("é determinística: mesma entrada, mesma espécie, mesmo motivo", () => {
    const a = escolherEspecie(detectarSinais(leitorDeObjeto(CASOS[0]![1])), "x");
    const b = escolherEspecie(detectarSinais(leitorDeObjeto(CASOS[0]![1])), "x");
    expect(a).toEqual(b);
  });

  it("empate é resolvido por hash estável do nome (e o nome decide entre as empatadas, nunca fora delas)", () => {
    const sinais = detectarSinais(leitorDeObjeto({ "Cargo.toml": "", "go.mod": "", ...muitos("a", "rs", 1), ...muitos("b", "go", 1) }));
    const escolhas = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = escolherEspecie(sinais, `projeto-${i}`);
      escolhas.add(r.especie);
      expect(r.motivo.join(" ")).toMatch(/Empate/);
    }
    expect([...escolhas].sort()).toEqual(["caranguejo", "esquilo"]);
    expect(escolherEspecie(sinais, "abc").especie).toBe(escolherEspecie(sinais, "abc").especie);
  });

  it("hash FNV-1a de 32 bits é estável (valores fixos)", () => {
    expect(hashEstavel("")).toBe(0x811c9dc5);
    expect(hashEstavel("a")).toBe(0xe40c292c);
  });

  it("sem nenhum sinal: sorteio estável pelo nome, avisado no motivo", () => {
    const sinais = detectarSinais(leitorDeObjeto({}));
    const r = escolherEspecie(sinais, "pasta-vazia");
    expect(r.sem_sinais).toBe(true);
    expect(ESPECIES).toContain(r.especie);
    expect(r.motivo.join(" ")).toMatch(/Nenhum sinal/);
    expect(escolherEspecie(sinais, "pasta-vazia").especie).toBe(r.especie);
  });

  it("a troca manual vence a automática; null volta ao automático", () => {
    expect(especieEfetiva("raposa", "polvo")).toBe("polvo");
    expect(especieEfetiva("raposa", null)).toBe("raposa");
  });

  it("projeto de dados vence a linguagem Python; infra fraca (só Docker Compose) não vence TypeScript", () => {
    const ts = detectarSinais(leitorDeObjeto({ "package.json": PKG(), "tsconfig.json": "{}", Dockerfile: "", "docker-compose.yml": "", ...muitos("src", "ts", 8) }));
    expect(escolherEspecie(ts, "x").especie).toBe("camaleao");
  });

  it("o mapa de código (Fase 17), quando indexado, substitui a contagem rasa", () => {
    const leitor = leitorDeObjeto({ "package.json": PKG(), ...muitos("src", "js", 6) });
    const comMapa = detectarSinais(leitor, [{ linguagem: "Rust", arquivos: 50, loc: 9000 }, { linguagem: "JavaScript", arquivos: 3, loc: 100 }]);
    expect(escolherEspecie(comMapa, "x").especie).toBe("caranguejo");
  });

  it("nunca abre arquivo de ambiente ou segredo (nem para listar)", () => {
    const lidos: string[] = [];
    const base = leitorDeObjeto({ "package.json": PKG(), ".env": "SEGREDO=1", "chave.pem": "x", "credentials.json": "{}", ...muitos("src", "ts", 3) });
    const leitor = { ...base, ler: (r: string) => { lidos.push(r); return base.ler(r); } };
    const s = detectarSinais(leitor);
    expect(lidos.some((r) => /\.env|\.pem|credential/.test(r))).toBe(false);
    expect(JSON.stringify(s)).not.toMatch(/SEGREDO/);
  });
});
