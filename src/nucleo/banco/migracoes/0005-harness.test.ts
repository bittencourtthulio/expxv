import { afterEach, describe, expect, it } from "vitest";
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
const TABELAS_HARNESS = [
  "conta_openrouter", "conta_roteamento", "decisao", "decisao_agregado_dia", "harness_workspace", "limite_amostra", "limite_manual",
  "limite_semana", "openrouter_modelo", "pane_rota", "politica", "task_type", "troca_log",
];
const tabelas = (b: Banco) => b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((t) => t.name);

function semearMvp(b: Banco): void {
  b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r',?,?)", [TS, TS]);
  b.executar("INSERT INTO conta (id,provedor,rotulo,habilitada,criado_em,atualizado_em) VALUES ('conta_1','claude','c1',1,?,?)", [TS, TS]);
}
function semear(b: Banco): void {
  semearMvp(b);
  b.executar("INSERT INTO task_type (slug,categoria,rotulo,embutido,criado_em,atualizado_em) VALUES ('bug-fix','desenvolvimento','Bug fix',1,?,?)", [TS, TS]);
}
const politica = (id: string, ws: string | null, fallback = '[{"provider":"claude"}]') =>
  b2().executar(
    "INSERT INTO politica (id,workspace_id,task_type,executor_json,fallback_json,atualizado_por,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)",
    [id, ws, "bug-fix", '{"provider":"claude"}', fallback, "usuario", TS, TS],
  );
let atual: Banco;
const b2 = () => atual;

describe("migration 0005-harness", () => {
  it("é a versão 5, aplica em banco vazio e cria todas as tabelas do plano", () => {
    const b = novo();
    expect(MIGRACOES[4]?.nome).toBe("0005-harness");
    expect(VERSAO_SUPORTADA).toBeGreaterThanOrEqual(5);
    migrar(b);
    expect(tabelas(b)).toEqual(expect.arrayContaining(TABELAS_HARNESS));
  });

  it("aplica em banco do MVP com dados e preserva o que já existia", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, 4) });
    expect(versaoAtual(b)).toBe(4);
    semearMvp(b);
    b.executar("INSERT INTO config (chave,valor_json,criado_em,atualizado_em) VALUES ('x','1',?,?)", [TS, TS]);
    const r = migrar(b);
    expect(r.de).toBe(4);
    expect(r.aplicadas).toContain("0005-harness");
    expect(b.consultar("SELECT id FROM workspace")).toHaveLength(1);
    expect(b.consultar("SELECT id FROM conta")).toHaveLength(1);
    expect(tabelas(b)).toEqual(expect.arrayContaining(TABELAS_HARNESS));
  });

  it("CHECK rejeita fallback_json vazio (inclusive com espaço) e aceita não vazio", () => {
    const b = novo();
    atual = b;
    migrar(b);
    semear(b);
    expect(() => politica("pol_1", null, "[]")).toThrow(/CHECK/i);
    expect(() => politica("pol_2", null, "[ ]")).toThrow(/CHECK/i);
    expect(() => politica("pol_3", null, "{}")).toThrow(/CHECK/i);
    expect(() => politica("pol_4", null, "nao json")).toThrow(/CHECK|malformed/i);
    expect(() => politica("pol_5", null)).not.toThrow();
  });

  it("unicidade (workspace, task_type) inclusive para a política global (workspace NULL)", () => {
    const b = novo();
    atual = b;
    migrar(b);
    semear(b);
    politica("pol_g1", null);
    expect(() => politica("pol_g2", null)).toThrow(/UNIQUE/i);
    politica("pol_w1", "ws_1");
    expect(() => politica("pol_w2", "ws_1")).toThrow(/UNIQUE/i);
  });

  it("harness_workspace: padrões P-28, limiar_troca ≥ limiar_esgotamento rejeitado, 3 modos e descer_1 aceitos", () => {
    const b = novo();
    migrar(b);
    semear(b);
    b.executar("INSERT INTO harness_workspace (workspace_id,atualizado_em) VALUES ('ws_1',?)", [TS]);
    const l = b.consultarUm<Record<string, unknown>>("SELECT * FROM harness_workspace WHERE workspace_id='ws_1'")!;
    expect(l).toMatchObject({ nivel: 4, modo_troca: null, limiar_troca_pct: 85, limiar_esgotamento_pct: 100, margem_troca_pontos: 10, troca_entre_provedores: 1, faixa_minima_troca: "mesma", max_saltos: 3 });
    const upd = (set: string) => b.executar(`UPDATE harness_workspace SET ${set} WHERE workspace_id='ws_1'`);
    expect(() => upd("limiar_troca_pct = 100, limiar_esgotamento_pct = 100")).toThrow(/CHECK/i);
    expect(() => upd("limiar_troca_pct = 90, limiar_esgotamento_pct = 90")).toThrow(/CHECK/i);
    expect(() => upd("limiar_troca_pct = 99, limiar_esgotamento_pct = 98")).toThrow(/CHECK/i);
    expect(() => upd("limiar_troca_pct = 49")).toThrow(/CHECK/i);
    for (const m of ["manual", "so_sugerir", "automatico"]) expect(() => upd(`modo_troca = '${m}'`)).not.toThrow();
    expect(() => upd("modo_troca = 'sempre'")).toThrow(/CHECK/i);
    for (const f of ["mesma", "descer_1", "qualquer"]) expect(() => upd(`faixa_minima_troca = '${f}'`)).not.toThrow();
    expect(() => upd("faixa_minima_troca = 'uma_abaixo'")).toThrow(/CHECK/i);
    expect(() => upd("max_saltos = 0")).toThrow(/CHECK/i);
    expect(() => upd("max_saltos = 3")).not.toThrow();
  });

  it("CHECKs de limite_manual, limite_amostra, troca_log, decisao e conta_openrouter", () => {
    const b = novo();
    migrar(b);
    semear(b);
    expect(() => b.executar("INSERT INTO limite_manual VALUES ('conta_1','weekly',101,NULL,?)", [TS])).toThrow(/CHECK/i);
    expect(() => b.executar("INSERT INTO limite_manual VALUES ('conta_1','credit',10,NULL,?)", [TS])).toThrow(/CHECK/i);
    expect(() => b.executar("INSERT INTO limite_manual VALUES ('conta_1','weekly',100,NULL,?)", [TS])).not.toThrow();
    expect(() => b.executar("INSERT INTO limite_amostra VALUES ('conta_1','weekly','',?,-1,NULL,'manual')", [TS])).toThrow(/CHECK/i);
    expect(() => b.executar("INSERT INTO limite_amostra VALUES ('conta_1','weekly','',?,50,NULL,'manual')", [TS])).not.toThrow();
    expect(() => b.executar("INSERT INTO limite_amostra VALUES ('conta_1','weekly','',?,60,NULL,'manual')", [TS])).toThrow(/UNIQUE|PRIMARY/i);
    const troca = (extra: string) =>
      b.executar(`INSERT INTO troca_log (id,criado_em,workspace_id,motivo,modo,tipo_troca,status,recibo${extra ? "," + extra.split("=")[0] : ""}) VALUES ('trc_x${Math.random()}',?,'ws_1','manual','automatico','outra_conta','feita','r'${extra ? "," + extra.split("=")[1] : ""})`, [TS]);
    expect(() => troca("")).not.toThrow();
    expect(() => troca("adiada_por='coisa'")).toThrow(/CHECK/i);
    expect(() => troca("consumo_origem_pct=120")).toThrow(/CHECK/i);
    expect(() => b.executar("INSERT INTO troca_log (id,criado_em,workspace_id,motivo,modo,tipo_troca,status,recibo) VALUES ('t',?,'ws_1','outro','manual','outra_conta','feita','r')", [TS])).toThrow(/CHECK/i);
    const dec = (custo: string, origem: string) =>
      b.executar(`INSERT INTO decisao (id,criado_em,proposito,tipo,opcoes_json,escolhida,fonte,custo_usd,custo_origem,recibo) VALUES ('dec_${Math.random()}',?,'troca','choice','["a"]','a','regra',${custo},${origem},'r')`, [TS]);
    expect(() => dec("NULL", "'desconhecido'")).not.toThrow();
    expect(() => dec("-0.1", "NULL")).toThrow(/CHECK/i);
    expect(() => dec("0.01", "'chute'")).toThrow(/CHECK/i);
    expect(() => b.executar("INSERT INTO conta_openrouter (conta_id,cofre_entrada_id,ultimos4) VALUES ('conta_1','cof_x','12345')")).toThrow(/CHECK/i);
    expect(() => b.executar("INSERT INTO conta_openrouter (conta_id,cofre_entrada_id,ultimos4) VALUES ('conta_1','cof_x','1234')")).not.toThrow();
  });

  it("cascata: apagar a conta/workspace limpa o que depende; FKs sem segredo", () => {
    const b = novo();
    migrar(b);
    semear(b);
    b.executar("INSERT INTO conta_roteamento (conta_id,atualizado_em) VALUES ('conta_1',?)", [TS]);
    b.executar("INSERT INTO limite_manual VALUES ('conta_1','weekly',10,NULL,?)", [TS]);
    b.executar("INSERT INTO harness_workspace (workspace_id,atualizado_em) VALUES ('ws_1',?)", [TS]);
    atual = b;
    politica("pol_w", "ws_1");
    b.executar("DELETE FROM conta WHERE id='conta_1'");
    expect(b.consultar("SELECT * FROM conta_roteamento")).toHaveLength(0);
    expect(b.consultar("SELECT * FROM limite_manual")).toHaveLength(0);
    b.executar("DELETE FROM workspace WHERE id='ws_1'");
    expect(b.consultar("SELECT * FROM harness_workspace")).toHaveLength(0);
    expect(b.consultar("SELECT * FROM politica")).toHaveLength(0);
    // nenhuma coluna de segredo em nenhuma tabela nova
    for (const t of TABELAS_HARNESS) {
      const cols = b.consultar<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name);
      expect(cols.filter((c) => /chave|senha|segredo|secret|valor_cifrado|^token$|_token$/i.test(c)), t).toEqual([]);
    }
  });
});
