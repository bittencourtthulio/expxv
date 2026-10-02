import { describe, expect, it } from "vitest";
import { GRADE_VAZIA, reduzir } from "./estado";
import { chaveDaSessao, contarPorWorkspace, criarMemoriaDeWorkspaces, criarSeletorDaVisao, filtrarPorWorkspace, idsConhecidos } from "./por-workspace";

const s = (sessao_id: string, workspace_id?: string | null, extra: { atividade?: string } = {}) => ({ sessao_id, workspace_id, estado: "executando", ...extra });

describe("filtro por workspace (D-570)", () => {
  const todas = [s("a1", "A"), s("b1", "B"), s("n1", null), s("a2", "A"), s("v1"), s("b2", "B"), s("a3", "A")];

  it("devolve só as sessões do workspace pedido, na ordem estável de entrada", () => {
    expect(filtrarPorWorkspace(todas, "A").map((x) => x.sessao_id)).toEqual(["a1", "a2", "a3"]);
    expect(filtrarPorWorkspace(todas, "B").map((x) => x.sessao_id)).toEqual(["b1", "b2"]);
  });

  it("workspace_id null ou ausente só aparece no grupo 'Sem projeto' e nunca nas outras listas", () => {
    expect(filtrarPorWorkspace(todas, null).map((x) => x.sessao_id)).toEqual(["n1", "v1"]);
    expect(filtrarPorWorkspace(todas, "A").some((x) => x.sessao_id === "n1" || x.sessao_id === "v1")).toBe(false);
  });

  it("workspace que não existe mais (fora dos conhecidos) cai em 'Sem projeto': nunca fica invisível", () => {
    const conhecidos = idsConhecidos({ id: "A" }, [{ id: "B" }]);
    expect(chaveDaSessao(s("x", "Z"), conhecidos)).toBeNull();
    expect(filtrarPorWorkspace([...todas, s("z1", "Z")], null, conhecidos).map((x) => x.sessao_id)).toEqual(["n1", "v1", "z1"]);
    expect(filtrarPorWorkspace([...todas, s("z1", "Z")], "Z", conhecidos)).toEqual([]);
    // lista de workspaces ainda não chegou (null): o id vale como está
    expect(chaveDaSessao(s("x", "Z"), null)).toBe("Z");
  });

  it("conta por workspace, com o grupo sem projeto na chave null e sem chaves vazias", () => {
    const c = contarPorWorkspace(todas);
    expect(c.get("A")).toBe(3);
    expect(c.get("B")).toBe(2);
    expect(c.get(null)).toBe(2);
    expect(c.has("C")).toBe(false);
  });
});

describe("memória por workspace (D-570)", () => {
  it("guarda e devolve o estado de cada workspace sem misturar; 'Sem projeto' tem a chave própria", () => {
    const m = criarMemoriaDeWorkspaces();
    const a = reduzir(GRADE_VAZIA, { tipo: "nova-aba", sessao_id: "a1" });
    const b = reduzir(reduzir(GRADE_VAZIA, { tipo: "nova-aba", sessao_id: "b1" }), { tipo: "dividir", alvo: "b1", orientacao: "vertical", nova: "b2" });
    m.guardar("A", { grade: a, focoUnico: true });
    m.guardar("B", { grade: b, focoUnico: false });
    m.guardar(null, { grade: GRADE_VAZIA, focoUnico: false });
    expect(m.obter("A")?.grade).toBe(a);
    expect(m.obter("A")?.focoUnico).toBe(true);
    expect(m.obter("B")?.grade.abas[0]?.arvore.tipo).toBe("divisao");
    expect(m.obter(null)?.grade).toBe(GRADE_VAZIA);
    expect(m.obter("C")).toBeUndefined();
  });

  it("workspace removido limpa o estado dele; os que seguem e o 'Sem projeto' ficam", () => {
    const m = criarMemoriaDeWorkspaces();
    for (const k of ["A", "B", null] as const) m.guardar(k, { grade: GRADE_VAZIA, focoUnico: false });
    expect(m.manterApenas(new Set(["A"]))).toBe(1);
    expect(m.obter("B")).toBeUndefined();
    expect(m.obter("A")).toBeDefined();
    expect(m.obter(null)).toBeDefined();
    expect(m.tamanho()).toBe(2);
  });
});

describe("seletor com memória da tela (sem re-render por sessão oculta)", () => {
  const base = (sessoes: ReturnType<typeof s>[], extra: object = {}) => ({ sessoes, falhas: {} as Record<string, string>, aguardando: 99, ferramentas: null, erro: null, ...extra });

  it("só as sessões do workspace entram e 'aguardando' conta só o workspace visível", () => {
    const sel = criarSeletorDaVisao<ReturnType<typeof s> & { estado: string; atividade?: string }, ReturnType<typeof base> & { sessoes: Array<ReturnType<typeof s> & { atividade?: string }> }>();
    const e = base([s("a1", "A", { atividade: "aguardando" }), s("b1", "B", { atividade: "aguardando" }), s("b2", "B")]);
    const r = sel(e as never, "A", null);
    expect(r.sessoes.map((x) => x.sessao_id)).toEqual(["a1"]);
    expect(r.aguardando).toBe(1);
    expect(sel(e as never, "B", null).aguardando).toBe(1);
  });

  it("mudança só em sessão de OUTRO workspace devolve a mesma referência (nada re-renderiza)", () => {
    const sel = criarSeletorDaVisao<any, any>();
    const a1 = s("a1", "A");
    const e1 = base([a1, s("b1", "B")]);
    const r1 = sel(e1, "A", null);
    const e2 = base([a1, { ...s("b1", "B"), atividade: "aguardando" }]);
    expect(sel(e2, "A", null)).toBe(r1);
    // mudança na sessão visível ou nas falhas dela muda
    expect(sel(base([{ ...a1, atividade: "trabalhando" }, s("b1", "B")]), "A", null)).not.toBe(r1);
    const r3 = sel(base([a1], { falhas: { a1: "x" } }), "A", null);
    expect(r3.falhas).toEqual({ a1: "x" });
    expect(sel(base([a1], { falhas: { a1: "x", b1: "y" } }), "A", null)).toBe(r3); // falha de oculta não conta
    // campo global (erro) muda: nova referência
    expect(sel(base([a1], { falhas: { a1: "x" }, erro: "falhou" }), "A", null)).not.toBe(r3);
  });
});
