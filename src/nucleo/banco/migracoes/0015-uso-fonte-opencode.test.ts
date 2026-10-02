import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco";
import { migrar, versaoAtual } from "../migrar";
import { MIGRACOES, VERSAO_SUPORTADA } from "./index";

const abertos: Banco[] = [];
const novo = (): Banco => {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  return b;
};
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-01-01T00:00:00.000Z";
const fonte = (b: Banco, id: string, base: string, rel: string): void =>
  void b.executar("INSERT INTO uso_fonte (id,cli,base,relativo,estado,criado_em,atualizado_em) VALUES (?,?,?,?,'lendo',?,?)", [id, "x", base, rel, TS, TS]);
const registro = (b: Banco, id: string, fonteId: string, chave: string): void =>
  void b.executar("INSERT INTO uso_registro (id,fonte_id,chave,ts,atribuicao,tokens_entrada,usd_origem) VALUES (?,?,?,?,'sem_card',5,'desconhecido')", [id, fonteId, chave, TS]);

describe("migration 0015-uso-fonte-opencode", () => {
  it("é a versão 15, aceita a base 'opencode_data' e mantém índices e CHECK das demais", () => {
    const b = novo();
    expect(MIGRACOES[14]?.nome).toBe("0015-uso-fonte-opencode");
    expect(VERSAO_SUPORTADA).toBeGreaterThanOrEqual(15);
    migrar(b);
    fonte(b, "uf_1", "opencode_data", "opencode.db#ses_1");
    expect(() => fonte(b, "uf_2", "opencode_data", "opencode.db#ses_1")).toThrow(); // ux_uso_fonte
    expect(() => fonte(b, "uf_3", "outra", "x")).toThrow(); // CHECK
    const idx = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='uso_fonte'").map((i) => i.name);
    expect(idx).toEqual(expect.arrayContaining(["ux_uso_fonte", "ux_uso_fonte_pane", "ix_uso_fonte_pane"]));
    expect(migrar(b).aplicadas).toEqual([]);
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
  });

  it("migra da v14 com dados: fontes e registros (FK em cascata) sobrevivem intactos", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, 14) });
    fonte(b, "uf_a", "claude_config", "projects/p/a.jsonl");
    fonte(b, "uf_p", "proxy", "");
    registro(b, "ur_1", "uf_a", "m1");
    registro(b, "ur_2", "uf_a", "m2");
    const r = migrar(b);
    expect(r.de).toBe(14);
    expect(b.consultar("SELECT id FROM uso_fonte ORDER BY id")).toEqual([{ id: "uf_a" }, { id: "uf_p" }]);
    expect(b.consultar("SELECT id,fonte_id,chave,tokens_entrada FROM uso_registro ORDER BY id")).toEqual([
      { id: "ur_1", fonte_id: "uf_a", chave: "m1", tokens_entrada: 5 },
      { id: "ur_2", fonte_id: "uf_a", chave: "m2", tokens_entrada: 5 },
    ]);
    // a FK continua valendo: apagar a fonte leva os registros (cascata) e a tabela temporária não ficou
    b.executar("DELETE FROM uso_fonte WHERE id = 'uf_a'");
    expect(b.consultar("SELECT id FROM uso_registro")).toEqual([]);
    expect(b.consultar("SELECT name FROM sqlite_temp_master WHERE name = '_uso_registro_bak'")).toEqual([]);
  });
});
