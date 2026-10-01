// Contratos do empacotamento e do CI (T-05.06): electron-builder.yml (mac e Windows, sem máquina Windows: D-26),
// workflows versionados e NÃO disparados (D-23), Node 22 (D-27) e auto-update desligado (D-24).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PRODUTO } from "../../src/nucleo/produto";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (c: string): string => readFileSync(join(RAIZ, c), "utf8");
const yaml = <T = Record<string, any>>(c: string): T => parse(ler(c)) as T;
const requireLocal = createRequire(join(RAIZ, "package.json"));

function arquivosDe(pasta: string, exts: string[]): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const c = join(pasta, nome);
    if (statSync(c).isDirectory()) saida.push(...arquivosDe(c, exts));
    else if (exts.some((e) => nome.endsWith(e)) && !/\.test\.tsx?$/.test(nome)) saida.push(c);
  }
  return saida;
}

describe("electron-builder.yml", () => {
  const cfg = yaml("electron-builder.yml");

  it("identidade vem do produto e a saída é dist-app/ (dist/ é do dev em segundo plano)", () => {
    expect(cfg.appId).toBe(PRODUTO.appId);
    expect(cfg.productName).toBe(PRODUTO.nome);
    expect(cfg.directories.output).toBe("dist-app");
    expect(cfg.npmRebuild).toBe(false);
    expect(cfg.afterPack).toBe("scripts/depois-empacotar.cjs");
    expect(cfg.beforePack).toBe("scripts/antes-empacotar.cjs");
    for (const gancho of [cfg.afterPack, cfg.beforePack]) expect(existsSync(join(RAIZ, gancho))).toBe(true);
  });

  it("mac: dmg e zip universais, sem assinatura por padrão, ícone existente", () => {
    const alvos = cfg.mac.target.map((t: { target: string; arch: string[] }) => `${t.target}:${t.arch.join()}`);
    expect(alvos).toEqual(["dmg:universal", "zip:universal"]);
    expect(existsSync(join(RAIZ, cfg.mac.icon))).toBe(true);
    expect(cfg.mac.artifactName).toBe(`${PRODUTO.nome}-universal.\${ext}`);
    expect(cfg.mac.x64ArchFiles).toContain("node-pty");
    // sem isto o @electron/universal estoura o glob de 65 536 caracteres ao fundir os asars (muitos arquivos em asarUnpack)
    expect(cfg.mac.mergeASARs).toBe(false);
    expect(JSON.stringify(cfg)).not.toMatch(/identity|notariz|CSC_|APPLE_/i); // nada de credencial na configuração
  });

  it("Windows (validado só por configuração, D-26): nsis x64, ícone .ico, instalador nomeado, sem oneClick", () => {
    expect(cfg.win.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
    expect(existsSync(join(RAIZ, cfg.win.icon))).toBe(true);
    expect(cfg.win.icon.endsWith(".ico")).toBe(true);
    expect(cfg.nsis.artifactName).toBe(`${PRODUTO.nome}-Setup.\${ext}`);
    expect(cfg.nsis.oneClick).toBe(false);
    expect(cfg.nsis.perMachine).toBe(false);
  });

  it("arquivos listados existem e o ícone da bandeja entra no pacote (o main lê build/icone-32.png)", () => {
    expect(cfg.files).toContain("build/icone-32.png");
    expect(existsSync(join(RAIZ, "build", "icone-32.png"))).toBe(true);
    expect(cfg.files).toContain("!**/*.test.*");
    expect(cfg.files).toContain("!**/*.map");
  });

  it("peso morto fica fora: typings, mapas, testes e docs de node_modules; fontes do node-pty", () => {
    const f: string[] = cfg.files;
    expect(f.some((p) => p.startsWith("!node_modules/**/{") && p.includes("README*") && p.includes("*.ts") && p.includes("test") && p.includes("docs"))).toBe(true);
    expect(f.some((p) => p.startsWith("!node_modules/node-pty/{src,deps"))).toBe(true);
    expect(f).toContain("!node_modules/node-addon-api/**/*");
  });

  it("o hook afterPack separa os prebuilds do node-pty por plataforma", () => {
    const { prefixoDaPlataforma } = requireLocal(join(RAIZ, "scripts", "depois-empacotar.cjs")) as { prefixoDaPlataforma: (p: string) => string | null };
    expect(prefixoDaPlataforma("darwin")).toBe("darwin-");
    expect(prefixoDaPlataforma("windows")).toBe("win32-");
    expect(prefixoDaPlataforma("linux")).toBeNull();
  });

  it("asarUnpack cobre o fecho de require dos scripts que rodam FORA do asar (daemon, worker MCP, worker do método)", () => {
    const dist = join(RAIZ, "dist");
    if (!existsSync(join(dist, "daemon", "main-daemon.js"))) return; // sem build: o test:pacote cobre
    const picomatch = requireLocal("picomatch") as (g: string[]) => (s: string) => boolean;
    const casa = picomatch((cfg.asarUnpack as string[]).filter((g) => g.startsWith("dist/")));
    const dependenciasExternas = new Set<string>();
    const visto = new Set<string>();
    const resolver = (de: string, rel: string): string | null => {
      const base = resolve(dirname(de), rel);
      for (const c of [base, `${base}.js`, join(base, "index.js")]) if (existsSync(c) && statSync(c).isFile()) return c;
      return null;
    };
    const andar = (arq: string): void => {
      if (visto.has(arq)) return;
      visto.add(arq);
      for (const m of readFileSync(arq, "utf8").matchAll(/require\("([^"]+)"\)/g)) {
        const alvo = m[1] as string;
        if (alvo.startsWith(".")) { const r = resolver(arq, alvo); if (r !== null) andar(r); } else if (!alvo.startsWith("node:") && !/^[a-z_]+$/.test(alvo)) dependenciasExternas.add(alvo);
      }
    };
    for (const entrada of ["daemon/main-daemon.js", "main/mcp-worker.js", "nucleo/metodo/worker.js"]) andar(join(dist, entrada));
    const faltando = [...visto].map((a) => relative(RAIZ, a).split("\\").join("/")).filter((a) => !casa(a));
    expect(faltando).toEqual([]);
    // dependências de runtime desses scripts: precisam estar em asarUnpack (node_modules desempacotado)
    const unpack = (cfg.asarUnpack as string[]).join("\n");
    for (const dep of dependenciasExternas) {
      const nome = dep.startsWith("@") ? dep.split("/").slice(0, 2).join("/") : (dep.split("/")[0] as string);
      expect(unpack, `dependência ${nome} fora do asarUnpack`).toContain(nome);
    }
  });
});

describe("workflows versionados (nada é disparado: D-23)", () => {
  const validacao = yaml(".github/workflows/validacao.yml");
  const release = yaml(".github/workflows/release.yml");
  const passos = (j: any): string[] => (j.steps as any[]).map((s) => String(s.run ?? s.uses ?? ""));

  it("os dois arquivos são YAML válido e só há esses dois", () => {
    expect(readdirSync(join(RAIZ, ".github", "workflows")).sort()).toEqual(["release.yml", "validacao.yml"]);
    expect(validacao.jobs.validar).toBeDefined();
    expect(release.jobs.empacotar).toBeDefined();
  });

  it("validação: Node 22, npm ci --legacy-peer-deps, matriz mac arm/intel + Windows, typecheck/test/build/pacote", () => {
    const j = validacao.jobs.validar;
    expect(j.strategy.matrix.os).toEqual(["macos-15", "macos-15-intel", "windows-latest"]);
    expect(j.strategy["fail-fast"]).toBe(false);
    const node = (j.steps as any[]).find((s) => String(s.uses).startsWith("actions/setup-node"));
    expect(String(node.with["node-version"])).toBe("22");
    const comandos = passos(j).join("\n");
    expect(comandos).toContain("npm ci --legacy-peer-deps");
    for (const c of ["npm run typecheck", "npm test", "npm run build", "npm run dist:dir", "npm run test:pacote"]) expect(comandos).toContain(c);
    expect(Object.keys(validacao.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
  });

  it("release: só por tag v*, Node 22, sem publicar pelo builder, assinatura opcional por secrets", () => {
    expect(release.on).toEqual({ push: { tags: ["v*"] } });
    const j = release.jobs.empacotar;
    const sistemas = j.strategy.matrix.include.map((i: { os: string; script: string }) => `${i.os}:${i.script}`);
    expect(sistemas).toEqual(["macos-15:dist:mac", "windows-latest:dist:win"]);
    const node = (j.steps as any[]).find((s) => String(s.uses).startsWith("actions/setup-node"));
    expect(String(node.with["node-version"])).toBe("22");
    expect(passos(j).join("\n")).toContain("npm ci --legacy-peer-deps");
    // o build do instalador não publica: a publicação é um job separado, em rascunho
    const pkg = JSON.parse(ler("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["dist:mac"]).toContain("--publish never");
    expect(pkg.scripts["dist:win"]).toContain("--publish never");
    expect(release.jobs.publicar.needs).toBe("empacotar");
    const upload = release.jobs.publicar.steps.find((s: any) => String(s.uses).startsWith("softprops/action-gh-release"));
    expect(upload.with.draft).toBe(true);
    // segredos só por `secrets.*` (nunca literais) e todos opcionais
    const env = j.env as Record<string, string>;
    for (const chave of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) expect(env[chave]).toMatch(/^\$\{\{ secrets\./);
    expect(env.CSC_IDENTITY_AUTO_DISCOVERY).toContain("secrets.CSC_LINK != ''");
  });

  it("nenhum workflow tem segredo literal", () => {
    for (const c of [".github/workflows/validacao.yml", ".github/workflows/release.yml"]) {
      expect(ler(c)).not.toMatch(/(ghp_|github_pat_|-----BEGIN|AKIA[0-9A-Z]{8})/);
    }
  });

  it("engines e CI concordam: Node 22 (D-27)", () => {
    const pkg = JSON.parse(ler("package.json")) as { engines: { node: string } };
    expect(pkg.engines.node).toBe(">=22");
  });
});

describe("auto-update desligado (D-24)", () => {
  const fontes = arquivosDe(join(RAIZ, "src"), [".ts", ".tsx"]);

  it("nada em src/ usa electron-updater/autoUpdater; sem src/main/atualizacao.ts não há como consultar versão na rede", () => {
    expect(existsSync(join(RAIZ, "src", "main", "atualizacao.ts"))).toBe(false);
    const usam = fontes.filter((f) => /electron-updater|autoUpdater/.test(readFileSync(f, "utf8")));
    expect(usam.map((f) => relative(RAIZ, f))).toEqual([]);
  });

  it("enquanto ninguém importa o electron-updater, ele (e o que só ele puxa) fica fora do pacote", () => {
    const cfg = yaml("electron-builder.yml");
    expect((cfg.files as string[]).some((p) => p.startsWith("!node_modules/{electron-updater,"))).toBe(true);
  });

  it("chamadas de rede em src/ só nos módulos conhecidos e todos de loopback/arquivo local", () => {
    const rede = /\b(fetch\(|https?\.(get|request)\(|net\.request|new WebSocket|XMLHttpRequest)|from "node:(https|dns|dgram)"/;
    const encontrados = fontes.filter((f) => rede.test(readFileSync(f, "utf8"))).map((f) => relative(RAIZ, f).split("\\").join("/")).sort();
    expect(encontrados).toEqual([
      "src/main/main.ts", // net.fetch(file://…): serve o renderer do scheme próprio
      "src/nucleo/terminais/atividade/adaptadores/opencode.ts", // plugin que avisa o servidor de atividade em 127.0.0.1
    ]);
  });

  it("package.json não configura publicação nem atualizador próprio; o publish do builder é placeholder (--publish never)", () => {
    const pkg = ler("package.json");
    expect(pkg).not.toMatch(/"(autoUpdate|updateUrl)"/);
    const cfg = yaml("electron-builder.yml");
    expect(cfg.publish).toEqual({ provider: "github", owner: PRODUTO.repositorioReleases.dono, repo: PRODUTO.repositorioReleases.repo });
  });
});
