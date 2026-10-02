import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace, TS } from "../../../tests/fixtures/memoria/banco";
import { criarEscritor } from "./escrita";
import { resolverContextoDoPane } from "./contexto";
import { criarMetricas } from "./metricas";
import { criarRepoMemoria } from "./repo";
import { criarServicoMemoria } from "./servico";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
function mundo() {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  semearMissao(b, "M1", ws);
  semearPane(b, { id: "A", ws, mission: "M1", papel: "piloto", display: 5 });
  return { b, ws, repo: criarRepoMemoria(b), ctx: () => resolverContextoDoPane(b, "A") };
}

describe("repositório da memória (T-08.04)", () => {
  it("config nasce preguiçosa com os padrões (P-21/P-22), grava patch parcial e respeita a chave global", () => {
    const m = mundo();
    expect(m.repo.obterConfig("ws_1")).toEqual({ workspace_id: "ws_1", ativa: true, solo: true, squad: true, orcamento_brief_chars: 6000, retencao_dias: 365, teto_mb: 500, pacote_workers: true, embedding_modelo: null, global_ativa: true });
    const c = m.repo.gravarConfig("ws_1", { solo: false, retencao_dias: 0, orcamento_brief_chars: 8000, embedding_modelo: "hash-256-v1" }, TS);
    expect(c).toMatchObject({ solo: false, retencao_dias: 0, orcamento_brief_chars: 8000, embedding_modelo: "hash-256-v1", ativa: true });
    expect(() => m.repo.gravarConfig("ws_1", { orcamento_brief_chars: 100 }, TS)).toThrow(/CHECK/);
    m.repo.definirGlobalAtiva(false, TS);
    expect(m.repo.obterConfig("ws_1").global_ativa).toBe(false);
    m.repo.definirMissaoAtiva("M1", false, TS);
    expect(m.repo.missaoAtiva("M1")).toBe(false);
    m.repo.definirMissaoAtiva("M1", null, TS);
    expect(m.repo.missaoAtiva("M1")).toBeNull();
  });
  it("listarPaginado: mais novas primeiro, cursor, filtros, display_id do Pane; estado e contagens por escopo", () => {
    const m = mundo();
    const e = criarEscritor({ banco: m.b });
    for (let i = 0; i < 7; i++) e.gravar({ ctx: m.ctx(), tipo: i % 2 ? "decisao" : "fato", conteudo: `entrada número ${i}`, origem: "agente", escopo: i < 4 ? "pane" : "missao" });
    const p1 = m.repo.listarPaginado({ workspace_id: "ws_1", limite: 3 });
    expect(p1.itens).toHaveLength(3);
    expect(p1.itens[0]?.display_id).toBe(5);
    expect(p1.proximo).not.toBeNull();
    const p2 = m.repo.listarPaginado({ workspace_id: "ws_1", limite: 10, depois: p1.proximo });
    expect(p2.itens).toHaveLength(4);
    expect(p2.proximo).toBeNull();
    expect(m.repo.listarPaginado({ workspace_id: "ws_1", escopo: "missao" }).itens).toHaveLength(3);
    expect(m.repo.listarPaginado({ workspace_id: "ws_1", tipos: ["decisao"] }).itens).toHaveLength(3);
    expect(m.repo.listarPaginado({ workspace_id: "ws_1", busca: "número 3" }).itens).toHaveLength(1);
    expect(m.repo.listarPaginado({ workspace_id: "ws_1", busca: "100%_" }).itens).toHaveLength(0); // curingas escapados
    expect(m.repo.contagensPorEscopo("ws_1")).toMatchObject({ pane: 4, missao: 3, squad: 0, workspace: 0, usuario: 0 });
    expect(m.repo.tamanhoBytes("ws_1")).toBeGreaterThan(7 * 200);
  });
  it("carregarParaBrief devolve checkpoint ativo, top decisões/riscos e eventos recentes (1 consulta por seção)", () => {
    const m = mundo();
    const svc = criarServicoMemoria({ banco: m.b });
    svc.memory_checkpoint("A", { summary: "cp1" });
    svc.memory_checkpoint("A", { summary: "cp2", risks: ["r1"] });
    svc.memory_write("A", { content: "d-alta", kind: "decision", importance: 5 });
    svc.memory_write("A", { content: "d-baixa", kind: "decision", importance: 1 });
    const d = m.repo.carregarParaBrief("A");
    expect(d.checkpoint?.conteudo).toBe("cp2");
    expect(d.decisoes.map((x) => x.conteudo)).toEqual(["d-alta", "d-baixa"]);
    expect(d.riscos.map((x) => x.conteudo)).toEqual(["r1"]);
  });
  it("missaoTemAprendizado só conta aprendizado do AGENTE", () => {
    const m = mundo();
    const svc = criarServicoMemoria({ banco: m.b });
    expect(svc.missaoTemAprendizado("M1")).toBe(false);
    svc.memory_write("A", { content: "lição", kind: "learning" });
    expect(svc.missaoTemAprendizado("M1")).toBe(true);
  });
});

describe("métricas sem vazar conteúdo (T-08.20)", () => {
  it("só contadores com nome seguro; nome livre (texto) é ignorado", () => {
    const x = criarMetricas();
    x.contar("memoria.escritas");
    x.contar("memoria.escritas", 2);
    x.contar("conteúdo secreto sk-abc");
    expect(x.instantaneo()).toEqual({ "memoria.escritas": 3 });
  });
  it("o serviço expõe métricas de escrita/dedupe/redação e nada do conteúdo", () => {
    const m = mundo();
    const svc = criarServicoMemoria({ banco: m.b });
    svc.memory_write("A", { content: "texto com API_KEY=abc123", kind: "fact" });
    svc.memory_write("A", { content: "texto com API_KEY=abc123", kind: "fact" });
    const i = svc.metricas.instantaneo();
    expect(i).toMatchObject({ "memoria.escritas": 1, "memoria.dedupe": 1, "memoria.redigidas": 1 });
    expect(JSON.stringify(i)).not.toContain("abc123");
  });
});
