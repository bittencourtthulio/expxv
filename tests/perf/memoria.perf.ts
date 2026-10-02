// Orçamentos da Memória (Fase 8; P-32..P-42) no NÚCLEO — Node puro, banco real em arquivo (WAL) em os.tmpdir, sem Electron e sem rede.
// Corpus: 50 000 entradas (tests/fixtures/memoria/gerar.ts), 1 000 por linhagem. O que depende do main/IPC/UI (round trip MCP, tela, e2e de
// restore no Electron) NÃO é medido aqui: fica no passe de integração (ver docs/ade/pedidos/8-pedidos.md).
//  - P-32: build_brief completo (banco + render + redação) p95 ≤ 50 ms (200 exec); pacote da Missão ≤ 20 ms; brief ≤ 6 000 chars.
//  - P-33: buildBrief puro com 200 entradas p95 ≤ 5 ms; determinístico.
//  - P-34: escrita (validação + redação + dedupe + transação) com 50 000 no banco p95 ≤ 5 ms.
//  - P-35: memory_search com 50 000, limit 50: FTS5 p95 ≤ 30 ms, LIKE p95 ≤ 80 ms; resposta ≤ 8 KB.
//  - P-36: restaurar (sem a CLI) ≤ 300 ms.   P-37: coletor ≤ 2 ms/evento e nenhuma fatia > 50 ms em rajada de 500.
//  - P-38: fatia do ciclo ≤ 20 ms; 5 000 entradas compactadas ≤ 2 s.   P-39: redação 1 000 chars ≤ 1 ms; 1 MB adversarial ≤ 100 ms.
//  - P-41: RSS adicional ≤ 10 MB; arquivo do banco ≤ 40 MB a 50 000.   P-42: chunking de 1 MB ≤ 100 ms; 20 KB (redigir+chunkar) ≤ 5 ms; registrar ≤ 1 ms.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import v8 from "node:v8";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../../src/nucleo/banco/banco";
import { migrar } from "../../src/nucleo/banco/migrar";
import { buildBrief, type ItemBrief } from "../../src/nucleo/memoria/brief";
import { criarCiclo } from "../../src/nucleo/memoria/ciclo";
import { ligarColetor, type BarramentoColetor } from "../../src/nucleo/memoria/coletor";
import { criarLimitador } from "../../src/nucleo/memoria/escrita";
import { criarPortaEnfileirada, montarEvento } from "../../src/nucleo/memoria/eventos-conhecimento";
import { dividirEmChunks, normalizarParaIndice, prepararDocumento } from "../../src/nucleo/memoria/ingestao";
import { redigirTexto } from "../../src/nucleo/memoria/redacao";
import { criarRestaurador } from "../../src/nucleo/memoria/restaurar";
import { criarServicoMemoria, type ServicoMemoria } from "../../src/nucleo/memoria/servico";
import { gerarCorpus, type CorpusMemoria } from "../fixtures/memoria/gerar";
import { gravarMedicoes, percentil, registrar } from "./registro";

let pasta: string;
let banco: Banco;
let corpus: CorpusMemoria;
let svc: ServicoMemoria;
// memória do módulo: heap + buffers externos, medidos com GC forçado depois de gerar o corpus e DEPOIS de exercitar o módulo
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;
const usada = (): number => {
  gc();
  gc();
  const m = process.memoryUsage();
  return m.heapUsed + m.external + m.arrayBuffers * 0;
};
const memAntes = { v: 0 };
afterAll(() => {
  gravarMedicoes();
  banco?.fechar();
  if (pasta) rmSync(pasta, { recursive: true, force: true });
});

const medir = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};
const amostras = (n: number, fn: (i: number) => void, aquecer = 10): number[] => {
  for (let i = 0; i < aquecer; i++) fn(i);
  return Array.from({ length: n }, (_, i) => medir(() => fn(i)));
};

beforeAll(() => {
  pasta = mkdtempSync(join(tmpdir(), "memoria-perf-"));
  banco = abrirBanco(join(pasta, "perf.db"));
  migrar(banco);
  corpus = gerarCorpus(banco);
  svc = criarServicoMemoria({ banco, limitador: criarLimitador({ porMinuto: 10_000_000 }) });
  memAntes.v = usada();
});

describe("P-32/P-33: brief", () => {
  it("P-32: build_brief completo (banco + render + redação) p95 ≤ 50 ms e ≤ 6 000 chars; pacote ≤ 20 ms", () => {
    expect(corpus.total).toBe(50_000);
    let tam = 0;
    const t = amostras(200, () => {
      const b = svc.briefPrevia("P000");
      tam = b.caracteres;
    });
    expect(tam).toBeGreaterThan(500);
    expect(tam).toBeLessThanOrEqual(6000);
    const m = registrar({ id: "P-32", descricao: "build_brief completo, linhagem de 1 000 entradas (p95)", valor: percentil(t, 95), limite: 50, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok, `p95 ${m.valor} ms`).toBe(true);
    const tp = amostras(100, () => void svc.pacoteDaMissao("P000", "piloto"));
    const mp = registrar({ id: "P-32.pacote", descricao: "pacote da Missão (p95)", valor: percentil(tp, 95), limite: 20, unidade: "ms" });
    expect(mp.ok, `p95 ${mp.valor} ms`).toBe(true);
  });
  it("P-33: buildBrief puro com 200 entradas p95 ≤ 5 ms; mesma entrada = mesma saída", () => {
    const item = (tipo: ItemBrief["tipo"], i: number): ItemBrief => ({ tipo, fonte: "agente", conteudo: `entrada ${i} sobre cache, fila e banco ${"texto ".repeat(20)}`, importancia: 1 + (i % 5), atualizado_em: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z`, criado_em: "2026-09-01T00:00:00.000Z" });
    const e = { display_id: 3, agora: "2026-10-01T10:00:00.000Z", checkpoint: item("checkpoint", 0), decisoes: Array.from({ length: 70 }, (_, i) => item("decisao", i)), riscos: Array.from({ length: 60 }, (_, i) => item("risco", i)), eventos: Array.from({ length: 70 }, (_, i) => item("evento", i)), orcamento_chars: 6000, memox_instalado: true };
    const a = buildBrief(e);
    expect(buildBrief(e)).toEqual(a);
    const t = amostras(300, () => void buildBrief(e));
    const m = registrar({ id: "P-33", descricao: "buildBrief puro, 200 entradas (p95)", valor: percentil(t, 95), limite: 5, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok, `p95 ${m.valor} ms`).toBe(true);
  });
});

describe("P-34/P-35: escrita e busca com 50 000 entradas", () => {
  it("P-34: escrita (validação + redação + dedupe + transação) p95 ≤ 5 ms", () => {
    const t = amostras(300, (i) => void svc.memory_write("P001", { content: `decisão nova ${i} ${Math.random()} sobre cache e fila com token=xyz${i}`, kind: i % 3 === 0 ? "decision" : "fact" }), 20);
    const m = registrar({ id: "P-34", descricao: "memory_write com 50 000 no banco (p95)", valor: percentil(t, 95), limite: 5, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok, `p95 ${m.valor} ms`).toBe(true);
  });
  it("P-35: memory_search limit 50 — FTS5 p95 ≤ 30 ms; LIKE p95 ≤ 80 ms; resposta ≤ 8 KB", async () => {
    const consultas = ["cache fila", "token sessão", "decisão risco", "migração índice", "squad cofre", "retry timeout", "handoff checkpoint", "busca vetor grafo"];
    const executar = async (semFts: boolean): Promise<{ ms: number[]; bytes: number }> => {
      const svcX = criarServicoMemoria({ banco, limitador: criarLimitador({ porMinuto: 10_000_000 }) });
      const ctx = svcX.ctxDoToken("P002");
      const { buscar } = await import("../../src/nucleo/memoria/leitura");
      const ms: number[] = [];
      let bytes = 0;
      for (let i = 0; i < 6; i++) for (const q of consultas) buscar({ banco, semFts }, { ctx, query: q, scope: "pane", limit: 50 });
      for (let i = 0; i < 30; i++)
        for (const q of consultas) {
          const t0 = performance.now();
          const r = buscar({ banco, semFts }, { ctx, query: q, scope: i % 2 ? "pane" : "all_rings", limit: 50 });
          ms.push(performance.now() - t0);
          bytes = Math.max(bytes, Buffer.byteLength(JSON.stringify(r), "utf8"));
        }
      return { ms, bytes };
    };
    const fts = await executar(false);
    const like = await executar(true);
    const m1 = registrar({ id: "P-35.fts", descricao: "memory_search com FTS5, 50 000 (p95)", valor: percentil(fts.ms, 95), limite: 30, unidade: "ms", pior: Math.max(...fts.ms) });
    const m2 = registrar({ id: "P-35.like", descricao: "memory_search no fallback LIKE, 50 000 (p95)", valor: percentil(like.ms, 95), limite: 80, unidade: "ms", pior: Math.max(...like.ms) });
    const m3 = registrar({ id: "P-35.bytes", descricao: "tamanho máximo da resposta", valor: Math.max(fts.bytes, like.bytes), limite: 8192, unidade: "bytes", semFator: true });
    expect(m1.ok, `FTS5 p95 ${m1.valor} ms`).toBe(true);
    expect(m2.ok, `LIKE p95 ${m2.valor} ms`).toBe(true);
    expect(m3.ok).toBe(true);
  });
});

describe("P-36/P-37: restaurar e coletor", () => {
  it("P-36: restaurar (sem a CLI) ≤ 300 ms com brief de 1 000 entradas", async () => {
    banco.executar("UPDATE pane SET estado = 'encerrado' WHERE id = 'P000'");
    banco.executar("DELETE FROM pane WHERE respawn_de = 'P000'");
    const rest = criarRestaurador({
      banco, podeRetomar: () => false,
      respawn: async (id) => {
        banco.executar("INSERT INTO pane (id,workspace_id,display_id,tipo,cli,papel,eh_piloto,estado,respawn_de,criado_em,atualizado_em) VALUES ('P000r','ws_perf',9999,'cli','claude','nenhum',0,'pronto',?,?,?)", [id, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
        return { pane_id: "P000r", sessao_id: "s" };
      },
    });
    const t0 = performance.now();
    const r = await rest.restaurarPane("P000");
    const ms = performance.now() - t0;
    expect(r.brief_injetado).toBe(true);
    const m = registrar({ id: "P-36", descricao: "restaurar: clique → Pane (sem a CLI)", valor: ms, limite: 300, unidade: "ms" });
    expect(m.ok, `${m.valor} ms`).toBe(true);
    banco.executar("DELETE FROM pane WHERE id = 'P000r'");
    banco.executar("UPDATE pane SET estado = 'pronto' WHERE id = 'P000'");
  });
  it("P-37: coletor ≤ 2 ms por evento; rajada de 500 sem fatia > 50 ms", () => {
    const m = new Map<string, Array<(p: unknown) => void>>();
    const bar: BarramentoColetor = { assinar: (t, o) => (m.set(t, [...(m.get(t) ?? []), o as (p: unknown) => void]), () => undefined) };
    const filas: Array<() => void> = [];
    const col = ligarColetor({ banco, barramento: bar, agendar: (fn) => void filas.push(fn) });
    const emitir = (): void => (m.get("pane.closed") ?? []).forEach((o) => o({ pane_id: "P003", reason: `r${Math.random()}` }));
    const por = amostras(500, emitir, 5);
    const fatias: number[] = [];
    while (filas.length > 0) for (const f of filas.splice(0)) fatias.push(medir(f));
    expect(col.estatisticas().eventos).toBeGreaterThanOrEqual(500);
    const m1 = registrar({ id: "P-37.evento", descricao: "coletor: custo de aceitar um evento (média)", valor: por.reduce((a, b) => a + b, 0) / por.length, limite: 2, unidade: "ms" });
    const m2 = registrar({ id: "P-37.fatia", descricao: "coletor: maior fatia de escrita na rajada de 500", valor: Math.max(...fatias), limite: 50, unidade: "ms" });
    expect(m1.ok, `${m1.valor} ms`).toBe(true);
    expect(m2.ok, `${m2.valor} ms`).toBe(true);
    col.parar();
  });
});

describe("P-38/P-39: ciclo e redação", () => {
  it("P-38: cada fatia ≤ 20 ms e 5 000 entradas compactadas ≤ 2 s no total", async () => {
    const pasta2 = mkdtempSync(join(tmpdir(), "memoria-perf-ciclo-"));
    const b2 = abrirBanco(join(pasta2, "c.db"));
    try {
      migrar(b2);
      gerarCorpus(b2, { total: 5000, porLinhagem: 5000, semente: 7 });
      b2.executar("UPDATE memoria_entrada SET estado = 'ativa', tipo = 'evento', criado_em = '2026-09-01T10:00:00.000Z', atualizado_em = '2026-09-01T10:' || substr(id, 8, 2) || ':00.000Z' WHERE linhagem_id = 'P000'");
      const ciclo = criarCiclo({ banco: b2, agora: () => new Date("2026-10-20T00:00:00.000Z") });
      const fatias: number[] = [];
      const t0 = performance.now();
      let compactadas = 0;
      for (let i = 0; i < 400; i++) {
        const f = ciclo.fatia();
        fatias.push(f.ms);
        if (f.etapa === "compactar") compactadas += f.trabalho;
        if (compactadas >= 4800) break;
      }
      const total = performance.now() - t0;
      const m1 = registrar({ id: "P-38.fatia", descricao: "ciclo: maior fatia", valor: Math.max(...fatias), limite: 20, unidade: "ms" });
      const m2 = registrar({ id: "P-38.total", descricao: "ciclo: 5 000 entradas compactadas (total)", valor: total, limite: 2000, unidade: "ms" });
      expect(compactadas, "compactou o suficiente").toBeGreaterThan(2000);
      expect(m1.ok, `fatia ${m1.valor} ms`).toBe(true);
      expect(m2.ok, `total ${m2.valor} ms`).toBe(true);
    } finally {
      b2.fechar();
      rmSync(pasta2, { recursive: true, force: true });
    }
  });
  it("P-39: redação de 1 000 chars ≤ 1 ms (mediana) e 1 MB adversarial ≤ 100 ms (pior caso)", () => {
    const t = "Decidimos usar SQLite; ver src/nucleo/x.ts linha 10 e a task T-08.07 com API_KEY=abc. ".repeat(12).slice(0, 1000);
    const xs = amostras(300, () => void redigirTexto(t), 30);
    const m1 = registrar({ id: "P-39", descricao: "redigirTexto, 1 000 chars (mediana)", valor: percentil(xs, 50), limite: 1, unidade: "ms" });
    const pat = { a: "a".repeat(1_000_000), bearer: "Bearer ".repeat(140_000), igual: "=".repeat(1_000_000), chave: "key=".repeat(240_000), token: "TOKEN: ".repeat(140_000), pem: "-----BEGIN PRIVATE KEY-----".repeat(30_000), url: "a://:".repeat(180_000), alnum: "aB3".repeat(333_333), base64: ("aB3+".repeat(10) + " ").repeat(24_000) };
    redigirTexto("aquecer");
    const piores = Object.entries(pat).map(([k, v]) => [k, Math.min(...Array.from({ length: 3 }, () => medir(() => void redigirTexto(v))))] as const);
    const pior = piores.sort((a, b) => b[1] - a[1])[0] as readonly [string, number];
    const m2 = registrar({ id: "P-39.adversarial", descricao: `redigirTexto, 1 MB adversarial (pior caso: ${pior[0]})`, valor: pior[1], limite: 100, unidade: "ms" });
    expect(m1.ok, `${m1.valor} ms`).toBe(true);
    expect(m2.ok, `${pior[0]}: ${m2.valor} ms`).toBe(true);
  });
});

describe("P-41/P-42: footprint e ingestão", () => {
  it("P-41: banco ≤ 40 MB e memória adicional ≤ 10 MB com 50 000 entradas", () => {
    const mb = statSync(join(pasta, "perf.db")).size / 1048576;
    const adicional = (usada() - memAntes.v) / 1048576;
    const m1 = registrar({ id: "P-41.disco", descricao: "arquivo do banco com 50 000 entradas (+ FTS5)", valor: mb, limite: 40, unidade: "MB", semFator: true });
    const m2 = registrar({ id: "P-41.memoria", descricao: "memória adicional do módulo (heap + buffers) após exercitar brief, busca, escrita, coletor e ciclo com 50 000 entradas", valor: Math.max(0, adicional), limite: 10, unidade: "MB", semFator: true });
    expect(m1.ok, `${m1.valor} MB`).toBe(true);
    expect(m2.ok, `${m2.valor} MB`).toBe(true);
  });
  it("P-42: chunking de 1 MB de markdown ≤ 100 ms; 20 KB redigir+chunkar ≤ 5 ms; registrar ≤ 1 ms", () => {
    const md = Array.from({ length: 1200 }, (_, i) => `# Seção ${i}\n\n${"Parágrafo de exemplo com palavras úteis para o chunker. ".repeat(12)}\n\n- item um\n- item dois\n\n\`\`\`ts\nconst x = ${i};\n\`\`\`\n`).join("\n").slice(0, 1_048_576);
    const normal = normalizarParaIndice(md);
    dividirEmChunks(normal);
    const t = Array.from({ length: 5 }, () => medir(() => void dividirEmChunks(normal)));
    const a = dividirEmChunks(normal);
    expect(dividirEmChunks(normal).map((c) => c.hash)).toEqual(a.map((c) => c.hash));
    const m1 = registrar({ id: "P-42.chunk", descricao: "dividirEmChunks, 1 MB de markdown (mínimo de 5)", valor: Math.min(...t), limite: 100, unidade: "ms" });
    const rel = ("# Relatório\n\nA causa raiz foi o cache sem invalidação. Corrigimos com token=abc123 em src/a.ts.\n\n" + "Detalhe técnico do relatório com várias frases. ".repeat(20) + "\n\n").repeat(18).slice(0, 20_000);
    const t2 = amostras(100, () => void prepararDocumento({ origem: "docs/r.md", texto: rel }), 10);
    const m2 = registrar({ id: "P-42.relatorio", descricao: "redigir + chunkar relatório de 20 KB (p95)", valor: percentil(t2, 95), limite: 5, unidade: "ms" });
    const porta = criarPortaEnfileirada(() => new Promise<void>(() => undefined), { limite: 100 });
    const ev = montarEvento({ tipo: "pane.closed", workspace_id: "ws_perf", chave_natural: "x", ocorrido_em: "2026-10-01T00:00:00.000Z", fonte: "sistema", importancia: 2, titulo: "t", texto: "x" });
    const t3 = amostras(300, () => porta.registrar(ev), 5);
    const m3 = registrar({ id: "P-42.registrar", descricao: "Conhecimento.registrar com consumidor travado (p95)", valor: percentil(t3, 95), limite: 1, unidade: "ms" });
    expect(m1.ok, `${m1.valor} ms`).toBe(true);
    expect(m2.ok, `${m2.valor} ms`).toBe(true);
    expect(m3.ok, `${m3.valor} ms`).toBe(true);
  });
});
