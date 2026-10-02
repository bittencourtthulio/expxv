// Voz local embutida no pacote (Fase 11, D-540 a D-549): o addon nativo e o worker ficam FORA do asar, o catálogo e as amostras vão por extraResources, NENHUM modelo viaja no pacote,
// o download usa só o cliente de rede e nenhuma URL/host de modelo existe fora do catálogo versionado.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { comandoInstalar, PACOTES_POR_ALVO, pacotesFaltando, VERSAO_SHERPA } from "../../scripts/lib/voz-nativos.mjs";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (c: string): string => readFileSync(join(RAIZ, c), "utf8");
const requireLocal = createRequire(join(RAIZ, "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cfg = parse(ler("electron-builder.yml")) as Record<string, any>;
const pkg = JSON.parse(ler("package.json")) as { dependencies: Record<string, string>; optionalDependencies?: Record<string, string>; scripts: Record<string, string> };

function fontes(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const c = join(dir, n);
    if (statSync(c).isDirectory()) fontes(c, acc);
    else if (/\.(ts|tsx|css|json|mjs|js)$/.test(n) && !/\.test\.tsx?$/.test(n)) acc.push(c);
  }
  return acc;
}

describe("pacote: addon e worker fora do asar", () => {
  it("o worker e o addon (sherpa-onnx-node + pacotes nativos das plataformas) estão em asarUnpack e casam os arquivos reais", () => {
    const unpack: string[] = cfg["asarUnpack"];
    expect(unpack).toContain("dist/nucleo/voz/local/worker-sherpa.js");
    expect(unpack).toContain("node_modules/sherpa-onnx-node/**/*");
    expect(unpack).toContain("node_modules/{sherpa-onnx-darwin-arm64,sherpa-onnx-darwin-x64,sherpa-onnx-win-x64}/**/*");
    const picomatch = requireLocal("picomatch") as (g: string[]) => (s: string) => boolean;
    const casa = picomatch(unpack);
    for (const f of [
      "dist/nucleo/voz/local/worker-sherpa.js", "node_modules/sherpa-onnx-node/addon.js", "node_modules/sherpa-onnx-node/sherpa-onnx.js",
      "node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node", "node_modules/sherpa-onnx-darwin-arm64/libonnxruntime.dylib", "node_modules/sherpa-onnx-darwin-x64/sherpa-onnx.node", "node_modules/sherpa-onnx-win-x64/sherpa-onnx.node",
      "node_modules/sherpa-onnx-win-x64/onnxruntime.dll",
    ]) expect(casa(f), f).toBe(true);
  });

  it("o worker compilado existe a partir do fonte e é AUTOCONTIDO: só módulos do Node e o addon, sem import relativo em tempo de execução", () => {
    const fonte = ler("src/nucleo/voz/local/worker-sherpa.ts");
    for (const linha of fonte.split("\n")) {
      if (/^\s*import\b/.test(linha)) expect(linha, linha).toMatch(/^import type\b/); // só tipos (apagados no build)
    }
    expect(fonte).not.toMatch(/require\("\.{1,2}\//);
    expect(fonte).toMatch(/require\("sherpa-onnx-node"\)/);
    expect(fonte).not.toMatch(/node:(https?|net|dns|dgram|fs)|fetch\(|child_process/); // nada de rede, disco nem processo
  });

  it("mac universal: o addon das duas arquiteturas viaja nos dois .app e fica de fora do que o @electron/universal funde", () => {
    expect(cfg["mac"]["x64ArchFiles"]).toContain("sherpa-onnx-darwin-arm64");
    expect(cfg["mac"]["x64ArchFiles"]).toContain("sherpa-onnx-darwin-x64");
    expect(cfg["mac"]["x64ArchFiles"]).toContain("node-pty/{bin,prebuilds}"); // o que já existia continua
    expect(cfg["mac"]["mergeASARs"]).toBe(false);
  });
});

describe("pacote: catálogo e amostras entram, modelo NUNCA", () => {
  it("extraResources leva só modelos.json e as amostras WAV; nenhum .onnx", () => {
    const item = (cfg["extraResources"] as Array<{ from: string; to: string; filter: string[] }>).find((e) => e.from === "resources/voz");
    expect(item).toBeDefined();
    expect(item?.to).toBe("voz");
    expect(item?.filter).toEqual(["modelos.json", "amostra-*.wav"]);
    expect(readdirSync(join(RAIZ, "resources/voz")).sort()).toEqual(["amostra-en.wav", "amostra-pt.wav", "modelos.json"]);
    const total = readdirSync(join(RAIZ, "resources/voz")).reduce((s, n) => s + statSync(join(RAIZ, "resources/voz", n)).size, 0);
    expect(total).toBeLessThan(300 * 1024); // o pacote cresce ~0,3 MB com catálogo e amostras (P-546)
    expect(JSON.stringify(cfg)).not.toMatch(/\.onnx/);
  });

  it("nenhum arquivo de modelo (onnx, bin grande) versionado no repositório", () => {
    const achados = fontes(join(RAIZ, "resources")).filter((f) => /\.(onnx|gguf|ggml|safetensors)$/.test(f));
    expect(achados).toEqual([]);
  });
});

describe("dependência nova (D-540): versão exata e registro", () => {
  it("sherpa-onnx-node na versão EXATA do módulo de preparo e os pacotes nativos como opcionais exatos", () => {
    expect(pkg.dependencies["sherpa-onnx-node"]).toBe(VERSAO_SHERPA);
    for (const p of ["sherpa-onnx-darwin-arm64", "sherpa-onnx-darwin-x64", "sherpa-onnx-win-x64"]) expect(pkg.optionalDependencies?.[p], p).toBe(VERSAO_SHERPA);
    const base = JSON.parse(ler("scripts/lib/dependencias-registradas.json")) as { dependencias: string[] };
    expect(base.dependencias).toEqual(expect.arrayContaining(["sherpa-onnx-node", "sherpa-onnx-darwin-arm64", "sherpa-onnx-darwin-x64", "sherpa-onnx-win-x64"]));
    expect(ler("docs/ade/01-DECISOES.md")).toContain("sherpa-onnx-node");
  });

  it("dist:mac e dist:win preparam os pacotes nativos do alvo antes do build; o npm install normal não instala nada extra", () => {
    expect(pkg.scripts["dist:mac"]).toMatch(/^npm run preparar:voz -- mac && npm run build/);
    expect(pkg.scripts["dist:win"]).toMatch(/^npm run preparar:voz -- win && npm run build/);
    expect(pkg.scripts["postinstall"]).not.toMatch(/sherpa|voz/);
  });

  it("preparo: acha o que falta por alvo e monta comando sem script de pacote, sem salvar e com versão exata", () => {
    expect(PACOTES_POR_ALVO.mac).toEqual(["sherpa-onnx-darwin-arm64", "sherpa-onnx-darwin-x64"]);
    expect(pacotesFaltando("mac", "/x", () => false)).toEqual(["sherpa-onnx-darwin-arm64", "sherpa-onnx-darwin-x64"]);
    expect(pacotesFaltando("mac", "/x", (c) => c.includes("darwin-arm64"))).toEqual(["sherpa-onnx-darwin-x64"]);
    expect(pacotesFaltando("win", "/x", () => true)).toEqual([]);
    expect(pacotesFaltando("local", "/x", () => false)).toEqual([]);
    expect(() => pacotesFaltando("linux", "/x")).toThrow(/alvo desconhecido/);
    const c = comandoInstalar(["sherpa-onnx-win-x64"]);
    expect(c?.cmd).toBe("npm");
    expect(c?.args).toEqual(expect.arrayContaining(["--no-save", "--ignore-scripts", `sherpa-onnx-win-x64@${VERSAO_SHERPA}`]));
    expect(comandoInstalar([])).toBeNull();
  });

  it("o pacote do addon desta máquina está instalado e a versão confere com a do package.json", () => {
    const base = JSON.parse(readFileSync(requireLocal.resolve("sherpa-onnx-node/package.json"), "utf8")) as { version: string; license: string };
    expect(base.version).toBe(VERSAO_SHERPA);
    expect(base.license).toBe("Apache-2.0");
  });
});

describe("fronteira de rede e de marca da voz local", () => {
  const src = fontes(join(RAIZ, "src"));

  it("nenhum host ou URL de modelo existe no código de voz: tudo vem do catálogo versionado", () => {
    const proibidos = src.filter((f) => /[\\/](voz|captura-boot)|voz-modelos|local-embutido/.test(f) && /huggingface|hf\.co|github\.com\/k2-fsa|sherpa-onnx\/releases/.test(readFileSync(f, "utf8"))).map((f) => relative(RAIZ, f));
    expect(proibidos).toEqual([]);
  });

  it("o download, o runtime e os serviços de voz local NÃO abrem socket: nada de http/https/net/fetch fora de nucleo/rede", () => {
    const rede = /\b(fetch\(|https?\.(get|request)\(|net\.request|new WebSocket|XMLHttpRequest)|from "node:(https?|dns|dgram|net|tls)"/;
    const alvos = ["src/nucleo/voz/local/download.ts", "src/nucleo/voz/local/runtime.ts", "src/nucleo/voz/local/integridade.ts", "src/nucleo/voz/local/catalogo.ts", "src/nucleo/voz/local/worker-sherpa.ts", "src/main/voz-modelos.ts", "src/main/voz-modelos-boot.ts", "src/nucleo/voz/motores/local-embutido.ts"];
    for (const a of alvos) {
      expect(existsSync(join(RAIZ, a)), a).toBe(true);
      const texto = ler(a);
      const sem = a.endsWith("catalogo.ts") ? texto.replace('import { isIP } from "node:net";', "") : texto; // `isIP` só valida texto (não abre conexão)
      expect(rede.test(sem), a).toBe(false);
    }
    expect(ler("src/nucleo/voz/local/download.ts")).toMatch(/from "\.\.\/\.\.\/rede"/); // o downloader é cliente do módulo único de rede
  });

  it("o renderer da voz local não tem rede nem caminho: só window.ade", () => {
    for (const a of ["src/renderer/telas/config/VozLocal.tsx", "src/renderer/voz/modelos.ts"]) expect(ler(a), a).not.toMatch(/\bfetch\(|XMLHttpRequest|require\(|node:/);
  });

  it("a fala transcrita e o áudio não vão a log nem a erro na voz local", () => {
    for (const a of ["src/main/voz-modelos.ts", "src/nucleo/voz/local/runtime.ts", "src/nucleo/voz/local/download.ts"]) expect(ler(a), a).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
});
