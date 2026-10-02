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
const H = "a".repeat(64);
const tabelas = (b: Banco) => b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((t) => t.name);
const indices = (b: Banco) => b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'").map((t) => t.name);

function semear(b: Banco): void {
  b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r',?,?)", [TS, TS]);
  b.executar("INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES ('mis_1','ws_1','agentico','livre','t','executando',?,?)", [TS, TS]);
  b.executar("INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,estado,criado_em,atualizado_em) VALUES ('pane_1','mis_1','ws_1',1,'cli','pronto',?,?)", [TS, TS]);
}
const ent = (b: Banco, o: Record<string, unknown> = {}) => {
  const v = { id: "mem_1", ws: "ws_1", mis: "mis_1", pane: "pane_1", lin: "pane_1", squad: null, escopo: "pane", anel: 1, tipo: "decisao", conteudo: "texto", h: H, ...o };
  return b.executar(
    "INSERT INTO memoria_entrada (id,workspace_id,mission_id,pane_id,linhagem_id,squad_slug,escopo,anel,tipo,conteudo,fonte,hash_conteudo,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,'agente',?,?,?)",
    [v.id, v.ws, v.mis, v.pane, v.lin, v.squad, v.escopo, v.anel, v.tipo, v.conteudo, v.h, TS, TS] as never,
  );
};

describe("migration 0007-memoria", () => {
  it("é a versão 7, cria tabelas e índices do plano, sem FTS5", () => {
    const b = novo();
    expect(MIGRACOES[6]?.nome).toBe("0007-memoria");
    expect(VERSAO_SUPORTADA).toBeGreaterThanOrEqual(7);
    migrar(b);
    expect(tabelas(b)).toEqual(expect.arrayContaining(["memoria_entrada", "memoria_config", "memoria_missao_config", "memoria_vetor"]));
    expect(tabelas(b)).not.toContain("memoria_fts");
    expect(indices(b)).toEqual(expect.arrayContaining(["ix_mem_linhagem", "ix_mem_missao", "ix_mem_workspace_anel", "ix_mem_hash", "ix_mem_expira", "ux_pane_respawn_vivo", "ix_mem_squad"]));
  });

  it("migra do banco da v6 com dados, sem perda", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, 6) });
    semear(b);
    const r = migrar(b);
    expect(r.de).toBe(6);
    expect(r.aplicadas).toContain("0007-memoria");
    expect(b.consultarUm("SELECT display_id FROM pane WHERE id='pane_1'")).toEqual({ display_id: 1 });
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
  });

  it("filhos vivos duplicados legados não quebram a migration (mantém o mais novo)", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, 6) });
    semear(b);
    b.executar("INSERT INTO pane (id,workspace_id,display_id,tipo,estado,respawn_de,criado_em,atualizado_em) VALUES ('pane_2','ws_1',2,'cli','pronto','pane_1',?,?)", [TS, TS]);
    b.executar("INSERT INTO pane (id,workspace_id,display_id,tipo,estado,respawn_de,criado_em,atualizado_em) VALUES ('pane_3','ws_1',3,'cli','pronto','pane_1',?,?)", [TS, TS]);
    migrar(b);
    expect(b.consultar<{ id: string; estado: string }>("SELECT id, estado FROM pane WHERE respawn_de='pane_1' ORDER BY id")).toEqual([
      { id: "pane_2", estado: "encerrado" },
      { id: "pane_3", estado: "pronto" },
    ]);
  });

  it("ux_pane_respawn_vivo: 2 filhos vivos do mesmo Pane são recusados; encerrado libera", () => {
    const b = novo();
    migrar(b);
    semear(b);
    const filho = (id: string, d: number, estado = "pronto") => b.executar("INSERT INTO pane (id,workspace_id,display_id,tipo,estado,respawn_de,criado_em,atualizado_em) VALUES (?,'ws_1',?,'cli',?,'pane_1',?,?)", [id, d, estado, TS, TS]);
    filho("pane_2", 2);
    expect(() => filho("pane_3", 3)).toThrow(/UNIQUE/);
    b.executar("UPDATE pane SET estado='encerrado' WHERE id='pane_2'");
    expect(() => filho("pane_3", 3)).not.toThrow();
  });

  it("CHECKs: escopo pane sem linhagem, conteúdo vazio/>1000, anel inconsistente, usuário com workspace, squad sem slug", () => {
    const b = novo();
    migrar(b);
    semear(b);
    expect(() => ent(b, { lin: null })).toThrow(/CHECK/);
    expect(() => ent(b, { conteudo: "x".repeat(1001) })).toThrow(/CHECK/);
    expect(() => ent(b, { conteudo: "" })).toThrow(/CHECK/);
    expect(() => ent(b, { anel: 2 })).toThrow(/CHECK/);
    expect(() => ent(b, { escopo: "usuario", anel: 3 })).toThrow(/CHECK/); // usuario exige workspace NULL
    expect(() => ent(b, { escopo: "squad", anel: 2, squad: null })).toThrow(/CHECK/);
    expect(() => ent(b, { escopo: "missao", mis: null })).toThrow(/CHECK/);
    expect(() => ent(b, { tipo: "inventado" })).toThrow(/CHECK/);
    expect(() => ent(b, { h: "curto" })).toThrow(/CHECK/);
    expect(() => ent(b)).not.toThrow();
    expect(() => ent(b, { id: "mem_2", escopo: "squad", anel: 2, squad: "s", lin: null })).not.toThrow();
    expect(() => ent(b, { id: "mem_3", escopo: "usuario", anel: 3, ws: null, mis: null, pane: null, lin: null, tipo: "preferencia" })).not.toThrow();
    expect(() => ent(b, { id: "mem_4", escopo: "workspace", anel: 2, mis: null, pane: null, lin: null })).not.toThrow();
  });

  it("memoria_config: padrões das decisões (P-21 solo/squad ligados, P-22 365 d) e CHECKs", () => {
    const b = novo();
    migrar(b);
    semear(b);
    b.executar("INSERT INTO memoria_config (workspace_id, atualizado_em) VALUES ('ws_1', ?)", [TS]);
    expect(b.consultarUm("SELECT ativa, solo, squad, orcamento_brief_chars, retencao_dias, pacote_workers FROM memoria_config")).toEqual({ ativa: 1, solo: 1, squad: 1, orcamento_brief_chars: 6000, retencao_dias: 365, pacote_workers: 1 });
    expect(() => b.executar("UPDATE memoria_config SET orcamento_brief_chars = 1000")).toThrow(/CHECK/);
    expect(() => b.executar("UPDATE memoria_config SET orcamento_brief_chars = 20001")).toThrow(/CHECK/);
    expect(() => b.executar("UPDATE memoria_config SET retencao_dias = 3")).toThrow(/CHECK/);
    expect(() => b.executar("UPDATE memoria_config SET retencao_dias = 0")).not.toThrow(); // sem limite
  });

  it("CASCADE: apagar Pane/Missão/workspace leva as entradas, a config e os vetores", () => {
    const b = novo();
    migrar(b);
    semear(b);
    b.executar("INSERT INTO memoria_config (workspace_id, atualizado_em) VALUES ('ws_1', ?)", [TS]);
    b.executar("INSERT INTO memoria_missao_config (mission_id, ativa, atualizado_em) VALUES ('mis_1', 0, ?)", [TS]);
    ent(b);
    ent(b, { id: "mem_9", escopo: "workspace", anel: 2, mis: null, pane: null, lin: null });
    b.executar("INSERT INTO memoria_vetor (entrada_id, modelo, dimensao, vetor, criado_em) VALUES ('mem_1','hash-256-v1',8,x'00',?)", [TS]);
    b.executar("DELETE FROM pane WHERE id='pane_1'");
    expect(b.consultar("SELECT 1 FROM memoria_entrada WHERE id='mem_1'")).toHaveLength(0);
    expect(b.consultar("SELECT 1 FROM memoria_vetor")).toHaveLength(0);
    b.executar("DELETE FROM workspace WHERE id='ws_1'");
    expect(b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0);
    expect(b.consultar("SELECT 1 FROM memoria_config")).toHaveLength(0);
    expect(b.consultar("SELECT 1 FROM memoria_missao_config")).toHaveLength(0);
  });
});
