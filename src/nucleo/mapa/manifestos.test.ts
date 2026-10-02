import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RAIZ_FIXTURES_MAPA } from "../../../tests/fixtures/mapa/comparar";
import { aplicarLocks, avisoConfigJs, ehManifesto, lerLock, lerManifesto } from "./manifestos";

const ler = (c: string): string => readFileSync(join(RAIZ_FIXTURES_MAPA, "manifestos", c), "utf8");
const m = (c: string) => {
  const r = lerManifesto(c, ler(c));
  expect(r).not.toBeNull();
  return r!;
};

describe("manifestos: um por formato, com arquivo:linha", () => {
  it("package.json: deps, scripts com linha, bin, main, exports, workspaces", () => {
    const r = m("package.json");
    expect(r.nome).toBe("demo");
    expect(r.deps.map((d) => [d.nome, d.dev, d.linha])).toEqual([["express", false, 11], ["left-pad", false, 11], ["vitest", true, 12]]);
    expect(r.comandos).toEqual([
      { nome: "build", comando: "tsc -p .", arquivo: "package.json", linha: 8 },
      { nome: "test", comando: "vitest run", arquivo: "package.json", linha: 9 },
    ]);
    expect(r.main).toBe("dist/index.js");
    expect(r.bin).toEqual(["bin/demo.js"]);
    expect(r.exports_alvos).toEqual(["./dist/index.mjs", "./dist/index.cjs"]);
    expect(r.modulos).toEqual(["packages/*"]);
  });
  it("composer.json: ignora php/ext, psr-4 com dev, classmap, scripts em lista", () => {
    const r = m("composer.json");
    expect(r.deps.map((d) => [d.nome, d.dev])).toEqual([["laravel/framework", false], ["phpunit/phpunit", true]]);
    expect(r.psr4).toEqual([{ prefixo: "App\\", pasta: "app", dev: false }, { prefixo: "Tests\\", pasta: "tests", dev: true }]);
    expect(r.classmap).toEqual(["database/seeds"]);
    expect(r.comandos.find((c) => c.nome === "post-install-cmd")?.comando).toBe("@php artisan key:generate && @php artisan config:cache");
  });
  it("pom.xml: módulos, ignora dependencyManagement, escopo test", () => {
    const r = m("pom.xml");
    expect(r.nome).toBe("app");
    expect(r.modulos).toEqual(["core", "web"]);
    expect(r.deps.map((d) => [d.nome, d.versao, d.dev])).toEqual([["org.springframework:spring-web", "6.0.0", false], ["junit:junit", "4.13", true]]);
  });
  it("build.gradle: dependências por regex", () => {
    expect(m("build.gradle").deps.map((d) => [d.nome, d.versao, d.dev])).toEqual([["com.google.guava:guava", "32.0.0", false], ["org.junit.jupiter:junit-jupiter", "5.10.0", true]]);
  });
  it(".csproj: PackageReference e ProjectReference; referência fora da raiz é recusada com lacuna", () => {
    const r = m("app/App.csproj");
    expect(r.deps[0]).toMatchObject({ nome: "Newtonsoft.Json", versao: "13.0.1", eco: "nuget" });
    expect(r.referencias).toEqual(["lib/Lib.csproj"]);
    expect(r.lacunas[0]).toContain("fora da raiz");
  });
  it("go.mod: módulo, require (bloco), indirect e replace local", () => {
    const r = m("go.mod");
    expect(r.go_modulo).toBe("github.com/acme/app");
    expect(r.deps.map((d) => d.nome)).toEqual(["github.com/gin-gonic/gin", "golang.org/x/text"]);
    // replace local fora da raiz é recusado; replace remoto é ignorado
    expect(r.go_replaces).toEqual([]);
  });
  it("Cargo.toml: deps (string e tabela), dev, workspace", () => {
    const r = m("Cargo.toml");
    expect(r.deps.map((d) => [d.nome, d.versao, d.dev, d.linha])).toEqual([["serde", "1.0", false, 9], ["tokio", "1", false, 10], ["pretty_assertions", "1", true, 13]]);
    expect(r.modulos).toEqual(["crates/a", "crates/b"]);
  });
  it("pyproject.toml: PEP 508, extras dev, poetry, scripts", () => {
    const r = m("pyproject.toml");
    const nomes = r.deps.map((d) => `${d.nome}${d.dev ? "*" : ""}`);
    expect(nomes).toEqual(["requests", "flask-cors", "pytest*", "django", "factory-boy*"]);
    expect(r.comandos[0]).toMatchObject({ nome: "demo", comando: "demo.cli:main", linha: 9 });
  });
  it("requirements.txt, Gemfile, Makefile e workflow", () => {
    expect(m("requirements.txt").deps.map((d) => [d.nome, d.versao, d.linha])).toEqual([["requests", "==2.31.0", 1], ["flask", ">=2.0", 4]]);
    expect(m("Gemfile").deps.map((d) => [d.nome, d.dev])).toEqual([["rails", false], ["rspec-rails", true]]);
    expect(m("Makefile").comandos).toEqual([
      { nome: "all", comando: "", arquivo: "Makefile", linha: 1 },
      { nome: "build", comando: "go build ./...", arquivo: "Makefile", linha: 3 },
    ]);
    const w = lerManifesto(".github/workflows/ci.yml", ler(".github/workflows/ci.yml"))!;
    expect(w.comandos).toEqual([
      { nome: "test/Instalar", comando: "npm ci", arquivo: ".github/workflows/ci.yml", linha: 9 },
      { nome: "test/3", comando: "npm test", arquivo: ".github/workflows/ci.yml", linha: 10 },
    ]);
  });
});

describe("manifestos: segurança e robustez", () => {
  it("config JS não é lida: vira lacuna com aviso (nada é executado)", () => {
    const r = lerManifesto("webpack.config.js", ler("webpack.config.js"))!;
    expect(r.lacunas[0]).toContain("executaria código do projeto");
    expect(avisoConfigJs("sub/.dependency-cruiser.js")).not.toBeNull();
    expect(avisoConfigJs("src/a.ts")).toBeNull();
  });
  it("manifesto malformado vira lacuna, nunca exceção", () => {
    expect(lerManifesto("package.json", '{ "name": "q", ')!.lacunas.length).toBe(1);
    expect(lerManifesto("composer.json", "nada")!.lacunas.length).toBe(1);
    expect(lerManifesto("Cargo.toml", "[x\n= 1")!.lacunas.length).toBeGreaterThan(0);
    expect(lerManifesto(".github/workflows/x.yml", "a: [")!.comandos).toEqual([]);
  });
  it("arquivo que não é manifesto devolve null", () => {
    expect(lerManifesto("src/a.ts", "")).toBeNull();
    expect(ehManifesto("a/b/go.mod")).toBe(true);
  });
});

describe("locks dão a versão exata", () => {
  it("package-lock, composer.lock, Cargo.lock, go.sum, Gemfile.lock", () => {
    const npm = lerLock("package-lock.json", JSON.stringify({ packages: { "": {}, "node_modules/express": { version: "4.19.2" }, "node_modules/a/node_modules/@s/b": { version: "1.0.0" } } }))!;
    expect(npm.versoes.get("express")).toBe("4.19.2");
    expect(npm.versoes.get("@s/b")).toBe("1.0.0");
    expect(lerLock("composer.lock", JSON.stringify({ packages: [{ name: "a/b", version: "v1.2.3" }] }))!.versoes.get("a/b")).toBe("1.2.3");
    expect(lerLock("Cargo.lock", '[[package]]\nname = "serde"\nversion = "1.0.200"\n')!.versoes.get("serde")).toBe("1.0.200");
    expect(lerLock("go.sum", "x/y v1.0.0 h1:abc\nx/y v1.0.0/go.mod h1:def\n")!.versoes.get("x/y")).toBe("v1.0.0");
    expect(lerLock("Gemfile.lock", "GEM\n  specs:\n    rails (7.0.8)\n      rack (>= 2)\n")!.versoes.get("rails")).toBe("7.0.8");
    expect(lerLock("pnpm-lock.yaml", "packages:\n  /express@4.19.2:\n    x: 1\n  '@s/b@1.0.0(peer@2)':\n    x: 1\n")!.versoes.get("@s/b")).toBe("1.0.0");
    expect(lerLock("outro.txt", "")).toBeNull();
  });
  it("aplicarLocks preenche versao_lock só do mesmo ecossistema", () => {
    const man = m("package.json");
    aplicarLocks([man], [lerLock("package-lock.json", JSON.stringify({ packages: { "node_modules/express": { version: "4.19.2" } } }))!]);
    expect(man.deps.find((d) => d.nome === "express")?.versao_lock).toBe("4.19.2");
    expect(man.deps.find((d) => d.nome === "vitest")?.versao_lock).toBeNull();
  });
});
