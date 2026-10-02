import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { criarPool, tamanhoPadraoPool, type Pool, type TarefaExtracao } from "./pool";

const FALSO = resolve(__dirname, "../../../tests/fixtures/mapa/worker-falso.cjs");

const pools: Pool[] = [];
const pastas: string[] = [];
afterEach(async () => {
  for (const p of pools.splice(0)) await p.encerrar();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const t = (nome: string): TarefaExtracao => ({ caminho_abs: `/x/${nome}`, linguagem: "typescript" });
function novo(op: Parameters<typeof criarPool>[0] = {}): Pool {
  const p = criarPool({ caminhoWorker: FALSO, tamanho: 3, ...op });
  pools.push(p);
  return p;
}
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("pool de workers de extração (T-17.05)", () => {
  it("tamanho padrão = min(CPU−1, 4), no mínimo 1", () => {
    expect(tamanhoPadraoPool(1)).toBe(1);
    expect(tamanhoPadraoPool(2)).toBe(1);
    expect(tamanhoPadraoPool(4)).toBe(3);
    expect(tamanhoPadraoPool(8)).toBe(4);
    expect(tamanhoPadraoPool(64)).toBe(4);
  });

  it("nasce sem workers (0 handles) e cria sob demanda até o tamanho", async () => {
    const p = novo({ tamanho: 2 });
    expect(p.vivos).toBe(0);
    const rs = await Promise.all([p.executar(t("lento50-a.ts")), p.executar(t("lento50-b.ts")), p.executar(t("lento50-c.ts"))]);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(p.vivos).toBeLessThanOrEqual(2);
    expect(p.vivos).toBeGreaterThan(0);
  });

  it("resultados na ORDEM de entrada, mesmo com durações diferentes; progresso na ordem de conclusão", async () => {
    const p = novo({ tamanho: 3 });
    const nomes = ["lento120-a.ts", "ok-b.ts", "lento60-c.ts", "ok-d.ts", "lento10-e.ts", "ok-f.ts"];
    const conclusao: number[] = [];
    const rs = await p.executarLote(nomes.map(t), { aoResultado: (i) => conclusao.push(i) });
    expect(rs.map((r) => (r.ok ? (r.extracao as unknown as { hash: string }).hash : "falhou"))).toEqual(nomes);
    expect(conclusao).toHaveLength(6);
    expect(conclusao).not.toEqual([0, 1, 2, 3, 4, 5]); // o lento terminou depois dos rápidos
  });

  it("nunca passa do tamanho em execução e respeita o backpressure de 2×N tarefas em voo", async () => {
    const p = novo({ tamanho: 3 });
    let maxExec = 0;
    let maxTotal = 0;
    const amostra = setInterval(() => {
      maxExec = Math.max(maxExec, p.emVoo);
      maxTotal = Math.max(maxTotal, p.emVoo + p.naFila);
    }, 1);
    const rs = await p.executarLote(Array.from({ length: 60 }, (_, i) => t(`lento15-${i}.ts`)));
    clearInterval(amostra);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(maxExec).toBeLessThanOrEqual(3);
    expect(maxExec).toBeGreaterThanOrEqual(2); // paralelismo real
    expect(maxTotal).toBeLessThanOrEqual(6);
  });

  it("o trabalho roda em threads do pool, nunca na thread principal", async () => {
    const p = novo({ tamanho: 2 });
    const rs = await p.executarLote(Array.from({ length: 8 }, (_, i) => t(`lento20-${i}.ts`)));
    const threads = new Set(rs.map((r) => (r.ok ? (r.extracao as unknown as { thread: number }).thread : -1)));
    expect(threads.has(0)).toBe(false);
    expect(threads.size).toBeGreaterThanOrEqual(1);
    expect(threads.size).toBeLessThanOrEqual(2);
  });

  it("erro de um arquivo é isolado: os outros seguem", async () => {
    const p = novo();
    const rs = await p.executarLote([t("ok-1.ts"), t("erro-2.ts"), t("ok-3.ts")]);
    expect(rs.map((r) => r.ok)).toEqual([true, false, true]);
    expect(rs[1]).toMatchObject({ ok: false, codigo: "erro", erro: "falhou de propósito" });
  });

  it("timeout mata o worker, marca o arquivo e o pool segue com um worker novo", async () => {
    const p = novo({ tamanho: 1, timeoutMs: 250 });
    const t0 = performance.now();
    const rs = await p.executarLote([t("trava-1.ts"), t("ok-2.ts"), t("ok-3.ts")]);
    expect(rs[0]).toMatchObject({ ok: false, codigo: "timeout", timeout: true });
    expect(rs[1]!.ok).toBe(true);
    expect(rs[2]!.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(3000);
    const depois = await p.executar(t("ok-4.ts"));
    expect(depois.ok).toBe(true);
  });

  it("queda do worker é recuperada: uma tentativa nova; se cair de novo, só aquele arquivo falha", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mapa-pool-"));
    pastas.push(dir);
    const p = novo({ tamanho: 1, workerData: { marcador: join(dir, "marca") } });
    const [a, b, c, d] = await Promise.all([p.executar(t("cai-uma-vez.ts")), p.executar(t("cai-saida.ts")), p.executar(t("cai-erro.ts")), p.executar(t("ok-final.ts"))]);
    expect(a.ok).toBe(true); // caiu na 1ª, passou na 2ª
    expect(b).toMatchObject({ ok: false, codigo: "queda" });
    expect(c).toMatchObject({ ok: false, codigo: "queda" });
    expect(c.ok === false && c.erro).toMatch(/falha inesperada/);
    expect(d.ok).toBe(true);
  });

  it("cancelar() por AbortSignal: fila vira `cancelado`, execução em andamento é interrompida e a retomada refaz só o que faltou", async () => {
    const p = novo({ tamanho: 2 });
    const tarefas = Array.from({ length: 20 }, (_, i) => t(`lento300-${i}.ts`));
    const ctl = new AbortController();
    const t0 = performance.now();
    setTimeout(() => ctl.abort(), 100);
    const rs = await p.executarLote(tarefas, { signal: ctl.signal });
    expect(performance.now() - t0).toBeLessThan(1500); // não esperou as 20 × 300 ms
    expect(rs.filter((r) => !r.ok && r.codigo === "cancelado").length).toBe(20); // nenhuma chegou a 300 ms
    expect(p.naFila).toBe(0);
    expect(p.emVoo).toBe(0);
    // retomada: o pool continua utilizável e refaz as canceladas
    const retomada = await p.executarLote(tarefas.slice(0, 4).map((x) => ({ ...x, caminho_abs: x.caminho_abs.replace("lento300", "lento10") })));
    expect(retomada.every((r) => r.ok)).toBe(true);
  });

  it("cancelar() direto interrompe fila e execuções; abort já disparado devolve cancelado sem trabalhar", async () => {
    const p = novo({ tamanho: 1 });
    const prom = Promise.all([p.executar(t("lento5000-a.ts")), p.executar(t("lento5000-b.ts")), p.executar(t("lento5000-c.ts"))]);
    await dormir(50);
    p.cancelar();
    const rs = await prom;
    expect(rs.every((r) => !r.ok && r.codigo === "cancelado")).toBe(true);
    const ctl = new AbortController();
    ctl.abort();
    expect(await p.executar(t("ok.ts"), ctl.signal)).toMatchObject({ ok: false, codigo: "cancelado" });
    expect((await p.executar(t("ok2.ts"))).ok).toBe(true);
  });

  it("workers ociosos são encerrados (0 workers vivos) e voltam sob demanda", async () => {
    const criados: Worker[] = [];
    const p = novo({ tamanho: 2, ociosoMs: 120, criarWorker: (c, o) => { const w = new Worker(c, o); criados.push(w); return w; } });
    await p.executarLote([t("ok-1.ts"), t("ok-2.ts"), t("ok-3.ts")]);
    expect(p.vivos).toBeGreaterThan(0);
    await dormir(400);
    expect(p.vivos).toBe(0);
    expect(criados.every((w) => w.threadId === -1)).toBe(true); // todas as threads saíram
    expect((await p.executar(t("ok-4.ts"))).ok).toBe(true);
    expect(p.vivos).toBe(1);
  });

  it("encerrar(): nenhuma thread fica viva; tarefas pendentes resolvem `encerrado`; depois não aceita trabalho", async () => {
    const criados: Worker[] = [];
    const p = criarPool({ caminhoWorker: FALSO, tamanho: 2, criarWorker: (c, o) => { const w = new Worker(c, o); criados.push(w); return w; } });
    const pend = Promise.all([p.executar(t("lento5000-a.ts")), p.executar(t("lento5000-b.ts")), p.executar(t("lento5000-c.ts"))]);
    await dormir(80);
    expect(criados.length).toBe(2);
    await p.encerrar();
    const rs = await pend;
    expect(rs.every((r) => !r.ok && r.codigo === "encerrado")).toBe(true);
    expect(criados.every((w) => w.threadId === -1)).toBe(true);
    expect(p.vivos).toBe(0);
    expect(await p.executar(t("ok.ts"))).toMatchObject({ ok: false, codigo: "encerrado" });
    await p.encerrar(); // idempotente
  });

  it("overhead de IPC: 5 000 arquivos com extrator falso de 1 ms passam em até 3 s", async () => {
    const p = novo({ tamanho: 4 });
    const tarefas = Array.from({ length: 5000 }, (_, i) => t(`gira1-${i}.ts`));
    await p.executarLote(tarefas.slice(0, 40)); // aquece os workers
    const t0 = performance.now();
    const rs = await p.executarLote(tarefas);
    const ms = performance.now() - t0;
    console.log(`pool: 5 000 arquivos (extrator falso de 1 ms, 4 workers): ${ms.toFixed(0)} ms`);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(ms).toBeLessThan(3000);
  }, 30_000);
});
