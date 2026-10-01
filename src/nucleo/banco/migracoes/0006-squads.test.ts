import { afterEach, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { abrirBanco, type Banco } from "../banco";
import { migrar, versaoAtual } from "../migrar";
import { MIGRACOES, VERSAO_SUPORTADA } from "./index";

const abertos: Banco[] = [];
function novo(): Banco {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  return b;
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

const TS = "2026-01-01T00:00:00.000Z";
const H = "a".repeat(64);
const tabelas = (b: Banco) => b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((t) => t.name);
const indices = (b: Banco) => b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'").map((t) => t.name);
const colunas = (b: Banco, t: string) => b.consultar<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name);

function semearMvp(b: Banco): void {
  b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r',?,?)", [TS, TS]);
  b.executar("INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES ('mis_1','ws_1','agentico','livre','t','intake',?,?)", [TS, TS]);
  b.executar("INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,estado,criado_em,atualizado_em) VALUES ('pane_1','mis_1','ws_1',1,'cli','pronto',?,?)", [TS, TS]);
}

describe("migration 0006-squads", () => {
  it("é a versão 6, aplica em banco vazio e cria tabelas, colunas e índices do plano", () => {
    const b = novo();
    expect(MIGRACOES[5]?.nome).toBe("0006-squads");
    expect(VERSAO_SUPORTADA).toBeGreaterThanOrEqual(6);
    migrar(b);
    expect(tabelas(b)).toEqual(expect.arrayContaining(["mission_squad", "invocacao_agente", "squad_execucao"]));
    expect(colunas(b, "mission")).toContain("squad_id");
    expect(colunas(b, "pane")).toContain("agente_id");
    expect(indices(b)).toEqual(expect.arrayContaining(["ix_invocacao_mission", "ix_invocacao_agente_vivas", "ix_squad_execucao_criado", "ux_squad_execucao_mission", "ix_mission_squad"]));
  });

  it("aplica em banco do MVP (v5) com dados sem perda; squad_id/agente_id nascem NULL", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, 5) });
    expect(versaoAtual(b)).toBe(5);
    semearMvp(b);
    const r = migrar(b);
    expect(r.de).toBe(5);
    expect(r.aplicadas).toContain("0006-squads");
    expect(b.consultarUm("SELECT squad_id FROM mission WHERE id='mis_1'")).toEqual({ squad_id: null });
    expect(b.consultarUm("SELECT agente_id, display_id FROM pane WHERE id='pane_1'")).toEqual({ agente_id: null, display_id: 1 });
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
  });

  it("CASCADE: apagar a Missão leva mission_squad e invocacao_agente; o Pane apagado só zera pane_id", () => {
    const b = novo();
    migrar(b);
    semearMvp(b);
    b.executar("INSERT INTO mission_squad (mission_id,squad_slug,squad_hash,criado_em) VALUES ('mis_1','s',?,?)", [H, TS]);
    b.executar("INSERT INTO invocacao_agente (id,mission_id,pane_id,agente_id,perfil_json,prompt_hash,criado_em) VALUES ('inv_1','mis_1','pane_1','s.a','{}','h',?)", [TS]);
    b.executar("INSERT INTO squad_execucao (id,squad_slug,squad_hash,workspace_id,mission_id,objetivo,plano_antes,criado_em) VALUES ('sqx_1','s',?,'ws_1','mis_1','obj',1,?)", [H, TS]);
    b.executar("DELETE FROM pane WHERE id='pane_1'");
    expect(b.consultarUm("SELECT pane_id FROM invocacao_agente WHERE id='inv_1'")).toEqual({ pane_id: null });
    b.executar("DELETE FROM mission WHERE id='mis_1'");
    expect(b.consultar("SELECT 1 FROM mission_squad")).toHaveLength(0);
    expect(b.consultar("SELECT 1 FROM invocacao_agente")).toHaveLength(0);
    expect(b.consultarUm("SELECT mission_id FROM squad_execucao WHERE id='sqx_1'")).toEqual({ mission_id: null }); // SET NULL: o histórico fica
    b.executar("DELETE FROM workspace WHERE id='ws_1'");
    expect(b.consultar("SELECT 1 FROM squad_execucao")).toHaveLength(0);
  });

  it("CHECKs e unicidades: hash, rigidez, plano_antes, JSON, recibo ≤ 240, objetivo ≤ 4000, 1 execução por Missão", () => {
    const b = novo();
    migrar(b);
    semearMvp(b);
    const ms = (h: string, nivel: number | null, plano = 1, pend = "[]") =>
      b.executar("INSERT INTO mission_squad (mission_id,squad_slug,squad_hash,portoes_pendentes_json,nivel_rigidez,plano_antes,criado_em) VALUES ('mis_1','s',?,?,?,?,?)", [h, pend, nivel, plano, TS]);
    expect(() => ms("curto", null)).toThrow(/CHECK/);
    expect(() => ms(H, 6)).toThrow(/CHECK/);
    expect(() => ms(H, 0)).toThrow(/CHECK/);
    expect(() => ms(H, null, 2)).toThrow(/CHECK/);
    expect(() => ms(H, null, 1, "{}")).toThrow(/CHECK/);
    expect(() => ms(H, null, 1, "não json")).toThrow(/CHECK/);
    ms(H, 5, 0, '["build"]');
    expect(() => ms(H, 3)).toThrow(/UNIQUE|PRIMARY/);

    const inv = (recibo: string | null, perfil = "{}", enc: string | null = null) =>
      b.executar("INSERT INTO invocacao_agente (id,mission_id,agente_id,perfil_json,prompt_hash,recibo,criado_em,encerrada_em) VALUES (?, 'mis_1','s.a',?,'h',?,?,?)", [`inv_${Math.random()}`, perfil, recibo, TS, enc]);
    inv("r".repeat(240));
    expect(() => inv("r".repeat(241))).toThrow(/CHECK/);
    expect(() => inv(null, "x{")).toThrow(/CHECK/);
    expect(() => inv(null, "{}", "2025-12-31T00:00:00.000Z")).toThrow(/CHECK/); // encerrada antes de criar

    const ex = (id: string, mis: string | null, obj = "o") =>
      b.executar("INSERT INTO squad_execucao (id,squad_slug,squad_hash,workspace_id,mission_id,objetivo,plano_antes,criado_em) VALUES (?, 's',?,'ws_1',?,?,1,?)", [id, H, mis, obj, TS]);
    expect(() => ex("sqx_a", null, "x".repeat(4001))).toThrow(/CHECK/);
    expect(() => ex("sqx_b", null, "")).toThrow(/CHECK/);
    ex("sqx_c", "mis_1");
    expect(() => ex("sqx_d", "mis_1")).toThrow(/UNIQUE/);
    ex("sqx_e", null);
    ex("sqx_f", null); // várias sem Missão são permitidas
  });

  it("consulta quente (invocações vivas de um agente) usa o índice parcial e fica ≤ 5 ms com 20 000 linhas (P-14)", () => {
    const b = novo();
    migrar(b);
    semearMvp(b);
    b.transacao((tx) => {
      const ins = tx.preparar("INSERT INTO invocacao_agente (id,mission_id,agente_id,perfil_json,prompt_hash,criado_em,encerrada_em) VALUES (?,?,?,'{}','h',?,?)");
      for (let i = 0; i < 20_000; i++) ins.executar([`inv_${String(i).padStart(8, "0")}`, "mis_1", `s.a${i % 8}`, TS, i % 50 === 0 ? null : TS]);
    });
    const plano = b.consultar<{ detail: string }>("EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM invocacao_agente WHERE mission_id = 'mis_1' AND agente_id = 's.a0' AND encerrada_em IS NULL");
    expect(plano.map((p) => p.detail).join(" ")).toContain("ix_invocacao_agente_vivas");
    const consulta = b.preparar<{ n: number }>("SELECT COUNT(*) AS n FROM invocacao_agente WHERE mission_id = ? AND agente_id = ? AND encerrada_em IS NULL");
    const tempos: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      consulta.consultarUm(["mis_1", "s.a0"]);
      tempos.push(performance.now() - t0);
    }
    tempos.sort((x, y) => x - y);
    expect(tempos[25] as number).toBeLessThan(5);
    expect(consulta.consultarUm(["mis_1", "s.a0"])?.n).toBe(100);
  });
});
