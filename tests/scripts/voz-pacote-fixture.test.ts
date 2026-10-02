// A fixture `scripts/fixtures/pacote-voz.cjs` (roda DENTRO do app empacotado em `npm run test:pacote`) provada aqui contra uma árvore que imita Resources/: worker transpilado, `node_modules` real
// (o addon desta máquina) e `voz/` do repositório. Sem pacote nem Electron: o executável é o Node.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
let tmp = "";
afterEach(() => { if (tmp !== "") rmSync(tmp, { recursive: true, force: true }); tmp = ""; });

function montar(opcoes: { semAddon?: boolean; extra?: string } = {}): string {
  tmp = mkdtempSync(join(tmpdir(), "voz-pacote-"));
  const fora = join(tmp, "app.asar.unpacked");
  mkdirSync(join(fora, "dist", "nucleo", "voz", "local"), { recursive: true });
  const js = ts.transpileModule(readFileSync(join(RAIZ, "src/nucleo/voz/local/worker-sherpa.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(fora, "dist", "nucleo", "voz", "local", "worker-sherpa.js"), js);
  if (opcoes.semAddon === true) {
    mkdirSync(join(fora, "node_modules", "sherpa-onnx-node"), { recursive: true });
    writeFileSync(join(fora, "node_modules", "sherpa-onnx-node", "addon.js"), "");
    writeFileSync(join(fora, "node_modules", "sherpa-onnx-node", "index.js"), "throw new Error('sem addon')");
    const so = process.platform === "win32" ? "win" : process.platform;
    mkdirSync(join(fora, "node_modules", `sherpa-onnx-${so}-${process.arch}`), { recursive: true });
    writeFileSync(join(fora, "node_modules", `sherpa-onnx-${so}-${process.arch}`, "sherpa-onnx.node"), "");
  } else {
    symlinkSync(join(RAIZ, "node_modules"), join(fora, "node_modules"));
  }
  mkdirSync(join(tmp, "voz"));
  for (const n of ["modelos.json", "amostra-pt.wav", "amostra-en.wav"]) copyFileSync(join(RAIZ, "resources", "voz", n), join(tmp, "voz", n));
  if (opcoes.extra !== undefined) writeFileSync(join(tmp, "voz", opcoes.extra), "x");
  return tmp;
}
const rodar = (recursos: string) => spawnSync(process.execPath, [join(RAIZ, "scripts/fixtures/pacote-voz.cjs"), recursos], { encoding: "utf8", timeout: 40_000 });

describe("fixture de voz do test:pacote", () => {
  it("árvore correta: o addon carrega e o worker responde modelo_corrompido a uma configuração sem modelo", () => {
    const r = rodar(montar());
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toMatch(/addon carrega/);
  }, 60_000);

  it("modelo (.onnx) esquecido em Resources/voz reprova o pacote", () => {
    const r = rodar(montar({ extra: "model.int8.onnx" }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/arquivos inesperados/);
  }, 60_000);

  it("addon que não carrega (runtime_indisponivel) reprova o pacote", () => {
    const r = rodar(montar({ semAddon: true }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NÃO carregou/);
  }, 60_000);

  it("recurso ausente reprova o pacote", () => {
    const recursos = montar();
    rmSync(join(recursos, "voz", "amostra-pt.wav"));
    const r = rodar(recursos);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ausente no pacote/);
  }, 60_000);
});
