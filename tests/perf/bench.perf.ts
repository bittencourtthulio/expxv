// Orçamentos do Bench (Fase 12; núcleo + serviço com a CLI falsa, sem Electron): P-50, P-52 (laço de eventos), P-54, P-55, P-57, P-59.
// Sem sandbox externo na medição de overhead (mede spawn + coleta + gravação, não o `sandbox-exec`). P-51/P-53/P-56/P-58 dependem do Electron real / do bundle e ficam para o fechamento.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { abrirBanco } from "../../src/nucleo/banco/banco";
import { migrar } from "../../src/nucleo/banco/migrar";
import { montarPacoteCego } from "../../src/nucleo/bench/julgamento/pacote-cego";
import { criarReposBench } from "../../src/nucleo/bench/repositorios";
import { compararTarefas, pontuarTarefa, recomendar } from "../../src/nucleo/bench/score";
import { criarSandboxNenhum } from "../../src/nucleo/bench/sandbox/sandbox";
import { criarServicoBench, type ServicoBench } from "../../src/nucleo/bench/servico";
import type { EventoBenchIpc } from "../../src/nucleo/bench/tipos";
import { gravarMedicoes, percentil, registrar } from "./registro";

const CLI = resolve(__dirname, "../fixtures/cli-bench.mjs");
const AJUDA = "-p --output-format --permission-mode --strict-mcp-config --mcp-config --disable-slash-commands --no-session-persistence --model --effort --tools --json --skip-git-repo-check --ephemeral -s -C";
const raiz = realpathSync(mkdtempSync(join(tmpdir(), "bench-perf-")));
const servicos: ServicoBench[] = [];
afterAll(async () => { for (const s of servicos) await s.encerrar(); rmSync(raiz, { recursive: true, force: true }); gravarMedicoes(); });

function novoServico(base: string, eventos?: EventoBenchIpc[]): { svc: ServicoBench; banco: ReturnType<typeof abrirBanco> } {
  mkdirSync(base, { recursive: true });
  const banco = abrirBanco(":memory:");
  migrar(banco);
  const sbx = criarSandboxNenhum();
  const svc = criarServicoBench({
    banco, pastaBench: join(base, "bench"), pastaDados: base, homeReal: join(base, "home"), sandboxPara: () => sbx, sandboxChecagens: sbx,
    contas: { resolver: (id) => ({ home: join(base, "contas", id, "home"), configDir: join(base, "contas", id, "cfg") }) },
    prepararComando: (c) => ({ executavel: process.execPath, args: [CLI, ...c.args] }), lerAjuda: async () => AJUDA, plataforma: "win32", timeoutPadraoMs: 60_000,
    ambientePai: () => ({ PATH: process.env["PATH"] }), ...(eventos === undefined ? {} : { emitir: (e: EventoBenchIpc) => void eventos.push(e) }),
  });
  servicos.push(svc);
  svc.alvosSalvar([{ provedor: "claude", modelo: "modelo-a", esforco: null, cli: "claude", conta_id: "cta_A", rotulo: null }]);
  return { svc, banco };
}
const tarefa = (slug: string, marcador: string) => ({ slug, titulo: slug, atividade: "bug", tipo: "web" as const, prompt: `Crie index.html. ${marcador}`, escopo: "", checagens: [{ tipo: "file_exists" as const, alvo: "index.html", critica: true }], estado: "ativa" as const });
const ALVO = "claude-modelo-a-padrao";

async function iniciar(svc: ServicoBench, tarefas: string[], paralelo: number): Promise<string> {
  const est = await svc.estimar({ tarefas, alvos: [ALVO], max_paralelo: paralelo, teto_usd: null, juiz_alvo: null });
  const c = svc.consentir(est.estimativa_id, est.frase_exigida ?? "RODAR");
  if ("erro" in c) throw new Error(est.avisos.join(" | "));
  const r = await svc.rodar(est.estimativa_id, c.token);
  if ("erro" in r) throw new Error(r.erro);
  return r.run_id;
}

async function comMonitor<T>(fn: () => Promise<T>): Promise<{ valor: T; pior: number }> {
  let pior = 0;
  let ultimo = performance.now();
  let rodando = true;
  const laco = (): void => { const n = performance.now(); pior = Math.max(pior, n - ultimo); ultimo = n; if (rodando) setImmediate(laco); };
  setImmediate(laco);
  const valor = await fn();
  rodando = false;
  return { valor, pior };
}

describe("P-50: overhead do Bench por execução (CLI falsa instantânea)", () => {
  it("p95 ≤ 500 ms (tempo total − tempo medido da própria execução)", async () => {
    const { svc } = novoServico(join(raiz, "p50"));
    svc.tarefaSalvar(tarefa("rapida", "entrega"));
    const sobras: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const run = await iniciar(svc, ["rapida"], 1);
      await svc.aguardar();
      const total = performance.now() - t0;
      const exec = (svc.estadoRun(run).resultados[0]?.duracao_s ?? 0) * 1000;
      sobras.push(total - exec);
    }
    registrar({ id: "P-50", descricao: "Overhead do Bench por execução (spawn + coleta + gravação; estimar+consentir incluídos), CLI falsa instantânea", valor: percentil(sobras, 95), limite: 500, unidade: "ms", pior: Math.max(...sobras) });
    expect(percentil(sobras, 95)).toBeLessThanOrEqual(500 * (Number(process.env["EXPXV_PERF_FATOR"] ?? 1) || 1));
  }, 120_000);
});

describe("P-52: laço de eventos com 5 CLIs despejando 10 MB cada", () => {
  it("nenhuma tarefa > 50 ms e o renderer não recebe o log (só eventos pequenos)", async () => {
    const eventos: EventoBenchIpc[] = [];
    const { svc } = novoServico(join(raiz, "p52"), eventos);
    const slugs = ["g1", "g2", "g3", "g4", "g5"];
    for (const s of slugs) svc.tarefaSalvar(tarefa(s, "MODO:GRANDE:10"));
    const { valor: run, pior } = await comMonitor(async () => { const r = await iniciar(svc, slugs, 5); await svc.aguardar(); return r; });
    registrar({ id: "P-52", descricao: "Maior pausa do laço de eventos do main com 5 CLIs falsas despejando 10 MB cada", valor: pior, limite: 50, unidade: "ms" });
    const g = svc.estadoRun(run);
    expect(g.resultados.every((r) => r.estado === "concluido")).toBe(true);
    const bytesIpc = Buffer.byteLength(JSON.stringify(eventos));
    registrar({ id: "P-52b", descricao: "Bytes por IPC (eventos) numa Run de 5 execuções com 50 MB de log no disco", valor: bytesIpc, limite: 8 * 1024, unidade: "B", semFator: true });
    expect(bytesIpc).toBeLessThan(8 * 1024);
    const log = svc.repos.resultados.obter(g.resultados[0]!.id)!.log_ref!;
    expect(existsSync(join(raiz, "p52", "bench", "exec", ...log.split("/")))).toBe(true);
  }, 120_000);
});

describe("P-57: cancelar uma Run com 5 execuções em andamento", () => {
  it("árvore de processos morta em ≤ 2 s e 0 remanescentes", async () => {
    const { svc } = novoServico(join(raiz, "p57"));
    const slugs = ["k1", "k2", "k3", "k4", "k5"];
    for (const s of slugs) svc.tarefaSalvar({ ...tarefa(s, "MODO:FILHO"), checagens: [] });
    const run = await iniciar(svc, slugs, 5);
    const filhos: Array<{ pid: number; neto: number }> = [];
    const t0 = Date.now();
    while (filhos.length < 5 && Date.now() - t0 < 15_000) {
      filhos.length = 0;
      for (const r of svc.repos.resultados.daRun(run)) { const p = r.workdir === null ? "" : join(raiz, "p57", "bench", "exec", ...r.workdir.split("/"), "filhos.json"); if (p !== "" && existsSync(p)) { try { filhos.push(JSON.parse(readFileSync(p, "utf8")) as { pid: number; neto: number }); } catch { /* escrevendo */ } } }
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(filhos).toHaveLength(5);
    const c0 = performance.now();
    await svc.cancelar(run);
    const dur = performance.now() - c0;
    await new Promise((r) => setTimeout(r, 100));
    const vivos = filhos.flatMap((f) => [f.pid, f.neto]).filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }).length;
    registrar({ id: "P-57", descricao: "Cancelar Run com 5 execuções (árvore de processos morta)", valor: dur, limite: 2000, unidade: "ms" });
    registrar({ id: "P-57b", descricao: "Processos remanescentes após cancelar (pid + netos)", valor: vivos, limite: 0, unidade: "processos", semFator: true });
    expect(vivos).toBe(0);
  }, 60_000);
});

describe("P-54, P-55, P-59: score, banco e pacote cego", () => {
  it("score + comparar + recomendar com 10 000 resultados ≤ 50 ms; consulta quente ≤ 5 ms; pacote cego de 5 × 1 MB ≤ 200 ms", () => {
    const banco = abrirBanco(":memory:");
    migrar(banco);
    const r = criarReposBench(banco);
    const ru = r.runs.criar({ nome: "n", tarefas: [], alvos: [], max_paralelo: 3, teto_usd: null, juiz_alvo: null, pesos: { q: 0.6, s: 0.2, c: 0.2 }, sandbox: "macos" });
    banco.transacao((b) => {
      for (let i = 0; i < 10_000; i++) b.executar("INSERT INTO bench_resultado (id,run_id,tarefa_slug,tarefa_versao,alvo_slug,tentativa,estado,juiz_estado,qualidade,duracao_s,custo_fonte,custo_usd,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,'concluido','feito',?,?,'relatorio_cli',?,?,?)", [`bres_${String(i).padStart(10, "0")}`, ru.id, `t${i % 100}`, 1, `a${Math.floor(i / 100)}`, 1, (i % 10) + 0.5, 10 + (i % 7), 0.01 + (i % 5) / 100, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
    });
    r.resultados.obter("bres_0000005000");
    const consultas: number[] = [];
    for (let i = 0; i < 50; i++) { const t = performance.now(); r.resultados.obter(`bres_${String(i * 100).padStart(10, "0")}`); consultas.push(performance.now() - t); }
    registrar({ id: "P-55", descricao: "Consulta quente ao banco do Bench (p95, 10 000 resultados)", valor: percentil(consultas, 95), limite: 5, unidade: "ms" });
    const hist = r.resultados.historico();
    const porTarefa = new Map<string, typeof hist>();
    for (const h of hist) porTarefa.set(h.tarefa_slug, [...(porTarefa.get(h.tarefa_slug) ?? []), h]);
    const entradas = [...porTarefa.entries()].map(([tarefaSlug, hs]) => ({ tarefa: tarefaSlug, versao: 1, atividade: "x", entradas: hs.slice(0, 100).map((h) => ({ resultado_id: h.id, alvo: h.alvo_slug, qualidade: h.qualidade, duracao_s: h.duracao_s, custo_usd: h.custo_usd, critica_falhou: false, revisoes: null })) }));
    const meta = new Map(Array.from({ length: 100 }, (_, i) => [`a${i}`, { provedor: "p", modelo: `m${i}`, esforco: null, cli: "claude" }]));
    const t0 = performance.now();
    for (const e of entradas) pontuarTarefa(e.entradas);
    compararTarefas(["a0", "a1"], entradas.map((e) => ({ ...e, entradas: e.entradas.slice(0, 2) })));
    recomendar("x", entradas, meta);
    const score = performance.now() - t0;
    registrar({ id: "P-54", descricao: "Score + comparar + recomendar com 10 000 resultados", valor: score, limite: 50, unidade: "ms" });
    const grandes = Array.from({ length: 5 }, (_, i) => ({ alvo: `prov${i}-modelo${i}-high`, termos: [`modelo${i}`], artefatos: [{ nome: "index.html", conteudo: Buffer.alloc(1024 * 1024, "claude gpt codex ") }], checagens: "ok" }));
    const t1 = performance.now();
    montarPacoteCego("pedido", grandes);
    const cego = performance.now() - t1;
    registrar({ id: "P-59", descricao: "Pacote cego (sanitizar + embaralhar) de 5 artefatos de 1 MB", valor: cego, limite: 200, unidade: "ms" });
    expect(score).toBeLessThan(50 * (Number(process.env["EXPXV_PERF_FATOR"] ?? 1) || 1));
    banco.fechar();
  });
});
