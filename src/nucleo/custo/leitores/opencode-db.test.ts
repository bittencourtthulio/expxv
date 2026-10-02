import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { criarOpenCodeDb, dataAssistente, inserirMensagens, inserirSessao, SENTINELA_OC } from "../../../../tests/fixtures/custo/opencode-db";
import type { LoteLido } from "./leitor";
import { abrirOpenCode, lerLotesOpenCode, localizarSessaoOpenCode } from "./opencode";

const dirs: string[] = [];
const dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) {
    try {
      d.close();
    } catch {
      /* já fechado */
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const novo = () => {
  const dir = mkdtempSync(join(tmpdir(), "oc-"));
  dirs.push(dir);
  const caminho = join(dir, "opencode.db");
  const db = criarOpenCodeDb(caminho);
  dbs.push(db);
  inserirSessao(db, "ses_AAAAAA1", "/w/app", 1_000);
  return { dir, caminho, db };
};
const ler = async (caminho: string, offset: number, extra: { sessao?: string; agoraMs?: number; loteMax?: number } = {}): Promise<LoteLido[]> => {
  const lotes: LoteLido[] = [];
  for await (const l of lerLotesOpenCode({ caminho, sessao: extra.sessao ?? "ses_AAAAAA1", offset, ...(extra.agoraMs === undefined ? {} : { agoraMs: extra.agoraMs }), ...(extra.loteMax === undefined ? {} : { loteMax: extra.loteMax }) })) lotes.push(l);
  return lotes;
};
const chaves = (ls: LoteLido[]): string[] => ls.flatMap((l) => l.registros.map((r) => r.chave));
const AGORA = 10_000_000;

describe("leitor do OpenCode: opencode.db somente leitura (P-82)", () => {
  it("lê as mensagens do assistente da sessão (só {ts, modelo, tokens, chave, usd_medido}) e ignora usuário e outras sessões", async () => {
    const { caminho, db } = novo();
    inserirSessao(db, "ses_BBBBBB2", "/w/outro", 1_000);
    inserirMensagens(db, [
      { id: "m1", sessao: "ses_AAAAAA1", t: 2_000, data: dataAssistente(2_000, { cost: 0.5 }) },
      { id: "m2", sessao: "ses_AAAAAA1", t: 3_000, data: { role: "user", texto: SENTINELA_OC } },
      { id: "m3", sessao: "ses_BBBBBB2", t: 3_500 },
      { id: "m4", sessao: "ses_AAAAAA1", t: 4_000, cru: "{quebrado" },
    ]);
    const ls = await ler(caminho, 0, { agoraMs: AGORA });
    expect(chaves(ls)).toEqual(["m1"]);
    const r = ls[0]?.registros[0];
    expect(r).toMatchObject({ chave: "m1", modelo: "modelo-x", tokens: { entrada: 100, cache_escrita: 0, cache_leitura: 0, saida: 10 }, usd_medido: 0.5 });
    expect(Object.keys(r ?? {}).sort()).toEqual(["chave", "modelo", "tokens", "ts", "usd_medido"]);
    expect(JSON.stringify(ls)).not.toContain(SENTINELA_OC);
    expect(ls.at(-1)?.ultimo).toBe(true);
    expect(ls.at(-1)?.tamanho).toBeGreaterThan(0);
  });

  it("incremental pelo cursor em ms: o que chega depois é lido; reler a borda devolve a mesma chave (o banco deduplica)", async () => {
    const { caminho, db } = novo();
    inserirMensagens(db, [{ id: "m1", sessao: "ses_AAAAAA1", t: 2_000 }, { id: "m2", sessao: "ses_AAAAAA1", t: 3_000 }]);
    const a = await ler(caminho, 0, { agoraMs: AGORA });
    expect(chaves(a)).toEqual(["m1", "m2"]);
    const cursor = a.at(-1)?.offset ?? -1;
    expect(cursor).toBe(3_000);
    inserirMensagens(db, [{ id: "m3", sessao: "ses_AAAAAA1", t: 4_000 }]);
    const b = await ler(caminho, cursor, { agoraMs: AGORA });
    expect(chaves(b)).toEqual(["m2", "m3"]); // a borda volta (idempotência por (fonte_id, chave)); nada anterior é relido
    expect(b.at(-1)?.offset).toBe(4_000);
  });

  it("mais de 500 mensagens saem em lotes de ≤ 500 (cursor por chave: não repete nem perde, mesmo com o mesmo instante)", async () => {
    const { caminho, db } = novo();
    inserirMensagens(db, Array.from({ length: 1_250 }, (_, i) => ({ id: `m${String(i).padStart(5, "0")}`, sessao: "ses_AAAAAA1", t: 2_000 + Math.floor(i / 3) })));
    const ls = await ler(caminho, 0, { agoraMs: AGORA });
    expect(ls.length).toBe(3);
    expect(ls.every((l) => l.registros.length <= 500)).toBe(true);
    const todas = chaves(ls);
    expect(todas).toHaveLength(1_250);
    expect(new Set(todas).size).toBe(1_250);
    expect(ls.map((l) => l.ultimo)).toEqual([false, false, true]);
  });

  it("resposta EM ANDAMENTO (sem time.completed, recente) não conta ainda e segura o cursor; quando completa, entra", async () => {
    const { caminho, db } = novo();
    const agora = 5_000_000;
    inserirMensagens(db, [
      { id: "m1", sessao: "ses_AAAAAA1", t: agora - 60_000 },
      { id: "m2", sessao: "ses_AAAAAA1", t: agora - 30_000, data: dataAssistente(agora - 30_000, { time: { created: agora - 30_000 }, tokens: { input: 7, output: 1, reasoning: 0, cache: { write: 0, read: 0 } } }) },
      { id: "m3", sessao: "ses_AAAAAA1", t: agora - 20_000 },
    ]);
    const a = await ler(caminho, 0, { agoraMs: agora });
    expect(chaves(a)).toEqual(["m1", "m3"]);
    expect(a.at(-1)?.offset).toBe(agora - 30_000); // cursor na pendente
    inserirMensagens(db, [{ id: "m2", sessao: "ses_AAAAAA1", t: agora - 30_000, data: dataAssistente(agora - 30_000) }]);
    const b = await ler(caminho, a.at(-1)?.offset ?? 0, { agoraMs: agora });
    expect(chaves(b)).toEqual(["m2", "m3"]);
    expect(b.at(-1)?.offset).toBe(agora - 20_000);
  });

  it("pendente ABANDONADA (> 10 min) não prende o cursor: conta o que tem", async () => {
    const { caminho, db } = novo();
    const agora = 50_000_000;
    inserirMensagens(db, [{ id: "m1", sessao: "ses_AAAAAA1", t: 1_000, data: dataAssistente(1_000, { time: { created: 1_000 } }) }]);
    const a = await ler(caminho, 0, { agoraMs: agora });
    expect(chaves(a)).toEqual(["m1"]);
    expect(a.at(-1)?.offset).toBe(1_000);
  });

  it("id de sessão inválido é recusado (nunca vira SQL) e base ausente erra de forma nominal", async () => {
    const { caminho, dir } = novo();
    await expect(ler(caminho, 0, { sessao: "x'; DROP TABLE message;--" })).rejects.toMatchObject({ code: "sessao_invalida" });
    await expect(ler(join(dir, "nao-existe.db"), 0)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("a conexão é SOMENTE LEITURA: escrever falha e o banco não muda", () => {
    const { caminho, db } = novo();
    inserirMensagens(db, [{ id: "m1", sessao: "ses_AAAAAA1", t: 2_000 }]);
    const ro = abrirOpenCode(caminho);
    dbs.push(ro);
    expect(() => ro.exec("DELETE FROM message")).toThrow();
    expect(() => ro.exec("INSERT INTO message VALUES ('x','ses_AAAAAA1',1,1,'{}')")).toThrow();
    expect((ro.prepare("SELECT COUNT(*) AS n FROM message").get() as { n: number }).n).toBe(1);
  });

  it("a consulta usa o índice (session_id, time_created, id): sem varredura da tabela", () => {
    const { caminho } = novo();
    const ro = abrirOpenCode(caminho);
    dbs.push(ro);
    const plano = ro.prepare("EXPLAIN QUERY PLAN SELECT id, time_created, data FROM message WHERE session_id = ? AND (time_created, id) >= (?, '') ORDER BY time_created, id LIMIT ?").all("s", 0, 500) as Array<{ detail: string }>;
    expect(plano.map((p) => p.detail).join(" ")).toContain("message_session_time_created_id_idx");
    expect(plano.map((p) => p.detail).join(" ")).not.toMatch(/SCAN message(?! USING)/);
  });
});

describe("localizar a sessão do Pane (sem varrer)", () => {
  it("pelo id (chave primária) quando o hook informou; senão pelo diretório nas sessões recentes, só criadas depois do Pane e sem filhas", () => {
    const { caminho, db } = novo();
    inserirSessao(db, "ses_CCCCCC3", "/w/app", 5_000);
    inserirSessao(db, "ses_DDDDDD4", "/w/app", 6_000, "ses_CCCCCC3"); // filha (subagente): não é a sessão do Pane
    inserirSessao(db, "ses_EEEEEE5", "/w/outro", 7_000);
    expect(localizarSessaoOpenCode({ caminho, conversa: "ses_AAAAAA1", cwd: null, desdeMs: 0 })).toBe("ses_AAAAAA1");
    expect(localizarSessaoOpenCode({ caminho, conversa: null, cwd: "/w/app", desdeMs: 4_000 })).toBe("ses_CCCCCC3");
    expect(localizarSessaoOpenCode({ caminho, conversa: null, cwd: "/w/app", desdeMs: 900_000 })).toBeNull(); // sessão anterior ao Pane
    expect(localizarSessaoOpenCode({ caminho, conversa: "ses_NAOEXISTE", cwd: "/x", desdeMs: 0 })).toBeNull();
    expect(localizarSessaoOpenCode({ caminho, conversa: "../../etc", cwd: null, desdeMs: 0 })).toBeNull();
  });
});
