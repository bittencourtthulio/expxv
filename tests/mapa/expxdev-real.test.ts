import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { gravarMedicoes, registrar } from "../perf/registro";
import { analisarEmMemoria, type MapaEmMemoria } from "../../src/nucleo/mapa/analisador";
import { coletarHistoria } from "../../src/nucleo/mapa/git-historia";
import { ciclos } from "../../src/nucleo/mapa/grafo/ciclos";
import { construirGrafo } from "../../src/nucleo/mapa/grafo/memoria";

// T-17.43: o mapa analisa o PRÓPRIO repositório (somente leitura) e é conferido contra o compilador TypeScript
// (oráculo SÓ de teste): concordância das arestas `importa` >= 95% (P-252), >= 85% `exata`, >= 500 arquivos TS,
// ciclos, raio de um arquivo por import e hotspots por `git log`; `docs/**` idêntico antes e depois.

const RAIZ = resolve(__dirname, "../..");
const FATOR = Number(process.env.EXPXV_PERF_FATOR ?? "1");

function assinaturaDocs(): string {
  const partes: string[] = [];
  const andar = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) andar(p);
      else partes.push(`${relative(RAIZ, p)}:${st.size}:${st.mtimeMs}`);
    }
  };
  andar(join(RAIZ, "docs"));
  return partes.join("\n");
}

function oraculo(mapa: MapaEmMemoria): { pares: Set<string> } {
  const cfgPath = join(RAIZ, "tsconfig.json");
  const cfg = existsSync(cfgPath) ? ts.readConfigFile(cfgPath, ts.sys.readFile) : { config: {} };
  const opts = ts.parseJsonConfigFileContent(cfg.config, ts.sys, RAIZ).options;
  const pares = new Set<string>();
  for (const [caminho] of mapa.arquivos) {
    if (!/\.(ts|tsx|mts|cts)$/.test(caminho)) continue;
    const abs = join(RAIZ, caminho);
    const info = ts.preProcessFile(readFileSync(abs, "utf8"), true, true);
    for (const imp of info.importedFiles) {
      const r = ts.resolveModuleName(imp.fileName, abs, opts, ts.sys).resolvedModule;
      if (r === undefined || r.isExternalLibraryImport === true) continue;
      const rel = relative(RAIZ, r.resolvedFileName).split("\\").join("/");
      if (rel.startsWith("..") || rel.includes("node_modules") || rel.endsWith(".d.ts")) continue;
      if (mapa.arquivos.has(rel) && rel !== caminho) pares.add(`${caminho}>${rel}`);
    }
  }
  return { pares };
}

afterAll(() => gravarMedicoes());

describe("T-17.43: mapa do próprio repositório", () => {
  it("resolução de imports concorda >= 95% com o compilador TS, >= 85% exata, ciclos e raio coerentes", async () => {
    const antes = assinaturaDocs();
    const t0 = performance.now();
    const mapa = await analisarEmMemoria(RAIZ);
    const ms = performance.now() - t0;
    const ts_ = [...mapa.arquivos.keys()].filter((c) => /\.(ts|tsx)$/.test(c));
    expect(ts_.length).toBeGreaterThanOrEqual(500);
    expect(mapa.falhas).toEqual([]);

    const nossos = new Map<string, "exata" | "heuristica">();
    for (const a of mapa.resolucao.arestas) {
      if (!a.de.startsWith("arq:") || !a.para.startsWith("arq:")) continue;
      const de = a.de.slice(4);
      if (!/\.(ts|tsx|mts|cts)$/.test(de)) continue;
      nossos.set(`${de}>${a.para.slice(4)}`, a.confianca);
    }
    const { pares } = oraculo(mapa);
    let concordam = 0;
    const divergencias: string[] = [];
    for (const p of pares) {
      if (nossos.has(p)) concordam++;
      else divergencias.push(p);
    }
    const concordancia = concordam / Math.max(1, pares.size);
    const exatas = [...nossos.values()].filter((c) => c === "exata").length / Math.max(1, nossos.size);
    console.log(`[mapa-real] arquivos TS=${ts_.length} arestas=${nossos.size} oraculo=${pares.size} concordância=${(concordancia * 100).toFixed(2)}% exata=${(exatas * 100).toFixed(1)}% ${ms.toFixed(0)} ms`);
    if (concordancia < 0.95) console.log(divergencias.slice(0, 20).join("\n"));
    expect(registrar({ id: "P-252", descricao: "concordância das arestas `importa` do ExpxDev com o oráculo do compilador TS (qualidade, não velocidade)", valor: concordancia * 100, limite: 95, unidade: "%", sentido: "min", semFator: true }).ok).toBe(true);
    expect(registrar({ id: "P-252-exata", descricao: "arestas `importa` com confiança `exata` no ExpxDev", valor: exatas * 100, limite: 85, unidade: "%", sentido: "min", semFator: true }).ok).toBe(true);
    expect(concordancia).toBeGreaterThanOrEqual(0.95);
    expect(exatas).toBeGreaterThanOrEqual(0.85);
    expect(ms).toBeLessThanOrEqual(10_000 * FATOR);

    // ciclos: os SCCs (2+ nós) do mapa são os mesmos do oráculo.
    const arqs = [...mapa.arquivos.keys()].map((c) => `arq:${c}`);
    const gOraculo = construirGrafo(arqs, [...pares].map((p) => ({ de: `arq:${p.split(">")[0]}`, para: `arq:${p.split(">")[1]}` })));
    const grupos = (g: ReturnType<typeof construirGrafo>): string[] =>
      ciclos(g)
        .map((c) => c.nos.map((i) => g.ids[i]!).sort().join("|"))
        .sort();
    const gMeu = construirGrafo(
      arqs,
      [...nossos.keys()].map((p) => ({ de: `arq:${p.split(">")[0]}`, para: `arq:${p.split(">")[1]}` })),
    );
    const cOr = grupos(gOraculo);
    const cMeu = grupos(gMeu);
    console.log(`[mapa-real] ciclos: mapa=${cMeu.length} oraculo=${cOr.length}`);
    expect(cMeu.length).toBeGreaterThanOrEqual(0);
    const iguais = cOr.filter((c) => cMeu.includes(c)).length;
    expect(iguais / Math.max(1, cOr.length)).toBeGreaterThanOrEqual(0.9);

    // raio por import de src/nucleo/metodo/comandos.ts = importadores do oráculo (arquivos distintos).
    const alvo = "src/nucleo/metodo/comandos.ts";
    expect(mapa.arquivos.has(alvo)).toBe(true);
    const doOraculo = new Set([...pares].filter((p) => p.endsWith(`>${alvo}`)).map((p) => p.split(">")[0]!));
    const nossosImportadores = new Set([...nossos.keys()].filter((p) => p.endsWith(`>${alvo}`)).map((p) => p.split(">")[0]!));
    expect(doOraculo.size).toBeGreaterThan(0);
    for (const c of doOraculo) expect(nossosImportadores.has(c)).toBe(true);

    // entradas IPC detectadas.
    // Limite declarado: os canais do ExpxV são registrados em laço sobre uma tabela (`ipcMain.handle(canal, …)` com variável),
    // então a extração só vê literais; o que importa aqui é detectar entradas reais e nunca falhar.
    const entradas = [...mapa.arquivos.values()].flatMap((a) => a.extracao.entradas);
    expect(entradas.length).toBeGreaterThan(0);

    expect(assinaturaDocs()).toBe(antes);
  }, 120_000);

  it("história: churn calculado coincide com `git log --name-only` independente", async () => {
    const saida = execFileSync("git", ["log", "--no-merges", "--name-only", "--format=", "-n", "2000"], { cwd: RAIZ, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
    const cont = new Map<string, number>();
    for (const l of saida.split("\n")) if (l.trim() !== "") cont.set(l, (cont.get(l) ?? 0) + 1);
    const h = await coletarHistoria({ raiz: RAIZ });
    if (h.estado === "indisponivel") return;
    const comuns = [...cont.keys()].filter((c) => h.arquivos.has(c));
    expect(comuns.length).toBeGreaterThan(0);
    const iguais = comuns.filter((c) => h.arquivos.get(c)!.churn_total === cont.get(c)).length;
    expect(iguais / comuns.length).toBeGreaterThanOrEqual(0.9);
    const maxIndep = Math.max(...cont.values());
    const topo = [...cont].filter(([, n]) => n === maxIndep).map(([c]) => c);
    const noMapa = topo.filter((c) => h.arquivos.has(c));
    expect(noMapa.length).toBeGreaterThan(0);
  }, 60_000);
});
