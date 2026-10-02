import { describe, expect, it } from "vitest";
import { lerToml } from "./toml-minimo";

describe("toml-minimo", () => {
  it("tabelas, strings, números, booleanos e arrays", () => {
    const r = lerToml('[package]\nname = "x"\nversion = \'1.2.3\'\nedition = 2021\nok = true\nfeatures = ["a", "b"]\n');
    expect(r.valor).toEqual({ package: { name: "x", version: "1.2.3", edition: 2021, ok: true, features: ["a", "b"] } });
    expect(r.linhas.get("package.name")).toBe(2);
    expect(r.linhas.get("package.version")).toBe(3);
  });

  it("[workspace] e [tool.poetry.dependencies] com tabelas inline", () => {
    const r = lerToml('[workspace]\nmembers = [\n  "a", # comentário\n  "b/*",\n]\n\n[tool.poetry.dependencies]\npython = "^3.11"\nrequests = { version = "^2.0", optional = true }\n');
    expect((r.valor.workspace as { members: string[] }).members).toEqual(["a", "b/*"]);
    const deps = (r.valor.tool as { poetry: { dependencies: Record<string, unknown> } }).poetry.dependencies;
    expect(deps.requests).toEqual({ version: "^2.0", optional: true });
    expect(r.linhas.get("tool.poetry.dependencies.requests")).toBe(9);
  });

  it("arrays de tabelas, chaves pontilhadas e strings multilinha", () => {
    const r = lerToml('[[bin]]\nname = "a"\n[[bin]]\nname = "b"\n[dependencies]\nserde.version = "1"\n"quoted.key" = 1\ntxt = """\nlinha\n"""\n');
    expect(r.valor.bin).toEqual([{ name: "a" }, { name: "b" }]);
    expect((r.valor.dependencies as Record<string, unknown>)["serde"]).toEqual({ version: "1" });
    expect((r.valor.dependencies as Record<string, unknown>)["quoted.key"]).toBe(1);
  });

  it("malformado nunca lança: devolve o que deu e registra lacuna", () => {
    const r = lerToml('[a]\nx = \n= 3\ny = "ok"\n[b\nz = 1\n');
    expect(r.lacunas.length).toBeGreaterThan(0);
    expect((r.valor.a as Record<string, unknown>).y).toBe("ok");
  });
});
