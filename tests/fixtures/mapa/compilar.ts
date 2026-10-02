import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

// Compila (sem checar tipos) o fecho de imports dos módulos do mapa para CommonJS numa pasta DENTRO de
// `node_modules/.cache/` (assim `require("web-tree-sitter")` resolve subindo até o node_modules do repositório).
// Serve aos testes que precisam de um `.js` real: workers (`new Worker(arquivo)`) e o teste no Electron real.
// Não toca em `dist/` (o `npm run dev` do dono usa essa pasta).

const RAIZ = resolve(__dirname, "../../..");
const SRC = join(RAIZ, "src");
const CACHE = join(RAIZ, "node_modules", ".cache", "mapa-teste");

const IMPORTS = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

function resolverFonte(de: string, rel: string): string | null {
  const base = resolve(dirname(de), rel);
  for (const c of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function fecho(entradas: readonly string[]): string[] {
  const vistos = new Set<string>();
  const pilha = entradas.map((e) => join(SRC, e));
  while (pilha.length > 0) {
    const arq = pilha.pop() as string;
    if (vistos.has(arq)) continue;
    vistos.add(arq);
    for (const m of readFileSync(arq, "utf8").matchAll(IMPORTS)) {
      const alvo = resolverFonte(arq, m[1] as string);
      if (alvo !== null) pilha.push(alvo);
    }
  }
  return [...vistos].sort();
}

/** Devolve a pasta com o JS compilado (espelha `src/`: `<pasta>/nucleo/mapa/worker-extracao.js`). Reutiliza se nada mudou. */
export function compilarMapaParaTeste(entradas: readonly string[] = ["nucleo/mapa/index.ts", "nucleo/mapa/worker-extracao.ts", "nucleo/mapa/pool.ts"]): string {
  const arquivos = fecho(entradas);
  const h = createHash("sha1");
  for (const a of arquivos) {
    const s = statSync(a);
    h.update(`${a}:${s.size}:${Math.trunc(s.mtimeMs)}\n`);
  }
  const destino = join(CACHE, h.digest("hex").slice(0, 16));
  if (existsSync(join(destino, ".pronto"))) return destino;
  const tmp = `${destino}.tmp-${process.pid}-${Date.now()}`;
  for (const arq of arquivos) {
    const saida = join(tmp, relative(SRC, arq)).replace(/\.ts$/, ".js");
    mkdirSync(dirname(saida), { recursive: true });
    const r = ts.transpileModule(readFileSync(arq, "utf8"), {
      fileName: arq,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, sourceMap: false },
    });
    writeFileSync(saida, r.outputText);
  }
  writeFileSync(join(tmp, ".pronto"), "ok");
  try {
    renameSync(tmp, destino);
  } catch {
    rmSync(tmp, { recursive: true, force: true }); // outro processo de teste chegou primeiro
  }
  if (existsSync(CACHE)) {
    for (const nome of readdirSync(CACHE)) {
      const caminho = join(CACHE, nome);
      if (caminho !== destino && !nome.includes(".tmp-")) rmSync(caminho, { recursive: true, force: true });
    }
  }
  return destino;
}
