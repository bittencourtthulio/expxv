import { appendFileSync, truncateSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { linhaClaude, linhaTokenCount, linhaTurnContext, SENTINELAS } from "../../../tests/fixtures/custo/transcripts";
import { mundoIngestao, novoWorkerReal } from "../../../tests/fixtures/custo/mundo-ingestao";
import type { ProcessoLeitor } from "./ingestao";

const T = (s: number): string => new Date(Date.UTC(2026, 5, 1, 0, 0, s)).toISOString();
const msgs = (n: number, de = 0): string => Array.from({ length: n }, (_, i) => linhaClaude({ id: `m${de + i}`, ts: T(de + i), entrada: 100, saida: 10 })).join("\n") + "\n";
const abertos: Array<{ fechar(): Promise<void> }> = [];
afterEach(async () => {
  for (const m of abertos.splice(0)) await m.fechar();
});
const novo = (extra: Parameters<typeof mundoIngestao>[0] = {}) => {
  const m = mundoIngestao(extra);
  abertos.push(m);
  return m;
};
const registros = (m: ReturnType<typeof novo>): number => m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n ?? 0;

describe("ingestão incremental (T-10.07)", () => {
  it("lê o transcript pelo worker, grava registros + agregados e guarda o offset", async () => {
    const m = novo();
    const abs = m.escrever("projects/p/s1.jsonl", msgs(5) + linhaClaude({ id: "m0", ts: T(0), entrada: 100, saida: 10 }) + "\n");
    const f = m.fonteClaude();
    m.ing.observar(f.id);
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(5);
    const c = m.s.resumo("pane", m.pane.id);
    expect(c.tokens.entrada).toBe(500);
    expect(c.registros).toBe(5);
    const depois = m.s.repo.fontes.obter(f.id);
    expect(depois?.offset).toBe(Buffer.byteLength(require("node:fs").readFileSync(abs)));
    expect(depois?.estado).toBe("lendo");
  });
  it("incremental: o que chega depois é lido a partir do offset; reler do zero não duplica", async () => {
    const m = novo();
    const abs = m.escrever("projects/p/s1.jsonl", msgs(3));
    const f = m.fonteClaude();
    m.ing.observar(f.id);
    await m.ing.drenar(f.id);
    appendFileSync(abs, msgs(2, 3));
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(5);
    m.s.repo.fontes.atualizar(f.id, { offset: 0 });
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(5);
    expect(m.s.resumo("pane", m.pane.id).tokens.entrada).toBe(500);
  });
  it("arquivo truncado/rotacionado não duplica o que já existia", async () => {
    const m = novo();
    const abs = m.escrever("projects/p/s1.jsonl", msgs(4));
    const f = m.fonteClaude();
    m.ing.observar(f.id);
    await m.ing.drenar(f.id);
    truncateSync(abs, 0);
    writeFileSync(abs, msgs(2, 2) + msgs(1, 10));
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(5); // m0..m3 + m10 (m2/m3 já existiam)
  });
  it("Codex: deltas por total acumulado; reinício do app (sem estado) relê e não duplica", async () => {
    const m = novo();
    m.escrever("sessions/2026/09/27/rollout-x.jsonl", [linhaTurnContext(T(0), "gpt-6-astra"), linhaTokenCount(T(1), 1, { input: 1000, cached: 400, output: 50 }), linhaTokenCount(T(2), 2, { input: 1000, cached: 400, output: 50 }), linhaTokenCount(T(3), 3, { input: 1600, cached: 900, output: 90 })].join("\n") + "\n", "codex");
    const f = m.s.registrarFonte({ cli: "codex", base: "codex_home", relativo: "sessions/2026/09/27/rollout-x.jsonl", conta_id: m.conta.id, pane_id: m.codexPane.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    m.ing.observar(f.id);
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(2);
    const c = m.s.resumo("pane", m.codexPane.id);
    expect(c.tokens).toEqual({ entrada: 700, cache_escrita: 0, cache_leitura: 900, saida: 90 });
    m.ing.reiniciarEstado();
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(2);
  });
  it("matar o worker no meio e religar não duplica nem perde registros", async () => {
    // worker que morre ao receber o primeiro `continuar` (depois do 1º lote)
    let matou = false;
    const m = novo({
      criarWorker: (): ProcessoLeitor => {
        const w = novoWorkerReal();
        const post = w.postMessage.bind(w);
        w.postMessage = (msg) => {
          if (!matou && msg.tipo === "continuar") {
            matou = true;
            void w.terminate();
            return;
          }
          post(msg);
        };
        return w;
      },
    });
    m.escrever("projects/p/s1.jsonl", msgs(1300));
    const f = m.fonteClaude();
    m.ing.observar(f.id);
    await m.ing.drenar(f.id);
    expect(matou).toBe(true);
    // sob carga o vigia de arquivo pode pedir uma nova leitura logo após a queda (e ela já completa tudo): o estado intermediário não é determinístico,
    // o que importa é o final — nenhum registro perdido nem duplicado
    expect(registros(m)).toBeGreaterThanOrEqual(500);
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(1300);
    expect(m.s.repo.fontes.obter(f.id)?.erro_codigo).toBeNull();
    expect(m.s.resumo("pane", m.pane.id).tokens.entrada).toBe(130_000);
  });
  it("ler_transcripts:false não lê nada e mantém o que existe", async () => {
    let ligado = true;
    const m = novo({ lerTranscripts: () => ligado });
    m.escrever("projects/p/s1.jsonl", msgs(3));
    const f = m.fonteClaude();
    m.ing.observar(f.id);
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(3);
    ligado = false;
    appendFileSync(m.fontes.resolver(f) as string, msgs(2, 3));
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(3);
  });
  it("arquivo ausente vira erro nominal na fonte (nunca lança)", async () => {
    const m = novo();
    const f = m.fonteClaude("projects/p/nao-existe.jsonl");
    m.ing.observar(f.id);
    await m.ing.drenar(f.id);
    expect(m.s.repo.fontes.obter(f.id)).toMatchObject({ estado: "erro", erro_codigo: "arquivo_ausente" });
  });
  it("privacidade: nenhuma sentinela de conteúdo no banco inteiro, no diagnóstico nem nas estatísticas", async () => {
    const m = novo();
    m.escrever("projects/p/s1.jsonl", msgs(3));
    const f = m.fonteClaude();
    m.ing.observar(f.id);
    await m.ing.drenar(f.id);
    const tabelas = m.banco.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    let tudo = m.s.diagnostico() + JSON.stringify(m.ing.stats);
    for (const t of tabelas) tudo += JSON.stringify(m.banco.consultar(`SELECT * FROM "${t.name}"`));
    for (const s of SENTINELAS) expect(tudo).not.toContain(s);
    expect(tudo).not.toContain(m.base);
  });
});

describe("agenda: debounce, foco e 1 releitura / 2 s", () => {
  function relogio() {
    let t = 1_000_000;
    const tarefas: Array<{ em: number; fn: () => void; ativa: boolean }> = [];
    return {
      agora: () => t,
      agendar: (fn: () => void, ms: number) => {
        const x = { em: t + ms, fn, ativa: true };
        tarefas.push(x);
        return () => void (x.ativa = false);
      },
      avancar(ms: number) {
        t += ms;
        for (const x of tarefas) if (x.ativa && x.em <= t) (x.ativa = false), x.fn();
      },
      pendentes: () => tarefas.filter((x) => x.ativa),
      ultimaEspera: () => (tarefas.length === 0 ? null : (tarefas[tarefas.length - 1] as { em: number }).em - t),
    };
  }
  const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  it("500 toques = 1 leitura agendada a 300 ms; sem foco só drena na volta", async () => {
    const rel = relogio();
    let foco = false;
    const m = novo({ agora: rel.agora, agendar: rel.agendar, vigiar: () => () => undefined, emFoco: () => foco });
    m.escrever("projects/p/s1.jsonl", msgs(2));
    const f = m.fonteClaude();
    m.ing.observar(f.id);
    expect(rel.pendentes().length).toBe(0); // sem foco: nada agendado
    foco = true;
    m.ing.aoFocar();
    for (let i = 0; i < 500; i++) m.ing.tocar(f.id);
    const ag = rel.pendentes().filter((p) => p.em - rel.agora() <= 300);
    expect(ag.length).toBe(1);
    rel.avancar(300);
    for (let i = 0; i < 100 && m.ing.stats.leituras === 0; i++) await pausa(20);
    await m.ing.drenar(f.id);
    expect(registros(m)).toBe(2);
    // nova atividade logo depois: a próxima leitura respeita ≥ 2 s desde a última
    appendFileSync(m.fontes.resolver(f) as string, msgs(1, 2));
    m.ing.tocar(f.id);
    const espera = rel.ultimaEspera() as number;
    expect(espera).toBeGreaterThanOrEqual(1500);
    expect(espera).toBeLessThanOrEqual(2000);
  });
});
