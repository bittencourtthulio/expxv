import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RegistroExtraido } from "../../../compartilhado/custo";
import { linhaClaude, linhaTokenCount, linhaTurnContext, linhaUsuario, SENTINELAS } from "../../../../tests/fixtures/custo/transcripts";
import { extrairClaude, fabricaClaude, fabricaCodex, lerLotes, LINHA_MAX_BYTES, type LoteLido } from "./index";
import { extrairOpenCode, lerSessaoOpenCode } from "./opencode";

const pastas: string[] = [];
const tmp = (): string => {
  const p = mkdtempSync(join(tmpdir(), "custo-leitor-"));
  pastas.push(p);
  return p;
};
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});
async function tudo(p: Parameters<typeof lerLotes>[0]): Promise<{ regs: RegistroExtraido[]; ultimo: LoteLido; lotes: number; puladas: number }> {
  const regs: RegistroExtraido[] = [];
  let ultimo: LoteLido | null = null;
  let lotes = 0;
  let puladas = 0;
  for await (const l of lerLotes(p)) {
    regs.push(...l.registros);
    ultimo = l;
    lotes++;
    puladas += l.puladas;
  }
  return { regs, ultimo: ultimo as LoteLido, lotes, puladas };
}
const T = (s: number): string => new Date(Date.UTC(2026, 5, 1, 0, 0, s)).toISOString();

describe("leitor do Claude (CT-10.01)", () => {
  it("a mesma message.id em 3 linhas conta UMA vez (maior valor) e relê idempotente", async () => {
    const dir = tmp();
    const f = join(dir, "t.jsonl");
    const linhas = [linhaUsuario(T(0)), linhaClaude({ id: "m1", ts: T(1), entrada: 10, saida: 1 }), linhaClaude({ id: "m1", ts: T(1), entrada: 10, saida: 7 }), linhaClaude({ id: "m1", ts: T(1), entrada: 10, saida: 7 }), linhaClaude({ id: "m2", ts: T(2), entrada: 5, saida: 2, cache_leitura: 100, cache_escrita: 3 })];
    writeFileSync(f, linhas.join("\n") + "\n");
    const a = await tudo({ caminho: f, offset: 0, fabrica: fabricaClaude });
    expect(a.regs.map((r) => r.chave)).toEqual(["m1", "m2"]);
    expect(a.regs[0]?.tokens).toEqual({ entrada: 10, cache_escrita: 0, cache_leitura: 0, saida: 7 });
    expect(a.regs[1]?.tokens).toEqual({ entrada: 5, cache_escrita: 3, cache_leitura: 100, saida: 2 });
    const b = await tudo({ caminho: f, offset: 0, fabrica: fabricaClaude });
    expect(b.regs).toEqual(a.regs);
  });
  it("só {chave, ts, modelo, tokens, usd_medido?} sai: nenhuma sentinela de conteúdo atravessa", async () => {
    const dir = tmp();
    const f = join(dir, "t.jsonl");
    writeFileSync(f, [linhaClaude({ id: "m1", ts: T(1), costUSD: 0.5 }), linhaClaude({ id: "m2", ts: T(2), modelo: null })].join("\n") + "\n");
    const r = await tudo({ caminho: f, offset: 0, fabrica: fabricaClaude });
    for (const x of r.regs) expect(Object.keys(x).sort()).toEqual(x.usd_medido === undefined ? ["chave", "modelo", "tokens", "ts"] : ["chave", "modelo", "tokens", "ts", "usd_medido"]);
    const json = JSON.stringify(r);
    for (const s of SENTINELAS) expect(json).not.toContain(s);
    expect(r.regs[0]?.usd_medido).toBe(0.5);
    expect(r.regs[1]?.modelo).toBeNull();
  });
  it("sem usage, sintética, zerada, JSON quebrado e tipo errado são ignoradas sem lançar", async () => {
    const dir = tmp();
    const f = join(dir, "t.jsonl");
    writeFileSync(f, [linhaClaude({ id: "a", ts: T(1), semUsage: true }), linhaClaude({ id: "b", ts: T(1), modelo: "<synthetic>" }), linhaClaude({ id: "c", ts: T(1), entrada: 0, saida: 0 }), '{"type":"assistant","message":{"usage":', "lixo", '{"type":"assistant","timestamp":"x","message":{"id":"d","usage":{"input_tokens":1}}}', linhaClaude({ id: "ok", ts: T(3) })].join("\n") + "\n");
    const r = await tudo({ caminho: f, offset: 0, fabrica: fabricaClaude });
    expect(r.regs.map((x) => x.chave)).toEqual(["ok"]);
    expect(extrairClaude(Buffer.from("[]"))).toBeNull();
  });
  it("última linha incompleta fica para o próximo ciclo (offset só avança por linha completa)", async () => {
    const dir = tmp();
    const f = join(dir, "t.jsonl");
    const l1 = linhaClaude({ id: "m1", ts: T(1) });
    const l2 = linhaClaude({ id: "m2", ts: T(2) });
    writeFileSync(f, `${l1}\n${l2.slice(0, 40)}`);
    const a = await tudo({ caminho: f, offset: 0, fabrica: fabricaClaude });
    expect(a.regs.map((x) => x.chave)).toEqual(["m1"]);
    expect(a.ultimo.offset).toBe(Buffer.byteLength(l1) + 1);
    appendFileSync(f, `${l2.slice(40)}\n`);
    const b = await tudo({ caminho: f, offset: a.ultimo.offset, fabrica: fabricaClaude });
    expect(b.regs.map((x) => x.chave)).toEqual(["m2"]);
  });
  it("linha gigante (> 8 MB) é pulada e contada; as vizinhas continuam", async () => {
    const dir = tmp();
    const f = join(dir, "t.jsonl");
    const gigante = `{"type":"user","x":"${"a".repeat(LINHA_MAX_BYTES + 10)}"}`;
    writeFileSync(f, `${linhaClaude({ id: "m1", ts: T(1) })}\n${gigante}\n${linhaClaude({ id: "m2", ts: T(2) })}\n`);
    const r = await tudo({ caminho: f, offset: 0, fabrica: fabricaClaude });
    expect(r.regs.map((x) => x.chave)).toEqual(["m1", "m2"]);
    expect(r.puladas).toBe(1);
  });
  it("arquivo truncado/rotacionado (offset > tamanho) relê do início e sinaliza", async () => {
    const dir = tmp();
    const f = join(dir, "t.jsonl");
    writeFileSync(f, `${linhaClaude({ id: "m1", ts: T(1) })}\n${linhaClaude({ id: "m2", ts: T(2) })}\n`);
    const a = await tudo({ caminho: f, offset: 0, fabrica: fabricaClaude });
    truncateSync(f, 0);
    writeFileSync(f, `${linhaClaude({ id: "m3", ts: T(3) })}\n`);
    const b = await tudo({ caminho: f, offset: a.ultimo.offset, fabrica: fabricaClaude });
    expect(b.regs.map((x) => x.chave)).toEqual(["m3"]);
    expect(b.ultimo.reiniciou).toBe(true);
  });
  it("lotes de ≤ 500 registros", async () => {
    const dir = tmp();
    const f = join(dir, "t.jsonl");
    writeFileSync(f, Array.from({ length: 1200 }, (_, i) => linhaClaude({ id: `m${i}`, ts: T(i) })).join("\n") + "\n");
    const r = await tudo({ caminho: f, offset: 0, fabrica: fabricaClaude });
    expect(r.regs).toHaveLength(1200);
    expect(r.lotes).toBe(3);
  });
});

describe("leitor do Codex (CT-10.02)", () => {
  const arq = (linhas: string[]): string => {
    const f = join(tmp(), "rollout.jsonl");
    writeFileSync(f, linhas.join("\n") + "\n");
    return f;
  };
  it("delta do total acumulado: evento repetido não conta; reinício de contagem é novo marco", async () => {
    const f = arq([
      linhaTurnContext(T(0), "gpt-6-astra"),
      linhaTokenCount(T(1), 1, { input: 1000, cached: 400, output: 50, reasoning: 20 }),
      linhaTokenCount(T(2), 2, { input: 1000, cached: 400, output: 50, reasoning: 20 }), // repetido
      linhaTokenCount(T(3), 3, { input: 1500, cached: 900, output: 80 }),
      linhaTokenCount(T(4), 4, { input: 200, cached: 0, output: 10 }), // reinício
    ]);
    const r = await tudo({ caminho: f, offset: 0, fabrica: fabricaCodex });
    expect(r.regs.map((x) => x.tokens)).toEqual([
      { entrada: 600, cache_escrita: 0, cache_leitura: 400, saida: 50 },
      { entrada: 0, cache_escrita: 0, cache_leitura: 500, saida: 30 },
      { entrada: 200, cache_escrita: 0, cache_leitura: 0, saida: 10 },
    ]);
    expect(r.regs.every((x) => x.modelo === "gpt-6-astra")).toBe(true);
    expect(new Set(r.regs.map((x) => x.chave)).size).toBe(3);
    const de = await tudo({ caminho: f, offset: 0, fabrica: fabricaCodex });
    expect(de.regs).toEqual(r.regs);
  });
  it("sem modelo ⇒ modelo null; token_count com info null é ignorado; nenhuma sentinela", async () => {
    const f = arq([linhaTokenCount(T(1), 1, { input: 10, output: 1 }), JSON.stringify({ timestamp: T(2), type: "event_msg", payload: { type: "token_count", info: null } }), "{quebrado"]);
    const r = await tudo({ caminho: f, offset: 0, fabrica: fabricaCodex });
    expect(r.regs).toHaveLength(1);
    expect(r.regs[0]?.modelo).toBeNull();
    for (const s of SENTINELAS) expect(JSON.stringify(r)).not.toContain(s);
  });
  it("incremental com estado: só o delta novo; sem estado e offset > 0 relê do início", async () => {
    const f = arq([linhaTurnContext(T(0), "m"), linhaTokenCount(T(1), 1, { input: 100, output: 10 })]);
    const a = await tudo({ caminho: f, offset: 0, fabrica: fabricaCodex });
    appendFileSync(f, linhaTokenCount(T(2), 2, { input: 150, output: 15 }) + "\n");
    const b = await tudo({ caminho: f, offset: a.ultimo.offset, estado: a.ultimo.estado, fabrica: fabricaCodex });
    expect(b.regs.map((x) => x.tokens)).toEqual([{ entrada: 50, cache_escrita: 0, cache_leitura: 0, saida: 5 }]);
    const c = await tudo({ caminho: f, offset: a.ultimo.offset, fabrica: fabricaCodex });
    expect(c.ultimo.reiniciou).toBe(true);
    expect(c.regs).toHaveLength(2);
  });
});

describe("OpenCode (formato real: tabela message do opencode.db)", () => {
  const data = (o: Record<string, unknown>): string => JSON.stringify({ role: "assistant", modelID: "MiniMax-M3", providerID: "minimax", tokens: { total: 1, input: 106, output: 12, reasoning: 27, cache: { write: 0, read: 126417 } }, cost: 0.0077, time: { created: 1790785830908, completed: 1790785833383 }, ...o });
  it("extrai tokens (raciocínio na saída), custo medido e instante; custo 0 ⇒ desconhecido", () => {
    const r = extrairOpenCode("msg_1", 1, data({}));
    expect(r).toMatchObject({ chave: "msg_1", modelo: "MiniMax-M3", tokens: { entrada: 106, cache_escrita: 0, cache_leitura: 126417, saida: 39 }, usd_medido: 0.0077 });
    expect(extrairOpenCode("msg_2", 1, data({ cost: 0 }))?.usd_medido).toBeUndefined();
    expect(extrairOpenCode("msg_3", 1, data({ role: "user" }))).toBeNull();
    expect(extrairOpenCode("msg_4", 1, "{")).toBeNull();
  });
  it("consulta por sessão e cursor de tempo", () => {
    const chamadas: Array<{ sql: string; params: unknown[] }> = [];
    const db = { todas: (sql: string, params: Array<string | number>) => (chamadas.push({ sql, params }), [{ id: "a", time_created: 5, data: data({}) }, { id: "b", time_created: 9, data: data({ role: "user" }) }]) };
    const r = lerSessaoOpenCode(db, "ses_1", 3);
    expect(r.registros.map((x) => x.chave)).toEqual(["a"]);
    expect(r.ultimoMs).toBe(9);
    expect(chamadas[0]?.sql).toContain("session_id = ?");
  });
});
