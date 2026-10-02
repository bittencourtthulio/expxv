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
    // o worker do mapa (Fase 17) só entra no fecho depois de compilado
    for (const entrada of ["daemon/main-daemon.js", "main/mcp-worker.js", "nucleo/metodo/worker.js", "nucleo/mapa/worker-extracao.js", "nucleo/catalogo/worker.js", "main/conhecimento-worker.js"].filter((e) => existsSync(join(dist, e)))) andar(join(dist, entrada));
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

describe("tabela de equivalência do harness no pacote (Fase 9, T-09.11)", () => {
  const cfg = yaml("electron-builder.yml");

  it("`resources/harness/equivalencia.json` vai como extraResources (fora do asar) e existe em disco; `extraResources` aparece uma única vez", () => {
    const extras: Array<{ from: string; to: string; filter?: string[] }> = cfg.extraResources;
    const harness = extras.find((e) => e.from === "resources/harness");
    expect(harness).toBeDefined();
    expect(harness?.to).toBe("harness");
    expect(harness?.filter).toEqual(["equivalencia.json"]);
    expect(existsSync(join(RAIZ, "resources", "harness", "equivalencia.json"))).toBe(true);
    expect(ler("electron-builder.yml").match(/^extraResources:/gm)).toHaveLength(1);
  });

  it("o JSON versionado é uma tabela válida (o harness carrega este arquivo no boot)", async () => {
    const { carregarEquivalenciaPadrao } = await import("../../src/nucleo/harness/equivalencia");
    const r = carregarEquivalenciaPadrao(ler("resources/harness/equivalencia.json"));
    expect(r.origem).toBe("arquivo");
    expect(r.avisos).toEqual([]);
  });

  it("o fecho do worker do MCP continua dentro do asarUnpack (tools do harness não puxam compartilhado/harness)", () => {
    const worker = readFileSync(join(RAIZ, "src", "nucleo", "mcp", "tools", "harness.ts"), "utf8") + readFileSync(join(RAIZ, "src", "nucleo", "mcp", "tools", "limites.ts"), "utf8");
    // só `import type` vindo de compartilhado/ (apagado na compilação); nenhum import de valor fora de mcp/
    const imports = [...worker.matchAll(/^import (type )?[^;]*? from "([^"]+)";/gm)].filter((m) => m[1] === undefined).map((m) => m[2] as string);
    expect(imports.filter((i) => i.startsWith("../../../"))).toEqual([]);
  });
});

describe("mapa lógico do código no pacote (Fase 17, T-17.02)", () => {
  const cfg = yaml("electron-builder.yml");

  it("worker de extração, gramáticas WASM e web-tree-sitter ficam FORA do asar (worker_threads e Language.load leem por caminho real)", () => {
    const unpack: string[] = cfg.asarUnpack;
    expect(unpack).toContain("dist/nucleo/mapa/**/*"); // worker-extracao.js, extratores e gramaticas/*.wasm
    expect(unpack).toContain("node_modules/web-tree-sitter/**/*");
    const picomatch = requireLocal("picomatch") as (g: string[]) => (s: string) => boolean;
    const casa = picomatch(unpack.filter((g) => g.startsWith("dist/")));
    for (const f of ["dist/nucleo/mapa/worker-extracao.js", "dist/nucleo/mapa/extratores/typescript.js", "dist/nucleo/mapa/gramaticas/tree-sitter-typescript.wasm"]) expect(casa(f), f).toBe(true);
  });

  it("do web-tree-sitter só vai o necessário (sem a versão de depuração nem a cópia ESM); @vscode/tree-sitter-wasm é só de build", () => {
    const f: string[] = cfg.files;
    expect(f).toContain("!node_modules/web-tree-sitter/debug/**/*");
    expect(f).toContain("!node_modules/web-tree-sitter/web-tree-sitter.js");
    const pkg = JSON.parse(ler("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies["web-tree-sitter"]).toBe("0.27.0");
    expect(pkg.devDependencies["@vscode/tree-sitter-wasm"]).toBe("0.3.1");
  });

  it("scripts/lib/ativos.mjs copia exatamente as gramáticas embarcadas para dist/nucleo/mapa/gramaticas", async () => {
    const { ATIVOS } = (await import("../../scripts/lib/ativos.mjs")) as { ATIVOS: Array<{ de: string; para: string; nomes?: string[] }> };
    const { GRAMATICAS_EMBARCADAS, arquivoWasm } = await import("../../src/nucleo/mapa/linguagens");
    const a = ATIVOS.find((x) => x.para === "dist/nucleo/mapa/gramaticas");
    expect(a).toBeDefined();
    expect([...(a?.nomes ?? [])].sort()).toEqual(GRAMATICAS_EMBARCADAS.map(arquivoWasm).sort());
    for (const n of a?.nomes ?? []) expect(existsSync(join(RAIZ, a!.de, n)), n).toBe(true);
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

  // Fase 21 (T-21.20, D-340): a regra deixa de ser "ninguém importa" e passa a ser de FRONTEIRA. O `electron-updater` só pode ser referenciado por UM arquivo
  // (`backends/electron-updater.ts`), só por `import()` dinâmico, nunca por import estático, e `autoUpdater` não existe fora dele. O pacote padrão segue SEM a
  // dependência (teste abaixo) e o perfil `com-atualizacao` é o único que a inclui (config-builder.test.ts).
  const BACKEND_UPDATER = "src/nucleo/atualizador/backends/electron-updater.ts";
  const TIPOS_UPDATER = "src/nucleo/atualizador/tipos-externos.d.ts"; // declaração ambiente opaca (o pacote não está instalado)
  const rel = (f: string): string => relative(RAIZ, f).split("\\").join("/");
  const fontesComDeclaracoes = fontes; // inclui os .d.ts

  it("electron-updater: nenhum import estático em src/; import() dinâmico e `autoUpdater` só no backend isolado; sem src/main/atualizacao.ts não há fio de boot", () => {
    expect(existsSync(join(RAIZ, "src", "main", "atualizacao.ts"))).toBe(false); // o fio fino (W3) só nasce junto da UI e do consentimento
    const estatico = /\b(?:from\s+["']electron-updater["']|require\(\s*["']electron-updater["']\s*\)|import\s+["']electron-updater["'])/;
    const dinamico = /\bimport\(\s*["']electron-updater["']\s*\)/;
    const declaracao = /declare\s+module\s+["']electron-updater["']/;
    const usaEstatico = fontesComDeclaracoes.filter((f) => estatico.test(readFileSync(f, "utf8"))).map(rel);
    expect(usaEstatico).toEqual([]);
    const usaDinamico = fontes.filter((f) => dinamico.test(readFileSync(f, "utf8"))).map(rel);
    expect(usaDinamico).toEqual([BACKEND_UPDATER]);
    const usaAutoUpdater = fontes.filter((f) => /\bautoUpdater\b/.test(readFileSync(f, "utf8"))).map(rel);
    expect(usaAutoUpdater).toEqual([BACKEND_UPDATER]);
    const declara = fontesComDeclaracoes.filter((f) => declaracao.test(readFileSync(f, "utf8"))).map(rel);
    expect(declara).toEqual([TIPOS_UPDATER]);
  });

  it("a atualização nasce desligada no build (duas chaves) e o repositório de releases segue como placeholder enquanto o dono não decide (P-331)", () => {
    const dist = JSON.parse(ler("build/distribuicao.json")) as { atualizacao: { habilitada: boolean; chaves_aceitas: string[]; feed: { host: string } } };
    expect(dist.atualizacao.habilitada).toBe(false);
    expect(dist.atualizacao.chaves_aceitas).toEqual([]);
    expect(dist.atualizacao.feed.host).toMatch(/\.invalid$/);
    const pkg = JSON.parse(ler("package.json")) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
    expect(pkg.dependencies?.["electron-updater"]).toBeUndefined(); // dependência só entra com D-NN e custo medido (T-21.16)
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
      "src/nucleo/rede/cliente-http.ts", // Fase 9 (T-09.23): o ÚNICO módulo de saída de rede; exige consentimento por host antes de abrir socket
      "src/nucleo/remoto-estendido/ws-cliente.ts", // Fase 22 (D-366): o ÚNICO `new WebSocket` do app (saída para o relay do dono; só wss://, só ligado com consentimento); provado por tests/scripts/relay-fronteira.test.ts
      "src/nucleo/remoto/servidor.ts", // Fase 13 (D-NN): o ÚNICO módulo que ESCUTA (controle remoto, opt-in); só `createServer`, nunca cliente: provado por tests/scripts/servidor-remoto-fronteira.test.ts
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
