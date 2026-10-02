// Serviço da gestão ágil no main (Fase 18, onda 2): SQLite real, sincronização em lotes, isolamento entre workspaces, IA com consentimento, ação humana,
// ganchos periódicos, painel, exportação e a porta do MCP.
import { afterEach, describe, expect, it } from "vitest";
import { HOJE, WS } from "../../tests/fixtures/agil/gerar";
import { WS_A, WS_B, metodoDaFixture, montarAgil, type MontagemAgil } from "../../tests/fixtures/agil/montagem-main";
import type { ClaimsDeAgil } from "../nucleo/mcp/portas";

const abertos: MontagemAgil[] = [];
const novo = (o: Parameters<typeof montarAgil>[0] = {}): MontagemAgil => { const m = montarAgil(o); abertos.push(m); return m; };
afterEach(() => abertos.splice(0).forEach((m) => m.fechar()));

const piloto = (ws: string, mode: ClaimsDeAgil["mode"] = "agentico"): ClaimsDeAgil => ({ workspace_id: ws, mission_id: "mis_1", pane_id: "pane_1", role: "piloto", mode });

describe("sincronização (lotes, SQLite, órfãos)", () => {
  it("sincroniza o histórico em lotes, persiste e mede o maior lote", async () => {
    const m = novo({ workspaces: [WS] });
    expect(m.servico.sincronizar(WS).iniciado).toBe(true);
    await m.servico.aguardarSincronizacao(WS);
    const est = await m.servico.estado(WS);
    expect(est.base).toMatchObject({ tasks: 160, itens: 160 });
    expect(est.ultima_sincronizacao).not.toBeNull();
    expect(est.erro_sincronizacao).toBeNull();
    expect(m.servico.metricas()["lotes"]).toBeGreaterThanOrEqual(2);
    const pagina = m.servico.backlogListar(WS, { limite: 200 });
    expect(pagina.total).toBe(160);
    expect(pagina.itens.every((i) => i.pontos !== null)).toBe(true); // heurística imediata
  });

  it("segunda sincronização sem mudança pula tudo (nenhum lote) e o disco manda no estado", async () => {
    const m = novo({ workspaces: [WS] });
    m.servico.sincronizar(WS); await m.servico.aguardarSincronizacao(WS);
    const lotes = m.servico.metricas()["lotes"] as number;
    m.servico.sincronizar(WS); await m.servico.aguardarSincronizacao(WS);
    expect(m.servico.metricas()["lotes"]).toBe(lotes);
  });

  it("trabalho que some do disco vira órfão sem apagar histórico", async () => {
    const metodo = metodoDaFixture(5);
    const m = novo({ workspaces: [WS], metodo });
    m.servico.sincronizar(WS); await m.servico.aguardarSincronizacao(WS);
    (metodo as { fontes: unknown }).fontes = async () => (await metodoDaFixture(5).fontes(WS)).slice(0, 3);
    m.servico.sincronizar(WS); await m.servico.aguardarSincronizacao(WS);
    const itens = m.servico.backlogListar(WS, { limite: 200 }).itens;
    expect(itens).toHaveLength(20);
    expect(itens.filter((i) => i.estado_fluxo === "orfao")).toHaveLength(8);
  });

  it("falha do método vira erro curto no estado (sem derrubar) e evento de falha", async () => {
    const metodo = metodoDaFixture(1);
    (metodo as { fontes: unknown }).fontes = async () => { throw new Error("EACCES: sem permissão em /Users/x/segredo token=sk-abcdef0123456789abcd"); };
    const m = novo({ workspaces: [WS], metodo });
    m.servico.sincronizar(WS); await m.servico.aguardarSincronizacao(WS);
    const est = await m.servico.estado(WS);
    expect(est.erro_sincronizacao).toBeTruthy();
    expect(est.erro_sincronizacao).not.toContain("sk-abcdef");
    m.barramento.descarregar();
    expect(m.agoraRenderer.some((e) => e["tipo"] === "sincronizacao_falhou")).toBe(true);
  });
});

describe("isolamento entre workspaces", () => {
  it("nenhum id de A funciona em B (item, sprint, épico, membro)", async () => {
    const m = novo();
    const s = m.servico;
    const item = s.itemCriar(WS_A, { titulo: "Segredo de A" });
    const epico = s.epicoGravar(WS_A, { titulo: "Épico A" });
    const sprint = s.sprintCriar(WS_A, { nome: "S1", inicio: "2027-12-01", fim: "2027-12-12" });
    const membro = s.membroGravar(WS_A, { tipo: "humano", rotulo: "Ana" });
    await expect(s.itemLer(WS_B, item.id)).rejects.toThrow(/not_found|não encontrado/i);
    expect(() => s.itemAtualizar(WS_B, item.id, { titulo: "x" })).toThrow();
    expect(() => s.itemDescartar(WS_B, item.id, "motivo qualquer")).toThrow();
    expect(() => s.itemCriar(WS_B, { titulo: "usa épico alheio", epico_id: epico.id })).toThrow();
    expect(() => s.itemAtualizar(WS_A, item.id, { dono_membro_id: "mbr_inexistente0000" })).toThrow();
    expect(() => s.sprintIniciar(WS_B, sprint.id)).toThrow();
    expect(() => s.sprintItemMover(WS_B, sprint.id, item.id, "adicionar", null)).toThrow();
    expect(() => s.capacidadeLer(WS_B, sprint.id)).toThrow();
    expect(() => s.capacidadeGravar(WS_A, sprint.id, "mbr_inexistente0000", 1)).toThrow();
    expect(() => s.membroGravar(WS_B, { id: membro.id, tipo: "humano", rotulo: "Roubado" })).toThrow();
    await expect(s.estimar(WS_B, [item.id])).rejects.toThrow();
    expect(() => s.estimativaGravar(WS_B, { item_id: item.id, pontos: 5 })).toThrow();
    expect(() => s.estimativaAceitarLote(WS_B, [item.id])).toThrow();
    expect(() => s.itemReordenar(WS_B, item.id, null)).toThrow();
    expect(() => s.epicoApagar(WS_B, epico.id)).toThrow();
    expect(() => s.reviewLer(WS_B, sprint.id)).toThrow();
    expect(() => s.retroLer(WS_B, sprint.id)).toThrow();
    // e o que B enxerga é só de B
    expect(s.backlogListar(WS_B, {}).total).toBe(0);
    expect(s.sprintListar(WS_B)).toEqual([]);
    expect(s.epicoListar(WS_B)).toEqual([]);
    expect(s.membroListar(WS_B)).toEqual([]);
    expect(s.painel(WS_B).base.itens).toBe(0);
    expect(JSON.stringify(s.painel(WS_B))).not.toContain("Segredo de A");
    // o item de A continua intacto
    expect(s.backlogListar(WS_A, {}).itens.map((i) => i.titulo)).toEqual(["Segredo de A"]);
  });

  it("workspace inexistente é recusado; exportação de B nunca traz dado de A", async () => {
    const m = novo();
    expect(() => m.servico.configLer("ws_NAOEXISTE0000")).toThrow();
    m.servico.itemCriar(WS_A, { titulo: "Só de A" });
    await m.servico.exportar(WS_B, "backlog", "csv", null);
    const csv = [...m.arquivos.values()].join("");
    expect(csv).not.toContain("Só de A");
  });

  it("a porta do MCP só enxerga o workspace do token", async () => {
    const m = novo();
    const a = m.servico.itemCriar(WS_A, { titulo: "item de A" });
    const lista = (await m.servico.portaMcp.chamar("backlog_list", piloto(WS_B), {})) as { items: unknown[] };
    expect(lista.items).toEqual([]);
    await expect(m.servico.portaMcp.chamar("backlog_get", piloto(WS_B), { item_id: a.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(m.servico.portaMcp.chamar("estimate_get", piloto(WS_B), { item_ref: a.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(m.servico.portaMcp.chamar("estimate_propose", piloto(WS_B), { item_ref: a.id, points: 5 })).rejects.toMatchObject({ code: "not_found" });
  });
});
