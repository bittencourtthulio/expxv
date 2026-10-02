import { describe, expect, it, vi } from "vitest";
import type { OpcoesPerfilCli, SquadResumo } from "../../compartilhado/squads";
import { agruparLista, criarStoreSquads, filtrarLista } from "./squads";

const r = (slug: string, extra: Partial<SquadResumo> = {}): SquadResumo => ({ slug, nome: slug.toUpperCase(), escopo: "desenvolvimento", origem: "usuario", membros: 4, clis: ["claude"], valida: true, atualizacao_de_fabrica: false, em_uso: false, hash: "h".repeat(64), ...extra });
const lista = [r("alfa"), r("beta", { origem: "fabrica", nome: "Revisão Crítica", escopo: "qualidade" }), r("gama", { origem: "importada" }), r("delta", { origem: "fabrica", atualizacao_de_fabrica: true })];

describe("filtrarLista / agruparLista", () => {
  it("busca por nome, slug e escopo sem acento nem caixa", () => {
    expect(filtrarLista(lista, "revisao", "todas").map((s) => s.slug)).toEqual(["beta"]);
    expect(filtrarLista(lista, "QUALIDADE", "todas").map((s) => s.slug)).toEqual(["beta"]);
    expect(filtrarLista(lista, "gam", "todas").map((s) => s.slug)).toEqual(["gama"]);
    expect(filtrarLista(lista, "", "todas")).toHaveLength(4);
  });
  it("filtro de origem: minhas = usuário + importadas; fábrica", () => {
    expect(filtrarLista(lista, "", "minhas").map((s) => s.slug)).toEqual(["alfa", "gama"]);
    expect(filtrarLista(lista, "", "fabrica").map((s) => s.slug)).toEqual(["beta", "delta"]);
  });
  it("agrupa em Minhas e Fábrica, omitindo grupo vazio", () => {
    expect(agruparLista(lista).map((g) => [g.rotulo, g.itens.length])).toEqual([["Minhas", 2], ["Fábrica", 2]]);
    expect(agruparLista(lista.filter((s) => s.origem === "fabrica")).map((g) => g.rotulo)).toEqual(["Fábrica"]);
  });
});

function api(extra: Record<string, unknown> = {}) {
  const ouvintes: Array<(e: { slug: string; tipo: string }) => void> = [];
  const squads = {
    listar: vi.fn().mockResolvedValue(lista),
    obter: vi.fn(), gravar: vi.fn().mockResolvedValue({ ok: true, hash: "n".repeat(64), achados: [], squad: {} }),
    validar: vi.fn().mockResolvedValue([]), duplicar: vi.fn().mockResolvedValue({ slug: "alfa-copia" }), apagar: vi.fn().mockResolvedValue({ ok: true }),
    assinar: vi.fn((cb) => { ouvintes.push(cb); return () => undefined; }),
    ...extra,
  };
  const opcoes: OpcoesPerfilCli = { modelos: [{ modelo: "sonnet", padrao: true }], niveis_esforco: ["low", "high"], esforco_modo: "flag", instalada: true };
  const agentes = { opcoesDePerfil: vi.fn().mockResolvedValue(opcoes) };
  return { squads, agentes, emitir: (e: { slug: string; tipo: string }) => ouvintes.forEach((o) => o(e)) };
}

describe("store de squads", () => {
  it("carrega a lista uma vez; chamadas simultâneas se juntam", async () => {
    const a = api();
    const s = criarStoreSquads({ squads: () => a.squads as never, agentes: () => a.agentes as never });
    await Promise.all([s.carregar(), s.carregar()]);
    expect(a.squads.listar).toHaveBeenCalledTimes(1);
    expect(s.obter().lista).toHaveLength(4);
  });
  it("sem API (fora do Electron): indisponível e lista vazia", async () => {
    const s = criarStoreSquads({ squads: () => undefined, agentes: () => undefined });
    await s.carregar();
    expect(s.obter()).toMatchObject({ disponivel: false, lista: [] });
  });
  it("erro de listagem vira mensagem, sem derrubar", async () => {
    const a = api({ listar: vi.fn().mockRejectedValue(new Error("boom")) });
    const s = criarStoreSquads({ squads: () => a.squads as never, agentes: () => a.agentes as never });
    await s.carregar();
    expect(s.obter().erro).toMatch(/boom/);
    expect(s.obter().lista).toEqual([]);
  });
  it("iniciar liga UMA assinatura de eventos e recarrega (coalescido) quando uma squad muda", async () => {
    vi.useFakeTimers();
    const a = api();
    const s = criarStoreSquads({ squads: () => a.squads as never, agentes: () => a.agentes as never, atrasoMs: 50 });
    await s.iniciar();
    await s.iniciar();
    expect(a.squads.assinar).toHaveBeenCalledTimes(1);
    a.squads.listar.mockClear();
    a.emitir({ slug: "alfa", tipo: "gravada" });
    a.emitir({ slug: "beta", tipo: "externa" });
    await vi.advanceTimersByTimeAsync(60);
    expect(a.squads.listar).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it("seleção, busca e filtro", async () => {
    const a = api();
    const s = criarStoreSquads({ squads: () => a.squads as never, agentes: () => a.agentes as never });
    await s.carregar();
    s.selecionar("alfa");
    s.definirBusca("be");
    s.definirFiltro("fabrica");
    expect(s.obter()).toMatchObject({ selecionada: "alfa", busca: "be", filtro: "fabrica" });
  });
  it("opções de perfil por CLI vêm do main uma vez e ficam em cache", async () => {
    const a = api();
    const s = criarStoreSquads({ squads: () => a.squads as never, agentes: () => a.agentes as never });
    const [x, y] = await Promise.all([s.opcoes("claude"), s.opcoes("claude")]);
    expect(x).toBe(y);
    await s.opcoes("claude");
    expect(a.agentes.opcoesDePerfil).toHaveBeenCalledTimes(1);
  });
  it("duplicar seleciona a cópia; apagar limpa a seleção; ambos recarregam", async () => {
    const a = api();
    const s = criarStoreSquads({ squads: () => a.squads as never, agentes: () => a.agentes as never });
    await s.carregar();
    s.selecionar("alfa");
    const cp = await s.duplicar({ slug: "alfa" });
    expect(cp.slug).toBe("alfa-copia");
    expect(s.obter().selecionada).toBe("alfa-copia");
    await s.apagar("alfa-copia", "alfa-copia");
    expect(a.squads.apagar).toHaveBeenCalledWith("alfa-copia", "alfa-copia");
    expect(s.obter().selecionada).toBeNull();
    expect(a.squads.listar.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("hashDe devolve o hash da lista (usado em hash_esperado)", async () => {
    const a = api();
    const s = criarStoreSquads({ squads: () => a.squads as never, agentes: () => a.agentes as never });
    await s.carregar();
    expect(s.hashDe("alfa")).toBe("h".repeat(64));
    expect(s.hashDe("nada")).toBeNull();
  });
});
