import { mkdirSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { criarOpenCodeDb, dataAssistente, inserirMensagens, inserirSessao, SENTINELA_OC } from "../../../tests/fixtures/custo/opencode-db";
import { mundoIngestao } from "../../../tests/fixtures/custo/mundo-ingestao";

const abertos: Array<{ fechar(): Promise<void> }> = [];
const dbs: DatabaseSync[] = [];
afterEach(async () => {
  for (const d of dbs.splice(0)) {
    try {
      d.close();
    } catch {
      /* já fechado */
    }
  }
  for (const m of abertos.splice(0)) await m.fechar();
});
const novo = () => {
  const m = mundoIngestao();
  abertos.push(m);
  mkdirSync(join(m.base, "opencode"), { recursive: true });
  const db = criarOpenCodeDb(join(m.base, "opencode", "opencode.db"));
  dbs.push(db);
  return { m, db };
};
const pane = (m: ReturnType<typeof novo>["m"]) => ({ id: m.ocPane.id, cli: "opencode", conta_id: m.conta.id, mission_id: m.mis.id, workspace_id: m.ws.id });
const registros = (m: ReturnType<typeof novo>["m"]): number => m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n ?? 0;
const T0 = Date.now() - 3_600_000;

describe("fonte OpenCode: localizar, ler pelo worker e gravar (P-82)", () => {
  it("sem banco ⇒ não acha fonte (o chamador deixa sem_fonte visível, nunca 0)", async () => {
    const m = mundoIngestao();
    abertos.push(m);
    expect(await m.fontes.localizarOpenCode(pane(m), { conversa: null, cwd: "/w/app", desdeMs: 0 })).toBeNull();
    m.fontes.registrarSemLeitor(pane(m));
    expect(m.s.resumo("pane", m.ocPane.id).fontes_ausentes).toContain("sem_fonte:opencode");
  });

  it("acha a sessão no worker, grava base+relativo (nunca caminho absoluto), lê em lotes e é idempotente", async () => {
    const { m, db } = novo();
    inserirSessao(db, "ses_AAAAAA1", "/w/app", T0);
    inserirMensagens(db, [
      { id: "m1", sessao: "ses_AAAAAA1", t: T0 + 1_000, data: dataAssistente(T0 + 1_000, { cost: 0.25 }) },
      { id: "m2", sessao: "ses_AAAAAA1", t: T0 + 2_000, data: dataAssistente(T0 + 2_000) },
      { id: "m3", sessao: "ses_AAAAAA1", t: T0 + 3_000, data: { role: "user", texto: SENTINELA_OC } },
    ]);
    m.fontes.registrarSemLeitor(pane(m));
    const f = await m.fontes.localizarOpenCode(pane(m), { conversa: null, cwd: "/w/app", desdeMs: T0 });
    expect(f).toMatchObject({ cli: "opencode", base: "opencode_data", relativo: "opencode.db#ses_AAAAAA1", pane_id: m.ocPane.id });
    expect(JSON.stringify(m.banco.consultar("SELECT * FROM uso_fonte"))).not.toContain(m.base);
    // o `sem_fonte` anterior do Pane foi encerrado: não vira alerta eterno
    expect(m.s.resumo("pane", m.ocPane.id).fontes_ausentes).not.toContain("sem_fonte:opencode");

    m.ing.observar(f!.id);
    await m.ing.drenar(f!.id);
    expect(registros(m)).toBe(2);
    const c = m.s.resumo("pane", m.ocPane.id);
    expect(c.tokens.entrada).toBe(200);
    expect(c.usd).not.toBeNull(); // m1 tem custo medido pelo próprio OpenCode
    expect(m.s.repo.fontes.obter(f!.id)?.erro_codigo).toBeNull();

    // incremental: mensagem nova entra; reler do zero não duplica
    inserirMensagens(db, [{ id: "m4", sessao: "ses_AAAAAA1", t: T0 + 4_000, data: dataAssistente(T0 + 4_000) }]);
    await m.ing.drenar(f!.id);
    expect(registros(m)).toBe(3);
    m.s.repo.fontes.atualizar(f!.id, { offset: 0 });
    await m.ing.drenar(f!.id);
    expect(registros(m)).toBe(3);
    // nenhum conteúdo no banco do app
    expect(JSON.stringify(m.banco.consultar("SELECT * FROM uso_registro"))).not.toContain(SENTINELA_OC);
  });

  it("referência de sessão inválida ou de outro arquivo é recusada; banco que é symlink para fora da pasta de dados é recusado", async () => {
    const { m, db } = novo();
    expect(m.fontes.resolver({ base: "opencode_data", relativo: "opencode.db#ses_x/../..", conta_id: null })).toBeNull();
    expect(m.fontes.resolver({ base: "opencode_data", relativo: "outro.db#ses_AAAAAA1", conta_id: null })).toBeNull();
    expect(m.fontes.resolver({ base: "opencode_data", relativo: "opencode.db#ses_AAAAAA1", conta_id: null })).toBe(join(m.base, "opencode", "opencode.db"));
    inserirSessao(db, "ses_AAAAAA1", "/w/app", T0);
    db.close();
    mkdirSync(join(m.base, "fora"), { recursive: true });
    renameSync(join(m.base, "opencode", "opencode.db"), join(m.base, "fora", "opencode.db"));
    symlinkSync(join(m.base, "fora", "opencode.db"), join(m.base, "opencode", "opencode.db"));
    expect(await m.fontes.localizarOpenCode(pane(m), { conversa: "ses_AAAAAA1", cwd: null, desdeMs: 0 })).toBeNull();
  });
});
