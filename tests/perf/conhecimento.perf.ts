// Orçamentos do RAG local (Fase 15; P-70..P-83) no NÚCLEO — Node puro, banco real em arquivo (WAL) em os.tmpdir, sem Electron e sem rede.
// Corpus sintético de 50 000 chunks (tests/fixtures/conhecimento/gerar.ts, semente fixa). O que depende do main/IPC/UI/Electron (round trip
// MCP, worker thread real, tela do grafo, hook, e2e) NÃO é medido aqui: fica no passe de integração (docs/ade/pedidos/15-pedidos.md).
//  - P-70: busca híbrida 50 k p95 ≤ 150 ms; varredura vetorial p95 ≤ 50 ms; resposta ≤ 8 KB.
//  - P-71: contexto completo p95 ≤ 150 ms; com o embedding travado devolve `lento` em ≤ 170 ms.
//  - P-72: ingestão incremental de um evento p95 ≤ 50 ms; registrar (só enfileira) ≤ 1 ms.
//  - P-73: backfill (10 000 arquivos de código + 200 docs + 2 000 commits) ≤ 120 s, fatias ≤ 50 ms.
//  - P-74: embedding hash ≤ 1 ms/chunk.   P-78: RAM do índice exato ≤ 120 MB; banco ≤ 4 KB/chunk.
//  - P-81: consolidação ≤ 60 s e P-70 mantido durante o reembutir.   P-83: exato f32 × int8 (informativo + paridade).
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirBancoConhecimento } from "../../src/nucleo/conhecimento/banco";
import { Buscador } from "../../src/nucleo/conhecimento/busca/buscador";
import { embutirHash } from "../../src/nucleo/conhecimento/embeddings/hash";
import { normalizarL2, type ProvedorEmbedding } from "../../src/nucleo/conhecimento/embeddings/provedor";
import { reembutirFatia } from "../../src/nucleo/conhecimento/embeddings/reembutir";
import { RegistroEmbeddings } from "../../src/nucleo/conhecimento/embeddings/registro";
import { IndiceExato } from "../../src/nucleo/conhecimento/indice/exato";
import { IndiceExatoInt8 } from "../../src/nucleo/conhecimento/indice/exato-int8";
import { GerenciadorIndices } from "../../src/nucleo/conhecimento/indice/gerenciador";
import { executarBackfill } from "../../src/nucleo/conhecimento/ingestao/backfill";
import { consolidar } from "../../src/nucleo/conhecimento/aprendizado/consolidar";
import { criarRepos, type Repos } from "../../src/nucleo/conhecimento/repos";
import { ServicoConhecimento } from "../../src/nucleo/conhecimento/servico";
import type { DocumentoEntrada, EntradaConhecimento } from "../../src/nucleo/conhecimento/tipos";
import { consultasSinteticas, gerarCorpus, prng, vetorAleatorio, type CorpusGerado } from "../fixtures/conhecimento/gerar";
import { gravarMedicoes, percentil, registrar } from "./registro";

const N = 50_000;
let pasta: string;
let caminho: string;
let svc: ServicoConhecimento;
let repos: Repos;
let corpus: CorpusGerado;
let fechar: () => void;

beforeAll(() => {
  pasta = mkdtempSync(join(tmpdir(), "ade-perf-conh-"));
  caminho = join(pasta, "conhecimento.db");
  const { banco } = abrirBancoConhecimento(caminho);
  svc = new ServicoConhecimento({ banco, workspace_id: "ws_perf", nomeWorkspace: "perf", raiz: "/work/perf" });
  repos = svc.repos;
  corpus = gerarCorpus(banco, { chunks: N, colecao_id: svc.colecaoId, modelo: "hash-256-v1" });
  // estado estável: depois do backfill a consolidação roda `fts optimize` (a carga em massa deixa muitos segmentos FTS5 pequenos)
  banco.executar("INSERT INTO rag_chunk_fts(rag_chunk_fts) VALUES ('optimize')");
  fechar = () => (svc.fechar(), banco.fechar());
}, 300_000);

afterAll(() => {
  gravarMedicoes();
  fechar?.();
  if (pasta) rmSync(pasta, { recursive: true, force: true });
});

describe("P-70: busca híbrida com 50 000 chunks", () => {
  it("p95 ≤ 150 ms; varredura vetorial p95 ≤ 50 ms; resposta ≤ 8 KB (200 consultas)", async () => {
    expect(svc.estado().chunks).toBe(N);
    // aquece o índice em RAM (warm-up em segundo plano) e mede a varredura pura
    const t0 = performance.now();
    expect(svc.aquecer(Infinity)).toBe(true);
    const aquecimentoMs = performance.now() - t0;
    const consultas = consultasSinteticas(corpus.vocab, 200);
    const total: number[] = [];
    const vetor: number[] = [];
    let maior = 0;
    let lentos = 0;
    for (const q of consultas) {
      const t = performance.now();
      const r = await svc.buscar({ consulta: q, modo: "hibrido", limite: 8, origem: "ui" });
      total.push(performance.now() - t);
      maior = Math.max(maior, JSON.stringify(r.resultados).length);
      if (r.estado === "lento") lentos++;
    }
    const { indice } = svc.indices.indice(svc.colecaoId, "hash-256-v1", 256);
    for (const q of consultas) {
      const v = embutirHash(q);
      const t = performance.now();
      indice.buscar(v, 100, null);
      vetor.push(performance.now() - t);
    }
    const p95 = percentil(total, 95);
    const p95v = percentil(vetor, 95);
    registrar({ id: "P-70", descricao: "busca híbrida (FTS5+vetor 256d+RRF+fatores+grafo), 50 000 chunks, p95", valor: p95, limite: 150, unidade: "ms", pior: Math.max(...total) });
    registrar({ id: "P-70b", descricao: "varredura vetorial exata 50 000×256, p95", valor: p95v, limite: 50, unidade: "ms", pior: Math.max(...vetor) });
    registrar({ id: "P-70c", descricao: "tamanho da resposta de busca (k=8)", valor: maior, limite: 8192, unidade: "B", semFator: true });
    registrar({ id: "P-70e", descricao: "consultas devolvidas como `lento` em 200 (deve ser ≤ 2%)", valor: lentos, limite: 4, unidade: "consultas", semFator: true });
    registrar({ id: "P-70d", descricao: "warm-up do índice exato 50 000×256 (informativo, segundo plano)", valor: aquecimentoMs, limite: 10_000, unidade: "ms" });
    expect(p95).toBeLessThanOrEqual(150 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
    expect(p95v).toBeLessThanOrEqual(50 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
    expect(maior).toBeLessThanOrEqual(8192);
  }, 300_000);
});

describe("P-71: contexto completo (rag_context) e embedding travado", () => {
  it("p95 ≤ 150 ms com índice aquecido; embedding travado devolve `lento` em ≤ 170 ms", async () => {
    const tarefas = consultasSinteticas(corpus.vocab, 100, 5).map((q) => `preciso implementar ${q} no módulo`);
    const tempos: number[] = [];
    for (const t of tarefas) {
      const a = performance.now();
      const r = await svc.contexto({ tarefa: t, arquivos: ["src/m3/arq3.ts"], mission_id: "mis_1", task_ref: "T-01.01" });
      tempos.push(performance.now() - a);
      expect(r.markdown).toContain("<conhecimento_previo");
    }
    const p95 = percentil(tempos, 95);
    registrar({ id: "P-71", descricao: "rag_context completo (derivar+híbrido+grafo 1 salto+envelope+redação), 50 000 chunks, p95", valor: p95, limite: 150, unidade: "ms", pior: Math.max(...tempos) });
    expect(p95).toBeLessThanOrEqual(150 * Number(process.env.EXPXV_PERF_FATOR ?? 1));

    // embedding travado: o modelo ativo "trava"; o piso lexical responde dentro do prazo
    const trava: ProvedorEmbedding = { id: "fake:trava:256", dimensao: 256, qualidade: 1, local: true, disponivel: async () => true, embutir: () => new Promise(() => undefined) };
    const reg = new RegistroEmbeddings();
    reg.registrar(trava);
    repos.banco.executar("INSERT INTO rag_colecao (id,escopo,workspace_id,nome,modelo_ativo,dimensao,metrica,versao_politica,criado_em,atualizado_em) VALUES ('col_trava','workspace','ws_trava','t','fake:trava:256',256,'cosseno',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')");
    const b = new Buscador({ repos, registro: reg, indices: new GerenciadorIndices(repos) });
    const lentos: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = performance.now();
      const r = await b.buscar({ colecao_id: "col_trava", consulta: "qualquer coisa", modo: "hibrido", prazoMs: 150 });
      lentos.push(performance.now() - a);
      expect(r.estado).toBe("lento");
    }
    registrar({ id: "P-71b", descricao: "consulta com embedding travado devolve `lento`, pior caso", valor: Math.max(...lentos), limite: 170, unidade: "ms" });
    expect(Math.max(...lentos)).toBeLessThanOrEqual(170 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
  }, 300_000);
});

describe("P-72: ingestão incremental de um evento", () => {
  it("≤ 50 ms p95 no worker (redigir+chunkar+FTS+vetor+grafo) e ≤ 1 ms só para enfileirar", async () => {
    const r = prng(1234);
    const tempos: number[] = [];
    for (let i = 0; i < 100; i++) {
      const texto = `# Relatório ${i}\n\n## Decisões\n\n- Adotar a estratégia ${corpus.vocab[Math.floor(r() * 100)]} no módulo ${i} (T-0${i % 9}.0${i % 7}).\n\n${Array.from({ length: 30 }, () => corpus.vocab[Math.floor(r() * 4000)]).join(" ")}\n\nVer src/m${i % 50}/arq${i}.ts.`;
      const doc: DocumentoEntrada = { tipo: "relatorio", origem: `docs/relatorios/perf-${i}.md`, titulo: `Relatório ${i}`, texto, formato: "markdown", fonte: "sistema", ocorrido_em: "2026-09-01T00:00:00.000Z", mission_id: "mis_1" };
      const a = performance.now();
      await svc.pipeline.ingerir(svc.colecaoId, doc);
      tempos.push(performance.now() - a);
    }
    const p95 = percentil(tempos, 95);
    registrar({ id: "P-72", descricao: "ingestão incremental de 1 evento (redigir+chunkar+FTS+vetor+grafo+aprendizado), 50 000 no banco, p95", valor: p95, limite: 50, unidade: "ms", pior: Math.max(...tempos) });
    const enf: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = performance.now();
      svc.registrarEntrada({ tipo: "user.note", workspace_id: "ws_perf", id: `n${i}`, titulo: `nota ${i}`, texto: `texto da nota ${i}`, ocorrido_em: "2026-09-01T00:00:00.000Z" });
      enf.push(performance.now() - a);
    }
    registrar({ id: "P-72b", descricao: "registrar (só enfileirar) por evento, média em rajada de 500", valor: enf.reduce((s, x) => s + x, 0) / enf.length, limite: 1, unidade: "ms", pior: Math.max(...enf) });
    expect(p95).toBeLessThanOrEqual(50 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
    expect(enf.reduce((s, x) => s + x, 0) / enf.length).toBeLessThanOrEqual(1 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
    await svc.processarFila(Infinity); // limpa a fila para as próximas medições
  }, 300_000);
});

describe("P-73: backfill inicial", () => {
  it("10 000 arquivos de código + 200 docs + 2 000 commits em fatias, ≤ 120 s", async () => {
    const { banco } = abrirBancoConhecimento(join(pasta, "backfill.db"));
    const s2 = new ServicoConhecimento({ banco, workspace_id: "ws_bf", nomeWorkspace: "bf", raiz: "/work/bf" });
    const r = prng(77);
    const palavra = (): string => corpus.vocab[Math.floor(r() * 4000)] as string;
    async function* codigo(): AsyncGenerator<DocumentoEntrada> {
      for (let i = 0; i < 10_000; i++) {
        const fn = `${palavra()}${palavra()}`;
        yield { tipo: "codigo", origem: `src/m${i % 100}/arq${i}.ts`, titulo: `arq${i}`, formato: "codigo", fonte: "sistema", ocorrido_em: "2026-08-01T00:00:00.000Z", linguagem: "ts", texto: `import { x } from "./arq${(i + 1) % 10_000}";\n\nexport function ${fn}(a: number) {\n  return a + ${i};\n}\n\nexport const ${palavra()}${i} = "${palavra()} ${palavra()} ${palavra()}";\n` };
      }
    }
    async function* docs(): AsyncGenerator<DocumentoEntrada> {
      for (let i = 0; i < 200; i++) yield { tipo: "doc", origem: `docs/guia${i}.md`, titulo: `guia${i}`, formato: "markdown", fonte: "sistema", ocorrido_em: "2026-08-01T00:00:00.000Z", texto: `# Guia ${i}\n\n${Array.from({ length: 120 }, palavra).join(" ")}\n\n## Detalhes\n\n${Array.from({ length: 120 }, palavra).join(" ")}` };
    }
    async function* commits(): AsyncGenerator<EntradaConhecimento> {
      for (let i = 0; i < 2000; i++) yield { tipo: "vcs.commit", workspace_id: "ws_bf", sha: (i + 0xabc000).toString(16).padStart(40, "0"), mensagem: `${i % 3 === 0 ? "fix" : "feat"}: ${palavra()} ${palavra()}`, autor: null, arquivos: [{ caminho: `src/m${i % 100}/arq${i}.ts`, status: "M", diff: `+${palavra()}\n-${palavra()}` }], ocorrido_em: "2026-08-01T00:00:00.000Z", mission_id: null };
    }
    const t0 = performance.now();
    const fatias: number[] = [];
    let ultimaFatia = performance.now();
    const res = await executarBackfill({
      pipeline: s2.pipeline,
      colecao_id: s2.colecaoId,
      fontes: { docs, commits, codigo },
      fatiaMs: 20,
      ceder: async () => {
        fatias.push(performance.now() - ultimaFatia);
        await new Promise((r2) => setImmediate(r2));
        ultimaFatia = performance.now();
      },
    });
    const seg = (performance.now() - t0) / 1000;
    registrar({ id: "P-73", descricao: "backfill (10 000 código + 200 docs + 2 000 commits), tempo total", valor: seg, limite: 120, unidade: "s" });
    const p95f = percentil(fatias, 95);
    registrar({ id: "P-73b", descricao: "backfill: fatia contínua de CPU entre cessões do laço (p95; meta 20 ms + 1 item)", valor: p95f, limite: 50, unidade: "ms", pior: res.maiorFatiaMs });
    expect(res.feitos).toBe(12_200);
    expect(seg).toBeLessThanOrEqual(120 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
    expect(p95f).toBeLessThanOrEqual(50 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
    s2.fechar();
    banco.fechar();
  }, 600_000);
});

describe("P-74 e P-78: embedding hash e footprint", () => {
  it("hash ≤ 1 ms por chunk de 1 200 caracteres", () => {
    const t = "implementação da rotina exportarCsv para pedidos ".repeat(25).slice(0, 1200);
    embutirHash(t);
    const a = performance.now();
    for (let i = 0; i < 500; i++) embutirHash(t);
    registrar({ id: "P-74", descricao: "embedding hash-256-v1 por chunk de 1 200 chars", valor: (performance.now() - a) / 500, limite: 1, unidade: "ms" });
    expect((performance.now() - a) / 500).toBeLessThanOrEqual(1 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
  });
  it("índice exato 50 000×256 ≤ 120 MB e banco ≤ 4 KB/chunk", () => {
    svc.aquecer(Infinity);
    const mb = svc.indices.bytes() / 1024 / 1024;
    repos.banco.executar("PRAGMA wal_checkpoint(TRUNCATE)");
    const kbPorChunk = statSync(caminho).size / svc.estado().chunks / 1024;
    registrar({ id: "P-78", descricao: "RAM do índice exato (50 000×256 f32)", valor: mb, limite: 120, unidade: "MB", semFator: true });
    registrar({ id: "P-78b", descricao: "tamanho do conhecimento.db por chunk (com FTS e vetor)", valor: kbPorChunk, limite: 4, unidade: "KB", semFator: true });
    expect(mb).toBeLessThanOrEqual(120);
    expect(kbPorChunk).toBeLessThanOrEqual(4);
  });
});

describe("P-81: consolidação e reembutir sem atrasar a consulta", () => {
  it("consolidação ≤ 60 s e P-70 mantido durante o reembutir", async () => {
    const t0 = performance.now();
    consolidar(repos, svc.colecaoId, Date.now());
    const seg = (performance.now() - t0) / 1000;
    registrar({ id: "P-81", descricao: "consolidação (fundir, arquivar, pesos, FTS optimize) com 50 000 chunks", valor: seg, limite: 60, unidade: "s" });
    expect(seg).toBeLessThanOrEqual(60 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
    // reembutir uma fatia entre consultas (novo modelo falso de 8 d, lote pequeno)
    const novo: ProvedorEmbedding = { id: "fake:novo:8", dimensao: 8, qualidade: 1, local: true, disponivel: async () => true, embutir: async (ts) => ts.map((t) => normalizarL2(Array.from({ length: 8 }, (_, i) => (t.charCodeAt(i % Math.max(1, t.length)) % 9) + 1))) };
    const tempos: number[] = [];
    const fatias: number[] = [];
    for (const q of consultasSinteticas(corpus.vocab, 60, 11)) {
      const f = performance.now();
      await reembutirFatia({ repos, colecao_id: svc.colecaoId, provedor: novo, lote: 16, orcamentoMs: 20, medir: false });
      fatias.push(performance.now() - f);
      const a = performance.now();
      await svc.buscar({ consulta: q, modo: "hibrido", limite: 8 });
      tempos.push(performance.now() - a);
    }
    registrar({ id: "P-81b", descricao: "consulta híbrida intercalada com reembutir (p95)", valor: percentil(tempos, 95), limite: 150, unidade: "ms" });
    registrar({ id: "P-81c", descricao: "fatia de reembutir (p95)", valor: percentil(fatias, 95), limite: 50, unidade: "ms" });
    expect(percentil(tempos, 95)).toBeLessThanOrEqual(150 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
  }, 300_000);
});

describe("P-83: exato f32 × int8 (informativo + paridade)", () => {
  it("mede a varredura em 10 k/50 k/100 k × 256/384 d e a paridade top-10", () => {
    const r = prng(5);
    const linhas: Array<{ n: number; dim: number; f32_ms: number; int8_ms: number }> = [];
    for (const dim of [256, 384]) {
      for (const n of [10_000, 50_000, 100_000]) {
        const f = new IndiceExato(dim, n);
        const q8 = new IndiceExatoInt8(dim, n);
        for (let i = 0; i < n; i++) {
          const v = vetorAleatorio(r, dim);
          f.upsert(`i${i}`, v);
          q8.upsert(`i${i}`, v);
        }
        const q = vetorAleatorio(r, dim);
        f.buscar(q, 10);
        q8.buscar(q, 10);
        const a = performance.now();
        for (let i = 0; i < 5; i++) f.buscar(q, 10);
        const b = performance.now();
        for (let i = 0; i < 5; i++) q8.buscar(q, 10);
        linhas.push({ n, dim, f32_ms: (b - a) / 5, int8_ms: (performance.now() - b) / 5 });
        f.liberar();
        q8.liberar();
      }
    }
    for (const l of linhas) registrar({ id: `P-83-${l.n / 1000}k-${l.dim}`, descricao: `varredura exata ${l.n}×${l.dim}: f32 ${l.f32_ms.toFixed(1)} ms · int8 ${l.int8_ms.toFixed(1)} ms (informativo)`, valor: Math.min(l.f32_ms, l.int8_ms), limite: 1000, unidade: "ms" });
    // paridade top-10 int8 × f32 em vetores de TEXTO real (hash-256-v1)
    const textos = Array.from({ length: 5000 }, (_, i) => `${corpus.vocab[i % 4000]} ${corpus.vocab[(i * 7) % 4000]} ${corpus.vocab[(i * 13) % 4000]} módulo ${i}`);
    const todos = new Map<string, Float32Array>();
    const f = new IndiceExato(256, 5000);
    const q8 = new IndiceExatoInt8(256, 5000, (ids) => new Map(ids.map((i) => [i, todos.get(i) as Float32Array])));
    const q8puro = new IndiceExatoInt8(256, 5000);
    textos.forEach((t, i) => {
      const v = embutirHash(t);
      todos.set(`t${i}`, v);
      f.upsert(`t${i}`, v);
      q8.upsert(`t${i}`, v);
      q8puro.upsert(`t${i}`, v);
    });
    let comunsPuro = 0;
    let comuns = 0;
    const qs = 100;
    for (let i = 0; i < qs; i++) {
      const q = embutirHash(textos[(i * 37) % 5000] as string);
      const a = new Set(f.buscar(q, 10).map((x) => x.id));
      comuns += q8.buscar(q, 10).filter((x) => a.has(x.id)).length;
      comunsPuro += q8puro.buscar(q, 10).filter((x) => a.has(x.id)).length;
    }
    registrar({ id: "P-83q", descricao: "paridade top-10 do int8 SEM reranqueio (informativo; texto real quase empatado)", valor: (comunsPuro / (qs * 10)) * 100, limite: 90, unidade: "%", sentido: "min", semFator: true });
    const paridade = (comuns / (qs * 10)) * 100;
    registrar({ id: "P-83p", descricao: "paridade top-10 do int8 + reranqueio exato do topo contra o f32 (texto real, hash-256-v1)", valor: paridade, limite: 99, unidade: "%", sentido: "min", semFator: true });
    expect(paridade).toBeGreaterThanOrEqual(99);
  }, 300_000);
});
