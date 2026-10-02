import { describe, expect, it } from "vitest";
import type { LeitorProjeto } from "./detectar";
import { prechecar } from "./prechecagens";

function memoria(arquivos: Record<string, string>): LeitorProjeto {
  const caminhos = Object.keys(arquivos);
  return {
    ler: (r) => arquivos[r] ?? null,
    existe: (r) => r in arquivos || caminhos.some((c) => c.startsWith(`${r}/`)),
    listar(r) { const pref = r === "." ? "" : `${r}/`; return [...new Set(caminhos.filter((c) => c.startsWith(pref)).map((c) => c.slice(pref.length).split("/")[0]!))]; },
  };
}
const cfg = (executavel: string, argumentos: string[], cwd = ".", pre_passos: Array<{ executavel: string; argumentos: string[] }> = []) => ({ executavel, argumentos, cwd, pre_passos, shell: null });
const PKG = JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "1" } });

describe("prechecagens (sem executar nada)", () => {
  it("node_modules ausente: avisa com o gerenciador certo e sugere o pré-passo", () => {
    const a = prechecar(memoria({ "desktop/package.json": PKG }), cfg("pnpm", ["run", "dev"], "desktop"));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ codigo: "sem_node_modules", pre_passo: { executavel: "pnpm", argumentos: ["install"] } });
    expect(a[0]!.mensagem).toContain("de desktop");
    expect(a[0]!.mensagem).toContain("pnpm install");
  });
  it.each([
    ["node_modules na pasta", { "package.json": PKG, "node_modules/x/y.js": "" }, cfg("npm", ["run", "dev"])],
    ["node_modules hoisted na raiz do workspace", { "a/package.json": PKG, "node_modules/x/y.js": "" }, cfg("npm", ["run", "dev"], "a")],
    ["sem dependências a instalar", { "package.json": JSON.stringify({ scripts: { dev: "node x" } }) }, cfg("npm", ["run", "dev"])],
    ["já instala antes", { "package.json": PKG }, cfg("npm", ["run", "dev"], ".", [{ executavel: "npm", argumentos: ["ci"] }])],
    ["o próprio comando é a instalação", { "package.json": PKG }, cfg("npm", ["install"])],
    ["sem package.json", { Makefile: "run:\n\tx" }, cfg("npm", ["run", "dev"])],
  ])("sem aviso: %s", (_n, arquivos, c) => {
    expect(prechecar(memoria(arquivos), c)).toEqual([]);
  });
  it("Python sem venv: avisa; uv.lock sugere `uv sync`; com .venv/pyvenv.cfg não avisa", () => {
    const sem = prechecar(memoria({ "motor/pyproject.toml": "" }), cfg("python3", ["-m", "pytest"], "motor"));
    expect(sem[0]).toMatchObject({ codigo: "sem_venv", pre_passo: null });
    const uv = prechecar(memoria({ "motor/pyproject.toml": "", "motor/uv.lock": "" }), cfg("python3", ["-m", "pytest"], "motor"));
    expect(uv[0]).toMatchObject({ codigo: "sem_venv", pre_passo: { executavel: "uv", argumentos: ["sync"] } });
    expect(prechecar(memoria({ "motor/pyproject.toml": "", "motor/.venv/pyvenv.cfg": "" }), cfg("python3", ["-m", "pytest"], "motor"))).toEqual([]);
    expect(prechecar(memoria({ "motor/pyproject.toml": "" }), cfg("uv", ["run", "pytest"], "motor"))).toEqual([]);
  });
  it("Docker e outros programas fora do PATH (só procura)", () => {
    const amb = { programaNoPath: (n: string) => n === "npm" };
    const a = prechecar(memoria({}), cfg("docker", ["compose", "up"]), amb);
    expect(a).toEqual([expect.objectContaining({ codigo: "sem_docker", pre_passo: null })]);
    expect(prechecar(memoria({}), cfg("cargo", ["run"]), amb)[0]).toMatchObject({ codigo: "sem_programa" });
    expect(prechecar(memoria({}), cfg("./gradlew", ["run"]), amb)).toEqual([]);
    expect(prechecar(memoria({}), cfg("docker", ["compose", "up"]), { programaNoPath: () => true })).toEqual([]);
    // sem `programaNoPath` não confere programa
    expect(prechecar(memoria({}), cfg("docker", ["compose", "up"]))).toEqual([]);
  });
});
