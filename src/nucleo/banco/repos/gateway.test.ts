import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco";
import { migrar } from "../migrar";
import { MIGRACOES } from "../migracoes";
import { criarRepoGateway } from "./gateway";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-10-01T00:00:00.000Z";

function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r','t','t')");
  b.executar("INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,papel,eh_piloto,estado,criado_em,atualizado_em) VALUES ('pane_1',NULL,'ws_1',1,'cli','nenhum',0,'pronto','t','t')");
  return { b, repo: criarRepoGateway(b) };
}

describe("migration 0018 (catálogo + gateway) e repositório do gateway", () => {
  it("é a versão 18 e cria as tabelas do catálogo e do gateway", () => {
    const b = abrirBanco(":memory:"); abertos.push(b);
    expect(MIGRACOES[17]?.nome).toBe("0018-catalogo-gateway");
    migrar(b);
    const t = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    expect(t).toEqual(expect.arrayContaining(["gateway_config", "gateway_filtro", "gateway_pane", "gateway_auditoria", "catalogo_item", "catalogo_instalacao", "catalogo_politica"]));
  });
  it("migra da v17 com dados, sem perda", () => {
    const b = abrirBanco(":memory:"); abertos.push(b);
    migrar(b, { migracoes: MIGRACOES.slice(0, 17) });
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r','t','t')");
    expect(migrar(b).aplicadas).toContain("0018-catalogo-gateway");
    expect(b.consultarUm("SELECT nome FROM workspace WHERE id='ws_1'")).toEqual({ nome: "n" });
  });

  it("config: padrão seguro (desligado, reduzido) e upsert idempotente", () => {
    const { repo } = novo();
    expect(repo.config("ws_1")).toEqual({ workspace_id: "ws_1", ativo: false, modo_superficie: "reduzido", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300, atualizado_em: null });
    const p = { workspace_id: "ws_1", ativo: true, modo_superficie: "busca" as const, max_ferramentas: 12, limite_por_min: 10, ocioso_s: 90 };
    expect(repo.gravarConfig(p, TS)).toMatchObject({ ativo: true, modo_superficie: "busca", max_ferramentas: 12, atualizado_em: TS });
    expect(repo.gravarConfig({ ...p, ativo: false }, TS).ativo).toBe(false);
  });
  it("constraints recusam valor fora da faixa", () => {
    const { repo } = novo();
    expect(() => repo.gravarConfig({ workspace_id: "ws_1", ativo: true, modo_superficie: "reduzido", max_ferramentas: 0, limite_por_min: 60, ocioso_s: 300 }, TS)).toThrow();
    expect(() => repo.gravarConfig({ workspace_id: "ws_1", ativo: true, modo_superficie: "reduzido", max_ferramentas: 10, limite_por_min: 601, ocioso_s: 300 }, TS)).toThrow();
    expect(() => repo.gravarConfig({ workspace_id: "ws_1", ativo: true, modo_superficie: "reduzido", max_ferramentas: 10, limite_por_min: 60, ocioso_s: 5 }, TS)).toThrow();
  });
  it("filtro por ferramenta e papel: upsert e leitura", () => {
    const { repo } = novo();
    repo.definirRegra("ws_1", { servidor_id: "gh", ferramenta: "x", papel: "executor", habilitada: true }, TS);
    repo.definirRegra("ws_1", { servidor_id: "gh", ferramenta: "x", papel: "executor", habilitada: false }, TS);
    repo.definirRegra("ws_1", { servidor_id: "gh", ferramenta: "x", papel: "revisor", habilitada: true }, TS);
    expect(repo.regras("ws_1")).toHaveLength(2);
    expect(repo.regras("ws_1").find((r) => r.papel === "executor")?.habilitada).toBe(false);
  });
  it("snapshot do Pane: grava, lê, poda vencidos e some em cascata com o Pane", () => {
    const { b, repo } = novo();
    const reg = { pane_id: "pane_1", workspace_id: "ws_1", mission_id: null, papel: "executor", modo: "livre", dados_json: "{}", criado_em: TS, expira_em: "2026-10-02T00:00:00.000Z" };
    repo.gravarPane(reg);
    expect(repo.obterPane("pane_1")).toEqual(reg);
    expect(repo.podarPanes("2026-10-01T12:00:00.000Z")).toBe(0);
    expect(repo.podarPanes("2026-10-02T00:00:01.000Z")).toBe(1);
    repo.gravarPane(reg);
    b.executar("DELETE FROM pane WHERE id='pane_1'");
    expect(repo.obterPane("pane_1")).toBeNull();
  });
  it("auditoria: lista por workspace, mais nova primeiro, só metadado; poda por data", () => {
    const { b, repo } = novo();
    const e = (id: string, em: string, ws = "ws_1") => ({ id, em, workspace_id: ws, pane_id: "pane_1", papel: "executor", servidor_id: "gh", ferramenta: "get", decisao: "permitida" as const, duracao_ms: 5, bytes_entrada: 10, bytes_saida: 20 });
    repo.registrarAuditoria(e("a", "2026-10-01T00:00:01.000Z"));
    repo.registrarAuditoria(e("b", "2026-10-01T00:00:02.000Z"));
    repo.registrarAuditoria(e("c", "2026-10-01T00:00:03.000Z", "ws_2"));
    expect(repo.listarAuditoria("ws_1", 10).map((x) => x.id)).toEqual(["b", "a"]);
    expect(repo.listarAuditoria(null, 10).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(repo.listarAuditoria(null, 1)).toHaveLength(1);
    expect(() => b.executar("INSERT INTO gateway_auditoria (id,em,workspace_id,pane_id,papel,decisao) VALUES ('z','t','w','p','r','hackeada')")).toThrow();
    expect(repo.podarAuditoria("2026-10-01T00:00:02.500Z")).toBe(2);
    expect(repo.listarAuditoria(null, 10).map((x) => x.id)).toEqual(["c"]);
    const colunas = b.consultar<{ name: string }>("PRAGMA table_info(gateway_auditoria)").map((c) => c.name);
    expect(colunas.some((c) => /arg|resultado|payload|conteudo|token|segredo/i.test(c))).toBe(false);
  });
});
