import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../../../tests/fixtures/mapa/compilar";

// T-17.02/05: prova DENTRO do Electron real (ELECTRON_RUN_AS_NODE=1) — as 11 gramáticas carregam no runtime
// web-tree-sitter 0.27.0, o extrator parseia TypeScript e o pool de worker_threads extrai numa thread fora do main.

const RAIZ = resolve(__dirname, "../../..");

function caminhoElectron(): string | null {
  try {
    // o pacote `electron` exporta o caminho do executável (não o executa)
    const c = (require("electron") as unknown) as string;
    return typeof c === "string" && existsSync(c) ? c : null;
  } catch {
    return null;
  }
}

describe("mapa no Electron real", () => {
  const exe = caminhoElectron();
  it.skipIf(exe === null)("gramáticas, extrator e pool de workers funcionam no Electron (ELECTRON_RUN_AS_NODE)", async () => {
    const dist = compilarMapaParaTeste();
    const saida = await new Promise<string>((ok, falha) => {
      execFile(
        exe as string,
        [join(RAIZ, "tests", "mapa-electron.cjs"), dist, join(RAIZ, "tests", "fixtures", "mapa", "typescript")],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
        (erro, stdout, stderr) => (erro ? falha(new Error(`${erro.message}\n${stderr}`)) : ok(stdout)),
      );
    });
    const r = JSON.parse(saida.trim().split("\n").pop() as string) as { ok: boolean; electron: string; node: string; load_ms: Record<string, number>; pool_ms: number };
    console.log(`Electron ${r.electron} (Node ${r.node}): pool ${r.pool_ms} ms; load por gramática: ${JSON.stringify(r.load_ms)}`);
    expect(r.ok).toBe(true);
    expect(r.electron).toBe("37.10.3");
    expect(Object.keys(r.load_ms)).toHaveLength(11);
  }, 120_000);
});
