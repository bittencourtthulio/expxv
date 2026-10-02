import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { leitorDeDisco } from "./armazem";
import { corpoDaConfig, detectarConfiguracoes, leitorEm, type LeitorProjeto } from "./detectar";
import { globsDoPnpm, pacotesDosGlobs, varrerPastas } from "./monorepo";
import { validarConfig } from "./validacao";

const FIXTURES = resolve(__dirname, "../../../tests/fixtures/executar");
const det = (nome: string) => detectarConfiguracoes(leitorDeDisco(join(FIXTURES, nome)));
const linha = (c: { executavel: string; argumentos: string[] }) => [c.executavel, ...c.argumentos].join(" ");

/** leitor em memória: `listar` deriva dos caminhos (pasta = tem filhos) */
function memoria(arquivos: Record<string, string>): LeitorProjeto & { listados: number } {
  const caminhos = Object.keys(arquivos);
  const estado = { listados: 0 };
  return {
    ler: (r) => arquivos[r] ?? null,
    existe: (r) => r in arquivos || caminhos.some((c) => c.startsWith(`${r}/`)),
    listar(r) {
      estado.listados += 1;
      const pref = r === "." ? "" : `${r}/`;
      return [...new Set(caminhos.filter((c) => c.startsWith(pref)).map((c) => c.slice(pref.length).split("/")[0]!))];
    },
    get listados() { return estado.listados; },
  };
}

describe("monorepo: fixture sintética da estrutura do ExpxMedia (raiz sem package.json)", () => {
  const r = det("monorepo-expxmedia");
  const porId = (id: string) => r.configuracoes.find((c) => c.id === id);

  it("propõe 'desktop · Rodar (dev)' como padrão (npm run dev em desktop/)", () => {
    expect(r.padrao_sugerido).toBe("desktop-dev");
    const c = porId("desktop-dev")!;
    expect(c).toMatchObject({ nome: "desktop · Rodar (dev)", cwd: "desktop", executavel: "npm", argumentos: ["run", "dev"], tipo: "rodar", origem: "detectada" });
  });

  it("também oferece npm run inicio (build + electron), testes e build do desktop", () => {
    expect(linha(porId("desktop-inicio")!)).toBe("npm run inicio");
    expect(porId("desktop-inicio")!.nome).toBe("desktop · Iniciar (build + Electron)");
    expect(linha(porId("desktop-test")!)).toBe("npm run test");
    expect(porId("desktop-build")).toMatchObject({ tipo: "build", cwd: "desktop" });
  });

  it("lista as outras partes rotuladas pela pasta, com cwd relativo", () => {
    expect(porId("central-build")).toMatchObject({ nome: "central · Build completo", cwd: "central" });
    expect(porId("central-test")).toMatchObject({ cwd: "central", tipo: "teste" });
    expect(r.configuracoes.find((c) => c.cwd === "motor" && c.id.endsWith("pytest"))).toMatchObject({ executavel: "python3", argumentos: ["-m", "pytest"] });
    expect(r.configuracoes.find((c) => c.cwd === "site")).toMatchObject({ nome: "site · Servir a pasta (site estático)", porta: 8080 });
    // nucleo/ só tem README: nada a executar
    expect(r.configuracoes.some((c) => c.cwd === "nucleo")).toBe(false);
  });

  it("o corpo do script vem do package.json DA PASTA (entra no hash de confiança)", () => {
    expect(r.corpos["desktop-dev"]).toBe("node scripts/dev.mjs");
    expect(r.corpos["desktop-inicio"]).toBe("npm run build && electron .");
    const l = leitorDeDisco(join(FIXTURES, "monorepo-expxmedia"));
    expect(corpoDaConfig(l, { ...porId("desktop-dev")! })).toBe("dev: node scripts/dev.mjs");
    // a raiz não tem package.json: sem cwd, nada
    expect(corpoDaConfig(l, { ...porId("desktop-dev")!, cwd: "." })).toBeNull();
  });

  it("pastas ordenadas pela probabilidade, com ecossistemas", () => {
    expect(r.pastas?.[0]?.pasta).toBe("desktop");
    expect(r.pastas?.map((p) => p.pasta)).toEqual(expect.arrayContaining(["desktop", "central", "motor", "site"]));
    expect(r.ecossistemas).toEqual(expect.arrayContaining(["node", "python"]));
  });

  it("tudo que sai passa pela validação estrita e tem id único", () => {
    const ids = new Set<string>();
    for (const c of r.configuracoes) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      const v = validarConfig(c, "detectada");
      expect(v.ok, `${c.id}: ${v.ok ? "" : v.erro}`).toBe(true);
    }
  });
});

describe("workspaces npm/pnpm/yarn, turbo, nx e lerna", () => {
  it("pnpm + turbo: 'rodar na raiz' (turbo run dev) e 'rodar no pacote X'; a raiz manda no padrão", () => {
    const r = det("monorepo-pnpm-turbo");
    expect(r.ferramentas).toEqual(expect.arrayContaining(["turbo", "pnpm-workspaces"]));
    expect(r.configuracoes.find((c) => c.id === "turbo-dev")).toMatchObject({ cwd: ".", executavel: "pnpm", argumentos: ["exec", "turbo", "run", "dev"] });
    expect(r.configuracoes.find((c) => c.id === "apps-web-dev")).toMatchObject({ cwd: "apps/web", executavel: "pnpm", argumentos: ["run", "dev"], porta: 5173 });
    expect(r.configuracoes.find((c) => c.id === "apps-api-dev")).toMatchObject({ cwd: "apps/api" });
    expect(r.configuracoes.find((c) => c.cwd === "packages/ui" && c.tipo === "teste")).toBeDefined();
    expect(r.padrao_sugerido).toBe("turbo-dev");
  });

  it("npm workspaces sem dev na raiz: 'npm run dev --workspaces --if-present' e cada pacote com a sua pasta", () => {
    const r = det("monorepo-npm-workspaces");
    expect(r.ferramentas).toContain("workspaces");
    const raiz = r.configuracoes.find((c) => c.id === "workspaces-dev")!;
    expect(raiz).toMatchObject({ cwd: ".", executavel: "npm", argumentos: ["run", "dev", "--workspaces", "--if-present"] });
    expect(r.configuracoes.filter((c) => c.cwd === "packages/a" || c.cwd === "packages/b").length).toBeGreaterThanOrEqual(3);
    expect(r.padrao_sugerido).toBe("workspaces-dev");
  });

  it("nx e yarn/bun escolhem o executável certo; sem pacote com dev e sem turbo/nx não inventa nada", () => {
    const nx = detectarConfiguracoes(memoria({ "package.json": JSON.stringify({ workspaces: ["apps/*"], packageManager: "yarn@4.0.0" }), "nx.json": "{}", "apps/x/package.json": JSON.stringify({ scripts: { dev: "x" } }) }));
    expect(nx.configuracoes.find((c) => c.id === "nx-dev")).toMatchObject({ executavel: "yarn", argumentos: ["nx", "run-many", "-t", "dev"] });
    const bun = detectarConfiguracoes(memoria({ "package.json": JSON.stringify({ workspaces: { packages: ["apps/*"] } }), "bun.lock": "", "apps/x/package.json": JSON.stringify({ scripts: { dev: "x" } }) }));
    expect(bun.configuracoes.find((c) => c.id === "workspaces-dev")).toMatchObject({ executavel: "bun", argumentos: ["run", "--filter", "*", "dev"] });
    const nada = detectarConfiguracoes(memoria({ "package.json": JSON.stringify({ workspaces: ["apps/*"] }), "apps/x/package.json": JSON.stringify({ scripts: { build: "x" } }) }));
    expect(nada.configuracoes.some((c) => c.id.includes("workspaces-dev") || c.id.includes("turbo"))).toBe(false);
  });

  it("globs: pnpm-workspace.yaml, negação, curinga no meio, caminho com .. e absoluto", () => {
    expect(globsDoPnpm('packages:\n  - "apps/*"\n  - \'libs/**\'\n  - "!**/test/**"\ncatalog:\n  - x\n')).toEqual(["apps/*", "libs/**", "!**/test/**"]);
    const l = memoria({ "apps/a/package.json": "{}", "apps/b/package.json": "{}", "libs/c/package.json": "{}", "x/node_modules/package.json": "{}" });
    expect(pacotesDosGlobs(l, ["apps/*", "libs/c", "!apps/b", "../fora/*", "/etc/*", "a/*/b", "x/node_modules"])).toEqual(["apps/a", "apps/b", "libs/c"]);
  });
});

describe("varredura limitada", () => {
  it("ignora node_modules, .git, dist, .venv, vendor, build e target (e pastas ocultas)", () => {
    const l = memoria({
      "node_modules/x/package.json": "{}", ".git/config": "", "dist/package.json": "{}", ".venv/pyproject.toml": "", "vendor/go.mod": "", "build/Makefile": "", "target/Cargo.toml": "", ".oculta/package.json": "{}",
      "ok/package.json": "{}",
    });
    expect(varrerPastas(l).map((p) => p.pasta)).toEqual(["ok"]);
  });

  it("profundidade ≤ 3: a/b/c entra, a/b/c/d não", () => {
    const l = memoria({ "a/b/c/package.json": "{}", "a/b/c/d/package.json": "{}" });
    expect(varrerPastas(l).map((p) => p.pasta)).toEqual(["a/b/c"]);
  });

  it("≤ 400 entradas listadas: repositório gigante não é varrido por inteiro", () => {
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 1000; i += 1) arquivos[`p${String(i).padStart(4, "0")}/package.json`] = "{}";
    const l = memoria(arquivos);
    const achadas = varrerPastas(l);
    expect(achadas.length).toBeLessThanOrEqual(400);
    expect(achadas.length).toBeGreaterThan(100);
    const r = detectarConfiguracoes(memoria(Object.fromEntries(Object.entries(arquivos).map(([k]) => [k, JSON.stringify({ scripts: { dev: "x" } })]))));
    expect(r.configuracoes.length).toBeLessThanOrEqual(40);
  });

  it("index.html sozinho só conta no 1º nível (site estático)", () => {
    const l = memoria({ "site/index.html": "", "ui/src/index.html": "" });
    expect(varrerPastas(l).map((p) => p.pasta)).toEqual(["site"]);
  });
});

describe("prioridade do padrão", () => {
  it("a raiz com script dev vence as subpastas", () => {
    const r = detectarConfiguracoes(memoria({ "package.json": JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "1" } }), "sub/package.json": JSON.stringify({ scripts: { dev: "x" } }) }));
    expect(r.padrao_sugerido).toBe("dev");
  });
  it("raiz só com build/teste: a subpasta que roda algo vence", () => {
    const r = detectarConfiguracoes(memoria({ Makefile: "build:\n\tgo build\ntest:\n\tgo test\n", "app/package.json": JSON.stringify({ scripts: { start: "node ." } }) }));
    expect(r.padrao_sugerido).toBe("app-start");
  });
  it("app Electron e pasta com mais sinais vencem pasta de exemplos", () => {
    const r = detectarConfiguracoes(memoria({
      "examples/demo/package.json": JSON.stringify({ scripts: { dev: "x", build: "x", test: "x" } }),
      "apps/painel/package.json": JSON.stringify({ scripts: { dev: "electron .", test: "x" }, devDependencies: { electron: "1" } }),
    }));
    expect(r.padrao_sugerido?.startsWith("apps-painel")).toBe(true);
  });
  it("em workspace, o gerenciador vem do lockfile da raiz", () => {
    const r = detectarConfiguracoes(memoria({ "pnpm-lock.yaml": "", "apps/web/package.json": JSON.stringify({ scripts: { dev: "vite" } }) }));
    expect(r.configuracoes.find((c) => c.cwd === "apps/web")?.executavel).toBe("pnpm");
  });
  it("executável relativo numa subpasta é ancorado na raiz (./gradlew → ./api/gradlew)", () => {
    const r = detectarConfiguracoes(memoria({ "api/build.gradle": "plugins { id 'org.springframework.boot' }", "api/gradlew": "#!/bin/sh" }));
    const c = r.configuracoes.find((x) => x.cwd === "api" && x.tipo === "rodar")!;
    expect(c.executavel).toBe("./api/gradlew");
    expect(validarConfig(c, "detectada").ok).toBe(true);
  });
  it("detecção sem monorepo continua idêntica (projeto simples não ganha 'pastas')", () => {
    const r = det("node-vite");
    expect(r.pastas).toBeUndefined();
    expect(r.padrao_sugerido).toBe("dev");
  });
});

describe("leitorEm", () => {
  it("prefixa os caminhos e trata '.' como a própria pasta", () => {
    const l = leitorEm(memoria({ "a/b.txt": "x", "a/c/d.txt": "y" }), "a");
    expect(l.ler("b.txt")).toBe("x");
    expect(l.existe("./b.txt")).toBe(true);
    expect(l.listar(".").sort()).toEqual(["b.txt", "c"]);
  });
});

describe("symlink para fora não é seguido pela varredura em disco", () => {
  const limpar: string[] = [];
  afterEach(() => { for (const d of limpar.splice(0)) rmSync(d, { recursive: true, force: true }); });
  it("pasta que aponta para fora do workspace é invisível", () => {
    const base = mkdtempSync(join(tmpdir(), "expxv-mono-"));
    limpar.push(base);
    const fora = join(base, "fora");
    const raiz = join(base, "raiz");
    mkdirSync(fora, { recursive: true });
    mkdirSync(raiz, { recursive: true });
    writeFileSync(join(fora, "package.json"), JSON.stringify({ scripts: { dev: "x" } }));
    mkdirSync(dirname(join(raiz, "real", "package.json")), { recursive: true });
    writeFileSync(join(raiz, "real", "package.json"), JSON.stringify({ scripts: { dev: "ok" } }));
    symlinkSync(fora, join(raiz, "atalho"));
    const r = detectarConfiguracoes(leitorDeDisco(raiz));
    expect(r.configuracoes.map((c) => c.cwd)).toEqual(["real", "real"].slice(0, r.configuracoes.length));
    expect(r.configuracoes.some((c) => c.cwd === "atalho")).toBe(false);
  });
});
