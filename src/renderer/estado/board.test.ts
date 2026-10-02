import { describe, expect, it, vi } from "vitest";
import { COLUNAS_BOARD, type BoardModelo, type CardBoard, type ColunaBoard } from "../../compartilhado/custo";
import type { ArmazemLike } from "./board-filtros";
import { compartilharEstrutura, criarStoreBoard, igualCard } from "./board";

const card = (n: number, extra: Partial<CardBoard> = {}): CardBoard => ({
  chave: `w|t|T-${n}`, task_id: `T-${n}`, trabalho_id: "t", trabalho_titulo: "T", workspace_id: "w", fase: null, titulo: `Task ${n}`, coluna: "a_fazer", selos: ["pronta"], depende_de: [], suite: "nao_executada",
  mission_id: null, executor: null, handoff_status: null, duracao_observada_ms: null, custo: { usd: null, incompleto: false, aproximado: false }, ...extra,
});
const resumoVazio = { usd: null, incompleto: false, aproximado: false, tokens: { entrada: 0, cache_escrita: 0, cache_leitura: 0, saida: 0 }, registros: 0, modelos: [], fontes_ausentes: [], atualizado_em: null };
const modelo = (cards: CardBoard[], versao = 1): BoardModelo => {
  const colunas = Object.fromEntries(COLUNAS_BOARD.map((c) => [c, [] as CardBoard[]])) as Record<ColunaBoard, CardBoard[]>;
  for (const c of cards) colunas[c.coluna].push(c);
  const wip = Object.fromEntries(COLUNAS_BOARD.map((c) => [c, { total: 0, limite: null, excedido: false }])) as BoardModelo["wip"];
  return { versao, gerado_em: "x", colunas, progresso: { total: cards.length, descartado: 0, concluido: 0, validado: 0, pct_concluido: 0, pct_validado: 0 }, trabalhos: [], custo: resumoVazio, wip, descartados: [] };
};
const armazemVazio: ArmazemLike = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

describe("compartilhamento estrutural", () => {
  it("card igual mantém a referência; só o alterado troca; coluna inalterada mantém o array", () => {
    const a = modelo([card(1), card(2), card(3, { coluna: "concluido" })]);
    const b = modelo([card(1), card(2, { custo: { usd: 1, incompleto: false, aproximado: false } }), card(3, { coluna: "concluido" })], 2);
    const r = compartilharEstrutura(a, b);
    expect(r.colunas.a_fazer[0]).toBe(a.colunas.a_fazer[0]);
    expect(r.colunas.a_fazer[1]).not.toBe(a.colunas.a_fazer[1]);
    expect(r.colunas.concluido).toBe(a.colunas.concluido);
    expect(r.versao).toBe(2);
  });
  it("igualCard enxerga selos, executor e custo", () => {
    expect(igualCard(card(1), card(1))).toBe(true);
    expect(igualCard(card(1), card(1, { selos: [] }))).toBe(false);
    expect(igualCard(card(1), card(1, { executor: { pane_id: "p", cli: "claude", modelo: null, conta_rotulo: null } }))).toBe(false);
  });
});

describe("store do board", () => {
  const montar = () => {
    let evento: () => void = () => undefined;
    const respostas: BoardModelo[] = [modelo([card(1)])];
    const api = { snapshot: vi.fn(async () => respostas[0]!), assinar: vi.fn((f: () => void) => { evento = f; return () => undefined; }) };
    const store = criarStoreBoard({ api: () => api as never, armazem: armazemVazio });
    return { api, store, respostas, emitir: () => evento() };
  };
  it("carrega ao definir workspace, rajada de eventos vira no máximo uma releitura extra e troca de workspace limpa", async () => {
    const { api, store, emitir } = montar();
    store.iniciar();
    await store.definirWorkspace("w");
    expect(store.obter().modelo?.colunas.a_fazer).toHaveLength(1);
    expect(api.snapshot).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++) emitir();
    await new Promise((r) => setTimeout(r, 5));
    expect(api.snapshot.mock.calls.length).toBeLessThanOrEqual(3);
    const antes = store.obter().modelo;
    await store.definirWorkspace("w2");
    expect(store.obter().modelo === antes).toBe(false);
    expect(store.obter().workspaceId).toBe("w2");
  });
  it("erro vira mensagem e API ausente marca indisponível", async () => {
    const { api, store } = montar();
    await store.definirWorkspace("w");
    api.snapshot.mockRejectedValueOnce(new Error("boom"));
    await store.recarregar();
    expect(store.obter().erro).toMatch(/boom/);
    const sem = criarStoreBoard({ api: () => undefined, armazem: armazemVazio });
    await sem.definirWorkspace("w");
    expect(sem.obter().disponivel).toBe(false);
  });
});
