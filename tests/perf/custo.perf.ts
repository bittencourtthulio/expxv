// Orçamentos de custo e board (Fase 10; núcleo sem Electron, banco real em memória): P-113 (parte do main: lote de ingestão), P-115 (consultas materializadas),
// P-116 (`montarBoard`) e P-117 (reindexar e memória). A leitura de 50 MB de transcript no worker (P-113 completo), o P-114 (UI) e o P-116 de renderização
// dependem dos leitores/telas das ondas seguintes e ficam FORA daqui, sem inventar valor.
import { appendFileSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterAll, describe, expect, it } from "vitest";
import { abrirBanco, migrar } from "../../src/nucleo/banco";
import { criarRepositorios } from "../../src/nucleo/banco/repos";
import { montarBoard } from "../../src/nucleo/board";
import { criarServicoCusto } from "../../src/nucleo/custo";
import { gerarRegistros, gerarVolumeBoard, WS } from "../fixtures/custo/gerar";
import { fabricaClaude, lerLotes } from "../../src/nucleo/custo/leitores";
import { lerLotesOpenCode, localizarSessaoOpenCode } from "../../src/nucleo/custo/leitores/opencode";
import { criarOpenCodeDb, dataAssistente, inserirSessao } from "../fixtures/custo/opencode-db";
import { gerarTranscriptClaudeGrande, linhaClaude } from "../fixtures/custo/transcripts";
import { mundoIngestao } from "../fixtures/custo/mundo-ingestao";
import { fatorPerf, gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());
const mediana = (xs: number[]): number => percentil(xs, 50);
const fatorDeTeste = (): number => fatorPerf();
const AGORA = new Date("2026-07-01T00:00:00.000Z");
const N = 100_000;
const LOTE = 500;
/** `gc()` sem `--expose-gc`: liga a flag em tempo de execução e pega a função por um contexto novo. */
function coletarLixo(): void {
  try {
    setFlagsFromString("--expose-gc");
    (runInNewContext("gc") as () => void)();
  } catch {
    /* sem gc a medição de memória fica mais ruidosa, nunca falsa-verde: o valor é o heap vivo no momento */
  }
}

function mundo() {
  const banco = abrirBanco(":memory:");
  migrar(banco);
  const r = criarRepositorios(banco);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const conta = r.conta.criar({ provedor: "claude", rotulo: "c" });
  const mis = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M", trabalho_id: "w1" });
  const panes = Array.from({ length: 4 }, (_, i) => r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", conta_id: conta.id, papel: i === 0 ? "piloto" : "executor" }));
  const s = criarServicoCusto({ banco, relogio: () => AGORA });
  s.iniciarPrecos();
  const fontes = panes.map((p, i) => s.registrarFonte({ cli: "claude", base: "claude_config", relativo: `projects/p/s${i}.jsonl`, pane_id: p.id, mission_id: mis.id, workspace_id: ws.id, conta_id: conta.id }));
  return { banco, s, ws, mis, panes, fontes, conta };
}

describe("P-113 (lote no main) e P-115/P-117 sobre 100 000 registros", () => {
  const m = mundo();
  const tempos: number[] = [];
  it("ingere 100 000 registros em lotes de 500 (cada lote = 1 transação curta)", () => {
    const todos = gerarRegistros(N, 11, "2026-06-05T00:00:00.000Z");
    const t0 = performance.now();
    for (let i = 0; i < N; i += LOTE) {
      const t = performance.now();
      m.s.ingerir((m.fontes[(i / LOTE) % 4] as { id: string }).id, todos.slice(i, i + LOTE));
      tempos.push(performance.now() - t);
    }
    const total = performance.now() - t0;
    registrar({ id: "P-113a", descricao: "Ingestão: transação de 1 lote de 500 registros (preço + atribuição + agregados), mediana", valor: mediana(tempos), limite: 5, unidade: "ms", pior: Math.max(...tempos) });
    registrar({ id: "P-113b", descricao: "Ingestão: lote mais lento de 500 (nunca bloqueia o main > 50 ms)", valor: Math.max(...tempos), limite: 50, unidade: "ms" });
    registrar({ id: "P-113c", descricao: "Ingestão de 100 000 registros (núcleo, sem leitura de arquivo)", valor: total, limite: 1500, unidade: "ms" });
    expect(m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n).toBe(N);
  });
  it("P-115: consulta materializada (Missão, card, workspace) ≤ 5 ms", () => {
    const t: number[] = [];
    for (let i = 0; i < 60; i++) {
      const a = performance.now();
      m.s.resumoMissao(m.mis.id);
      m.s.resumo("workspace", m.ws.id);
      m.s.resumo("pane", (m.panes[1] as { id: string }).id);
      t.push((performance.now() - a) / 3);
    }
    registrar({ id: "P-115a", descricao: "Consulta materializada de custo (Missão/workspace/Pane) sobre 100 000 registros, mediana", valor: mediana(t), limite: 5, unidade: "ms", pior: Math.max(...t) });
    expect(m.s.resumoMissao(m.mis.id).registros).toBe(N);
  });
  it("P-115: relatório agrupado de 30 dias ≤ 30 ms", () => {
    const t: number[] = [];
    for (const agrupar of ["modelo", "dia", "pane", "missao"] as const) {
      for (let i = 0; i < 8; i++) {
        const a = performance.now();
        m.s.relatorio({ agrupar, desde: "2026-06-01", ate: "2026-06-30" });
        t.push(performance.now() - a);
      }
    }
    registrar({ id: "P-115b", descricao: "Relatório agrupado de 30 dias sobre 100 000 registros (modelo/dia/Pane/Missão), mediana", valor: mediana(t), limite: 30, unidade: "ms", pior: Math.max(...t) });
  });
  it("P-115: relatório com filtro cruzado (cai no bruto indexado) é medido à parte", () => {
    const t: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = performance.now();
      m.s.relatorio({ agrupar: "pane", desde: "2026-06-01", ate: "2026-06-30", filtros: { mission_id: m.mis.id } });
      t.push(performance.now() - a);
    }
    registrar({ id: "P-115c", descricao: "Relatório de 30 dias com filtro cruzado (agrega o bruto) sobre 100 000 registros, mediana", valor: mediana(t), limite: 150, unidade: "ms", pior: Math.max(...t) });
  });
  it("P-117: reindexar 30 dias ≤ 10 s e memória dos caches do main ≤ 20 MB", () => {
    coletarLixo();
    const antes = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const r = m.s.reindexar();
    const dur = performance.now() - t0;
    coletarLixo();
    registrar({ id: "P-117a", descricao: "Reindexar 100 000 registros (30 dias) a partir dos brutos", valor: dur, limite: 10_000, unidade: "ms" });
    const depois = process.memoryUsage().heapUsed;
    registrar({ id: "P-117b", descricao: "Heap VIVO retido pelo serviço de custo após reindexar 100 000 registros e coletar lixo (brutos ficam no SQLite)", valor: Math.max(0, depois - antes) / 1e6, limite: 20, unidade: "MB" });
    expect(r.registros).toBe(N);
  });
});

describe("P-116: montarBoard com 1 000 cards", () => {
  it("≤ 15 ms (mediana de 25) e o resultado não depende da ordem de entrada", () => {
    const { trabalhos, tasksBanco, custos } = gerarVolumeBoard(40, 25);
    const entrada = { trabalhos, tasksBanco, panes: new Map(), custos, filtros: { workspace_id: WS }, agora: "2026-07-01T00:00:00.000Z", versao: 1 };
    const t: number[] = [];
    let ultimo = montarBoard(entrada);
    for (let i = 0; i < 25; i++) {
      const a = performance.now();
      ultimo = montarBoard(entrada);
      t.push(performance.now() - a);
    }
    registrar({ id: "P-116a", descricao: "montarBoard com 1 000 cards (40 trabalhos × 25 tasks), mediana", valor: mediana(t), limite: 15, unidade: "ms", pior: Math.max(...t) });
    const permutado = montarBoard({ ...entrada, trabalhos: [...trabalhos].reverse(), tasksBanco: [...tasksBanco].reverse() });
    expect(permutado.colunas).toEqual(ultimo.colunas);
    expect(ultimo.progresso.total).toBe(1000);
  });
});

// ---------------------------------------------------------------- P-113 completo (leitura de 50 MB no worker) e P-114 (transcript → banco)
describe("P-113: ingestão inicial de 50 MB de transcript pelo worker", () => {
  it("≤ 1,5 s no worker, main nunca > 50 ms, leitor ≤ 60 MB acima da base", async () => {
    const mundo = mundoIngestao();
    try {
      const rel = "projects/p/grande.jsonl";
      const abs = mundo.escrever(rel, "");
      const gerado = await gerarTranscriptClaudeGrande(abs, 50 * 1024 * 1024);
      const f = mundo.fonteClaude(rel);
      // aquecimento: sobe a thread (o custo de subir o worker e de transpilar o .ts do teste não é de ingestão; no pacote o worker já é .js)
      const aq = mundo.fonteClaude("projects/p/aquecimento.jsonl");
      mundo.escrever("projects/p/aquecimento.jsonl", `${linhaClaude({ id: "aq", ts: "2026-06-01T00:00:00.000Z" })}\n`);
      mundo.ing.observar(aq.id);
      await mundo.ing.drenar(aq.id);

      const h = monitorEventLoopDelay({ resolution: 1 });
      h.enable();
      mundo.ing.observar(f.id);
      const t0 = performance.now();
      await mundo.ing.drenar(f.id);
      const dur = performance.now() - t0;
      h.disable();
      const registros = mundo.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro WHERE fonte_id = ?", [f.id])?.n ?? 0;
      expect(registros).toBe(gerado.mensagens); // 3 linhas por mensagem ⇒ contada UMA vez
      expect(mundo.s.resumo("pane", mundo.pane.id).tokens.entrada).toBe(gerado.entradaTotal + 100);
      const mb = Math.round(gerado.linhas);
      const bloqueioMain = Math.max(h.max / 1e6 - 1, 0); // resolução 1 ms: desconta o próprio passo do timer
      registrar({ id: "P-113d", descricao: `Ingestão inicial de 50 MB de transcript (${mb} linhas, ${gerado.mensagens} mensagens) no worker, fim a fim (leitura + gravação)`, valor: dur, limite: 1500, unidade: "ms" });
      registrar({ id: "P-113e", descricao: "Maior pausa do event loop do main durante a ingestão de 50 MB (lote de 500 = 1 transação)", valor: bloqueioMain, limite: 50, unidade: "ms" });
      registrar({ id: "P-113f", descricao: "Maior lote gravado no main durante a ingestão de 50 MB", valor: mundo.ing.stats.maiorLoteMs, limite: 50, unidade: "ms" });
      expect(dur).toBeLessThanOrEqual(1500 * fatorDeTeste());
      expect(bloqueioMain).toBeLessThanOrEqual(50 * fatorDeTeste());
    } finally {
      await mundo.fechar();
    }
  }, 60_000);

  it("leitor: memória estável (pico ≤ 60 MB acima da base) lendo 50 MB por linha", async () => {
    const mundo = mundoIngestao();
    try {
      const abs = mundo.escrever("projects/p/g2.jsonl", "");
      await gerarTranscriptClaudeGrande(abs, 50 * 1024 * 1024);
      coletarLixo();
      const base = process.memoryUsage();
      const medida = (): number => {
        const u = process.memoryUsage();
        return u.heapUsed + u.arrayBuffers - (base.heapUsed + base.arrayBuffers);
      };
      let pico = 0;
      let n = 0;
      for await (const lote of lerLotes({ caminho: abs, offset: 0, fabrica: fabricaClaude })) {
        n += lote.registros.length; // descartado a cada lote: nada acumula
        pico = Math.max(pico, medida());
      }
      expect(n).toBeGreaterThan(10_000);
      const r = registrar({ id: "P-113g", descricao: "Leitor de transcript: pico de memória (heap + buffers) acima da base lendo 50 MB por linha", valor: pico / 1e6, limite: 60, unidade: "MB" });
      expect(r.ok).toBe(true);
    } finally {
      await mundo.fechar();
    }
  }, 60_000);
});

describe("P-114: linha nova no transcript → custo atualizado no banco", () => {
  it("≤ 700 ms (watch + debounce 300 ms + worker + gravação) e ≤ 1 releitura por fonte a cada 2 s", async () => {
    const mundo = mundoIngestao();
    try {
      const rel = "projects/p/vivo.jsonl";
      const abs = mundo.escrever(rel, `${linhaClaude({ id: "m0", ts: "2026-06-01T00:00:00.000Z" })}\n`);
      const f = mundo.fonteClaude(rel);
      mundo.ing.observar(f.id);
      await new Promise((r) => setTimeout(r, 400));
      await mundo.ing.drenar(f.id); // worker aquecido e backlog lido
      await new Promise((r) => setTimeout(r, 2100)); // fonte ociosa: o intervalo mínimo de 2 s já passou
      const lat: number[] = [];
      for (let i = 1; i <= 3; i++) {
        const antes = mundo.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n ?? 0;
        const t0 = performance.now();
        appendFileSync(abs, `${linhaClaude({ id: `m${i}`, ts: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString() })}\n`);
        while ((mundo.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n ?? 0) === antes && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 5));
        lat.push(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 2100));
      }
      registrar({ id: "P-114a", descricao: "Linha nova no transcript até o registro e os agregados no banco (watch real + debounce 300 ms + worker), mediana de 3", valor: mediana(lat), limite: 700, unidade: "ms", pior: Math.max(...lat) });
      expect(mediana(lat)).toBeLessThanOrEqual(700 * fatorDeTeste());

      // rajada: 20 toques em 1,5 s ⇒ no máximo 1 releitura nova (o intervalo mínimo é 2 s por fonte)
      const l0 = mundo.ing.stats.leituras;
      for (let i = 10; i < 30; i++) {
        appendFileSync(abs, `${linhaClaude({ id: `m${i}`, ts: new Date(Date.UTC(2026, 5, 1, 0, 1, i)).toISOString() })}\n`);
        await new Promise((r) => setTimeout(r, 75));
      }
      const leituras = mundo.ing.stats.leituras - l0;
      registrar({ id: "P-114b", descricao: "Releituras da mesma fonte durante uma rajada de 20 linhas em 1,5 s (máx. 1 a cada 2 s)", valor: leituras, limite: 1, unidade: "leituras" });
      expect(leituras).toBeLessThanOrEqual(1);
    } finally {
      await mundo.fechar();
    }
  }, 60_000);
});

describe("P-82: leitor do OpenCode sobre um opencode.db GRANDE (somente leitura, sem varredura)", () => {
  it("base sintética de ~200 MB: localizar a sessão, ler o 1º lote e o incremental custam ms e poucos MB (a base não é carregada)", async () => {
    const { mkdtempSync, rmSync, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "oc-perf-"));
    const caminho = join(dir, "opencode.db");
    try {
      const db = criarOpenCodeDb(caminho);
      const SESSOES = 400;
      const POR_SESSAO = 800;
      const enchimento = "x".repeat(320); // o `data` real tem metadados do provedor; só o tamanho importa aqui
      const ins = db.prepare("INSERT INTO message (id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?)");
      db.exec("BEGIN");
      for (let s = 0; s < SESSOES; s++) {
        inserirSessao(db, `ses_P${String(s).padStart(8, "0")}`, `/w/p${s % 20}`, 1_000 + s);
        for (let i = 0; i < POR_SESSAO; i++) {
          const t = 1_000_000 + s * 10_000 + i;
          ins.run(`msg_${s}_${i}`, `ses_P${String(s).padStart(8, "0")}`, t, t, JSON.stringify(dataAssistente(t, { enchimento })));
        }
      }
      db.exec("COMMIT");
      db.close();
      const mb = statSync(caminho).size / 1e6;
      expect(mb).toBeGreaterThan(100);

      coletarLixo();
      const antes = process.memoryUsage();
      const alvo = `ses_P${String(SESSOES - 1).padStart(8, "0")}`;
      const t0 = performance.now();
      const achada = localizarSessaoOpenCode({ caminho, conversa: null, cwd: `/w/p${(SESSOES - 1) % 20}`, desdeMs: 1_000 });
      const tLoc = performance.now() - t0;
      expect(achada).toBe(alvo);
      const t1 = performance.now();
      let n = 0;
      let cursor = 0;
      let primeiro = -1;
      for await (const lote of lerLotesOpenCode({ caminho, sessao: alvo, offset: 0, agoraMs: 9e12 })) {
        if (primeiro < 0) primeiro = performance.now() - t1;
        n += lote.registros.length;
        cursor = lote.offset;
      }
      const tLeitura = performance.now() - t1;
      expect(n).toBe(POR_SESSAO);
      const t2 = performance.now();
      let n2 = 0;
      for await (const lote of lerLotesOpenCode({ caminho, sessao: alvo, offset: cursor, agoraMs: 9e12 })) n2 += lote.registros.length;
      const tIncr = performance.now() - t2;
      expect(n2).toBe(1); // só a borda
      const depois = process.memoryUsage();
      const crescimento = (depois.rss + depois.arrayBuffers - antes.rss - antes.arrayBuffers) / 1e6;
      registrar({ id: "P-82a", descricao: `OpenCode: localizar a sessão em opencode.db de ${Math.round(mb)} MB (rowid recente, sem varredura)`, valor: tLoc, limite: 200, unidade: "ms" });
      registrar({ id: "P-82b", descricao: `OpenCode: 1º lote (500) de uma sessão em ${Math.round(mb)} MB`, valor: primeiro, limite: 200, unidade: "ms" });
      registrar({ id: "P-82c", descricao: "OpenCode: leitura incremental (só a borda) depois do cursor", valor: tIncr, limite: 100, unidade: "ms" });
      registrar({ id: "P-82d", descricao: "OpenCode: crescimento de RSS + buffers lendo a sessão (a base não é carregada)", valor: Math.max(0, crescimento), limite: 60, unidade: "MB" });
      expect(tLeitura).toBeLessThan(2000 * fatorDeTeste());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
