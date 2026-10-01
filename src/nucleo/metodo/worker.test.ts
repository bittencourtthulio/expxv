import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { criarTmp, limparTmps } from "../../../tests/fixtures/metodo/util";
import { gerarProjetoExpx, HOJE_FIXTURE } from "../../../tests/fixtures/metodo/gerar";
import { criarIndexador } from "./indexador";
import { criarClienteWorker, executarTarefa } from "./worker";

const RAIZ_REPO = resolve(__dirname, "../../..");
// dentro de node_modules/.cache para que `require("yaml")` do JS compilado ache o pacote
const SAIDA = join(RAIZ_REPO, "node_modules/.cache/metodo-worker-teste");
const agora = () => Date.parse(HOJE_FIXTURE);

afterAll(limparTmps);

describe("executarTarefa (função pura do worker, sem thread)", () => {
  it("indexar devolve o índice; erros viram resposta ok:false sem lançar", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const idx = criarIndexador({ agora });
    const r = await executarTarefa(idx, { id: 1, tipo: "indexar", raiz });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.resultado as { trabalhos: unknown[] }).trabalhos).toHaveLength(15);
    const ruim = await executarTarefa(idx, { id: 2, tipo: "desconhecida" } as never);
    expect(ruim).toEqual({ id: 2, ok: false, erro: expect.stringContaining("desconhecida") });
    const semRaiz = await executarTarefa(idx, { id: 3, tipo: "indexar" } as never);
    expect(semRaiz.ok).toBe(false);
  });

  it("descartar libera o estado da raiz", async () => {
    const idx = criarIndexador({ agora });
    const r = await executarTarefa(idx, { id: 9, tipo: "descartar", raiz: "/qualquer" });
    expect(r).toEqual({ id: 9, ok: true, resultado: null });
  });
});

describe("worker em thread real (JS compilado para CommonJS)", () => {
  beforeAll(() => {
    rmSync(SAIDA, { recursive: true, force: true });
    execFileSync(
      join(RAIZ_REPO, "node_modules/.bin/tsc"),
      ["src/nucleo/metodo/worker.ts", "--outDir", SAIDA, "--rootDir", "src", "--module", "commonjs", "--moduleResolution", "node", "--target", "ES2022", "--lib", "ES2022", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--esModuleInterop", "--skipLibCheck", "--types", "node"],
      { cwd: RAIZ_REPO, stdio: "pipe" },
    );
    return () => rmSync(SAIDA, { recursive: true, force: true });
  }, 120_000);

  it("o arquivo compilado existe em <saida>/nucleo/metodo/worker.js e é carregável com new Worker(caminho)", async () => {
    const caminho = join(SAIDA, "nucleo/metodo/worker.js");
    expect(existsSync(caminho)).toBe(true);
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const cliente = criarClienteWorker(caminho);
    try {
      const ind = await cliente.indexar(raiz);
      expect(ind.trabalhos.length).toBe(15);
      expect(ind.trabalhos.find((t) => t.id === "plano-quebrado")?.sinaleira.cor).toBe("vermelho");
      // segunda chamada no mesmo worker reaproveita o estado incremental
      const ind2 = await cliente.indexar(raiz);
      expect(ind2.trabalhos.length).toBe(15);
      await expect(cliente.indexar("/nao/existe")).resolves.toMatchObject({ trabalhos: [] });
    } finally {
      await cliente.encerrar();
    }
  }, 30_000);

  it("a thread principal continua respondendo durante a indexação (P-12)", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const cliente = criarClienteWorker(join(SAIDA, "nucleo/metodo/worker.js"));
    try {
      let maiorAtraso = 0;
      let ultimo = performance.now();
      const timer = setInterval(() => {
        const n = performance.now();
        maiorAtraso = Math.max(maiorAtraso, n - ultimo - 5);
        ultimo = n;
      }, 5);
      await Promise.all(Array.from({ length: 10 }, () => cliente.indexar(raiz)));
      clearInterval(timer);
      expect(maiorAtraso).toBeLessThan(50);
    } finally {
      await cliente.encerrar();
    }
  }, 30_000);

  it("encerrar é idempotente e chamadas depois dele rejeitam", async () => {
    const cliente = criarClienteWorker(join(SAIDA, "nucleo/metodo/worker.js"));
    await cliente.encerrar();
    await cliente.encerrar();
    await expect(cliente.indexar("/x")).rejects.toThrow(/encerrado/);
  }, 30_000);
});
