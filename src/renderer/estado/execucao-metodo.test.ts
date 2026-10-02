import { describe, expect, it, vi } from "vitest";
import type { ResultadoDisparo } from "../../compartilhado/dominio";
import { criarStoreExecucaoMetodo, resumirPedido } from "./execucao-metodo";

const ok = (o: Partial<ResultadoDisparo> = {}): ResultadoDisparo => ({ ok: true, pane_id: "p1", comando: "/expx:sprintx x", motivo: null, sessao_id: "s1", ...o });
function criar(pref?: unknown) {
  const ir = vi.fn(); const term = vi.fn(); const metodo = vi.fn();
  const mem = new Map<string, string>();
  const gravar = vi.fn(async () => ({ ok: true as const }));
  const s = criarStoreExecucaoMetodo({
    irParaSessao: ir, irParaTerminais: term, irParaMetodo: metodo,
    config: () => ({ ler: async () => pref, gravar }),
    armazem: () => ({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }),
  });
  return { s, ir, term, metodo, mem, gravar };
}

describe("execução do Método (ir ao Pane)", () => {
  it("sucesso, preferência padrão ligada: foca a sessão que recebeu o comando e anuncia", () => {
    const { s, ir, term } = criar();
    expect(s.registrar(ok(), { workspaceId: "w1", rotulo: "Nova feature", pedido: "  exportar   PDF " })).toBe(true);
    expect(ir).toHaveBeenCalledWith("s1");
    expect(term).not.toHaveBeenCalled();
    expect(s.obter().execucao).toMatchObject({ rotulo: "Nova feature", resumo: "exportar PDF", paneId: "p1" });
    expect(s.obter().anuncio).toBe("Comando enviado; abrindo o terminal");
  });
  it("estado falhou nunca navega, mesmo com ok verdadeiro e sessão conhecida (D-620)", () => {
    const { s, ir, term } = criar();
    expect(s.registrar(ok({ estado: "falhou", motivo: "A CLI saiu antes de receber o comando" }), { workspaceId: "w1", rotulo: "x" })).toBe(false);
    expect(ir).not.toHaveBeenCalled(); expect(term).not.toHaveBeenCalled(); expect(s.obter().execucao).toBeNull();
    expect(s.registrar(ok({ estado: "entregue", entrega: "escrita" }), { workspaceId: "w1", rotulo: "x" })).toBe(true);
  });
  it("sem sessão conhecida: só mostra a tela Terminais", () => {
    const { s, ir, term } = criar();
    s.registrar(ok({ sessao_id: null }), { workspaceId: "w1", rotulo: "x" });
    expect(term).toHaveBeenCalledOnce();
    expect(ir).not.toHaveBeenCalled();
  });
  it("falha nunca navega nem registra", () => {
    const { s, ir, term } = criar();
    expect(s.registrar({ ok: false, pane_id: null, comando: null, motivo: "sem CLI" }, { workspaceId: "w1", rotulo: "x" })).toBe(false);
    expect(ir).not.toHaveBeenCalled(); expect(term).not.toHaveBeenCalled();
    expect(s.obter().execucao).toBeNull();
  });
  it("preferência desligada permanece na tela; 'ir' explícito vence a preferência (e vice-versa)", async () => {
    const { s, ir } = criar(false);
    await s.carregarPreferencia();
    expect(s.obter().irAoTerminal).toBe(false);
    expect(s.registrar(ok(), { workspaceId: "w1", rotulo: "x" })).toBe(false);
    expect(ir).not.toHaveBeenCalled();
    expect(s.obter().anuncio).toBe("Comando enviado ao Pane");
    expect(s.registrar(ok(), { workspaceId: "w1", rotulo: "x" }, true)).toBe(true);
    expect(ir).toHaveBeenCalledOnce();
    const b = criar(true);
    expect(b.s.registrar(ok(), { workspaceId: "w1", rotulo: "x" }, false)).toBe(false);
  });
  it("grava a preferência pela chave do app", async () => {
    const { s, gravar } = criar();
    await s.definirIrAoTerminal(false);
    expect(gravar).toHaveBeenCalledWith("metodo_ir_ao_terminal", false);
    expect(s.obter().irAoTerminal).toBe(false);
  });
  it("rascunho por workspace: persiste, isola e limpa quando vazio", () => {
    const { s, mem } = criar();
    s.salvarRascunho("w1", { texto: "pedido A", gesto: "nova_ocorrencia" });
    s.salvarRascunho("w2", { texto: "pedido B", gesto: "nova_feature" });
    expect(s.rascunho("w1")).toEqual({ texto: "pedido A", gesto: "nova_ocorrencia" });
    expect(s.rascunho("w2").texto).toBe("pedido B");
    expect(s.rascunho("w3")).toEqual({ texto: "", gesto: "nova_feature" });
    s.salvarRascunho("w1", { texto: "  ", gesto: "nova_feature" });
    expect([...mem.keys()].some((k) => k.endsWith("w1"))).toBe(false);
    // um store novo lê o que foi gravado
    const outro = criarStoreExecucaoMetodo({ armazem: () => ({ getItem: (k) => mem.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined }) });
    expect(outro.rascunho("w2").texto).toBe("pedido B");
  });
  it("voltarAoMetodo e dispensar", () => {
    const { s, metodo } = criar();
    s.registrar(ok(), { workspaceId: "w1", rotulo: "x" });
    s.voltarAoMetodo(); expect(metodo).toHaveBeenCalledOnce();
    s.dispensar(); expect(s.obter().execucao).toBeNull();
  });
  it("resumirPedido: uma linha e limite", () => {
    expect(resumirPedido("a\n\nb")).toBe("a b");
    expect(resumirPedido("x".repeat(200))!.length).toBeLessThanOrEqual(90);
    expect(resumirPedido(null)).toBeNull();
  });
});

describe("conversa do Método (histórico e gesto pedido)", () => {
  it("cada entrega vira uma mensagem com o pedido completo, o comando exato e a sessão", () => {
    const { s } = criar();
    s.registrar(ok(), { workspaceId: "w1", rotulo: "Nova feature", gesto: "nova_feature", pedido: "  exportar\n PDF " }, false);
    s.registrar(ok({ pane_id: "p2", sessao_id: null, comando: "/expx:runx x" }), { workspaceId: "w1", rotulo: "Corrigir um bug", gesto: "nova_ocorrencia", pedido: "salvar falha" }, false);
    const h = s.obter().historico;
    expect(h.map((m) => m.id)).toEqual([1, 2]);
    expect(h[0]).toMatchObject({ workspaceId: "w1", gesto: "nova_feature", pedido: "exportar\n PDF", comando: "/expx:sprintx x", paneId: "p1", sessaoId: "s1" });
    expect(h[1]).toMatchObject({ rotulo: "Corrigir um bug", sessaoId: null });
  });
  it("falha não entra na conversa; o histórico tem teto", () => {
    const { s } = criar();
    s.registrar(ok({ estado: "falhou" }), { workspaceId: "w1", rotulo: "x" });
    expect(s.obter().historico).toHaveLength(0);
    for (let i = 0; i < 80; i++) s.registrar(ok(), { workspaceId: "w1", rotulo: "x", pedido: `p${i}` }, false);
    expect(s.obter().historico).toHaveLength(60);
    expect(s.obter().historico.at(-1)?.pedido).toBe("p79");
  });
  it("irAoTerminalDe foca a sessão ou abre Terminais", () => {
    const { s, ir, term } = criar();
    s.irAoTerminalDe({ sessaoId: "s9" }); expect(ir).toHaveBeenCalledWith("s9");
    s.irAoTerminalDe({ sessaoId: null }); expect(term).toHaveBeenCalledOnce();
  });
  it("abrirComGesto publica o gesto (n cresce) e leva ao Método", () => {
    const { s, metodo } = criar();
    s.abrirComGesto("nova_ocorrencia"); s.abrirComGesto("nova_ocorrencia");
    expect(s.obter().gestoSolicitado).toEqual({ gesto: "nova_ocorrencia", n: 2 });
    expect(metodo).toHaveBeenCalledTimes(2);
    s.consumirGestoSolicitado();
    expect(s.obter().gestoSolicitado).toBeNull();
  });
});
