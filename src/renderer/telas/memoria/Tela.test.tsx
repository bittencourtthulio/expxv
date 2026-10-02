// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiMemoria } from "../../../compartilhado/memoria";
import { ENTRADAS_MEMORIA, ESTADO_MEMORIA, entrada, memoriaFalso } from "../../a11y/ade-falso-memoria";
import { instalar, remover } from "../../a11y/ade-falso";
import { criarStoreMemoria } from "../../estado/memoria";
import { storeWorkspaces } from "../../estado/workspaces";
import { TelaMemoria } from "./Memoria";
import { TabelaMemoria } from "./TabelaMemoria";

beforeEach(async () => { instalar(); await storeWorkspaces.iniciar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

async function montar(sobre: Partial<ApiMemoria> = {}) {
  const api = memoriaFalso(sobre);
  const store = criarStoreMemoria({ api: () => api, avisar: () => undefined, quadro: (f) => f() });
  await act(async () => { render(<TelaMemoria store={store} />); });
  return { api, store };
}
const aba = async (nome: string) => { await act(async () => { fireEvent.click(screen.getByRole("tab", { name: nome })); }); };

describe("tela Memória: linha única, tabela e estados", () => {
  it("uma linha de controles com abas, busca, filtros de tipo, origem, missão, contagem e ações", async () => {
    await montar();
    const barra = screen.getByRole("toolbar", { name: "Controles da memória" });
    expect(within(screen.getByRole("tablist", { name: "Escopos da memória" })).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pane", "Missão", "Squad", "Projeto", "Preferências", "Saúde"]);
    expect(within(barra).getByRole("searchbox", { name: "Buscar na memória" })).toBeTruthy();
    expect(within(barra).getByRole("group", { name: "Filtrar por tipo" })).toBeTruthy();
    expect(within(barra).getByLabelText("Origem")).toBeTruthy();
    expect(within(barra).getByLabelText("Missão")).toBeTruthy();
    expect(within(barra).getByRole("button", { name: "Exportar memória" })).toBeTruthy();
    expect(within(barra).getByRole("switch", { name: "Memória deste projeto" })).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });

  it("lista as entradas num grid com aria-rowcount, mostra escudo no que foi mascarado e a fixada", async () => {
    await montar();
    const grade = await screen.findByRole("grid", { name: "Entradas da memória" });
    // escopo "pane": 3 entradas (a do projeto fica na aba Projeto)
    expect(grade.getAttribute("aria-rowcount")).toBe("4");
    expect(within(grade).getAllByRole("row")).toHaveLength(4);
    expect(within(grade).getByRole("img", { name: /Segredo mascarado/ })).toBeTruthy();
    expect(within(grade).getByText("5 fixa")).toBeTruthy();
    expect(within(grade).getByText(/Rota de login pronta/)).toBeTruthy();
  });

  it("estado vazio explica o próximo passo; erro tem 'Tentar de novo'; sem projeto aberto orienta", async () => {
    await montar({ listar: async () => ({ itens: [], proximo: null }) });
    expect(await screen.findByText("Nada gravado ainda: a memória nasce quando um agente decide ou entrega algo.")).toBeTruthy();
    cleanup();
    const listar = vi.fn().mockRejectedValueOnce(new Error("disco cheio")).mockResolvedValue({ itens: ENTRADAS_MEMORIA, proximo: null });
    await montar({ listar });
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("disco cheio");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" })); });
    expect(await screen.findByRole("grid")).toBeTruthy();
  });

  it("carregando mostra aria-busy enquanto a lista não chega", async () => {
    let soltar: (v: { itens: never[]; proximo: null }) => void = () => undefined;
    await montar({ listar: () => new Promise((r) => { soltar = r as never; }) });
    expect(screen.getByText("Carregando memória…").getAttribute("aria-busy")).toBe("true");
    await act(async () => { soltar({ itens: [], proximo: null }); });
  });

  it("filtro de tipo e de origem (cliente) e busca viram pedido; filtro sem resultado diz o que fazer", async () => {
    const listar = vi.fn(async () => ({ itens: ENTRADAS_MEMORIA.filter((e) => e.escopo === "pane"), proximo: null }));
    await montar({ listar });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "risco" })); });
    expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipos: ["risco"] }));
    expect(screen.getByRole("button", { name: "risco" }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => { fireEvent.change(screen.getByLabelText("Origem"), { target: { value: "sistema" } }); });
    expect(await screen.findByText("Nada com esse filtro")).toBeTruthy();
  });

  it("trocar para Projeto lista o escopo do projeto; o texto HTML/markdown da entrada nunca é interpretado", async () => {
    await montar();
    await aba("Projeto");
    const grade = await screen.findByRole("grid", { name: "Entradas da memória" });
    await act(async () => { fireEvent.click(within(grade).getAllByRole("row")[1]!); });
    const gaveta = screen.getByRole("complementary", { name: /aprendizado/ });
    const texto = within(gaveta).getByLabelText("Conteúdo da entrada");
    expect(texto.textContent).toBe("<script>alert(1)</script> **negrito** aprendizado");
    expect(gaveta.querySelector("script")).toBeNull();
    expect(gaveta.querySelector("strong, b")).toBeNull();
  });
});

describe("gaveta: editar, fixar, esquecer", () => {
  const abrir = async (sobre: Partial<ApiMemoria> = {}) => {
    const r = await montar(sobre);
    const grade = await screen.findByRole("grid");
    await act(async () => { fireEvent.click(within(grade).getAllByRole("row")[1]!); });
    return { ...r, gaveta: screen.getByRole("complementary") };
  };

  it("mostra origem, importância e painel; 'redigido' é explicado", async () => {
    await abrir();
    const gaveta = screen.getByRole("complementary");
    expect(within(gaveta).getByText("agente")).toBeTruthy();
    expect(within(gaveta).getByText("#3")).toBeTruthy();
    cleanup();
    const r = await montar();
    const grade = await screen.findByRole("grid");
    await act(async () => { fireEvent.click(within(grade).getAllByRole("row")[2]!); }); // a risco com segredo mascarado
    expect(within(screen.getByRole("complementary")).getByText(/Um segredo foi mascarado/)).toBeTruthy();
    expect(r.api).toBeTruthy();
  });

  it("fixar grava importância 5 e desafixar volta a 3", async () => {
    const atualizar = vi.fn(async (p: { entrada_id: string; importancia?: number }) => ({ ...entrada(p.entrada_id), tipo: "checkpoint" as const, importancia: (p.importancia ?? 3) as 5 }));
    await abrir({ atualizar });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fixar" })); });
    expect(atualizar).toHaveBeenCalledWith({ entrada_id: "mem_1", importancia: 5 });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Desafixar" })); });
    expect(atualizar).toHaveBeenLastCalledWith({ entrada_id: "mem_1", importancia: 3 });
  });

  it("editar valida (vazio/grande) e salva só o texto", async () => {
    const atualizar = vi.fn(async (p: { entrada_id: string; conteudo?: string }) => ({ ...entrada(p.entrada_id), conteudo: p.conteudo ?? "", fonte: "usuario" as const }));
    await abrir({ atualizar });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Editar" })); });
    const campo = screen.getByLabelText("Texto da entrada");
    fireEvent.change(campo, { target: { value: "   " } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/Escreva o texto da entrada/);
    fireEvent.change(campo, { target: { value: "x".repeat(1001) } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/passa de 1000/);
    expect(atualizar).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "texto corrigido" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
    expect(atualizar).toHaveBeenCalledWith({ entrada_id: "mem_1", conteudo: "texto corrigido" });
    await waitFor(() => expect(screen.getByLabelText("Conteúdo da entrada").textContent).toBe("texto corrigido"));
  });

  it("esquecer pede confirmação da UI (nunca window.confirm), atualiza a tabela sem recarregar tudo e fecha a gaveta", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    const listar = vi.fn(async () => ({ itens: ENTRADAS_MEMORIA.filter((e) => e.escopo === "pane"), proximo: null }));
    const esquecer = vi.fn(async () => ({ ok: true }));
    await abrir({ listar, esquecer });
    const chamadas = listar.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Esquecer" })); });
    const dialogo = screen.getByRole("dialog", { name: "Esquecer esta entrada?" });
    expect(esquecer).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Esquecer" })); });
    expect(esquecer).toHaveBeenCalledWith("mem_1");
    expect(confirmar).not.toHaveBeenCalled();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(within(screen.getByRole("grid")).getAllByRole("row")).toHaveLength(3);
    expect(listar.mock.calls.length).toBe(chamadas); // sem recarregar a lista
  });

  it("esquecer o Pane inteiro chama esquecerPane com o pane da entrada", async () => {
    const esquecerPane = vi.fn(async () => ({ removidas: 2 }));
    await abrir({ esquecerPane });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Esquecer este Pane inteiro" })); });
    const d = screen.getByRole("dialog", { name: "Esquecer este Pane inteiro?" });
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Esquecer o Pane" })); });
    expect(esquecerPane).toHaveBeenCalledWith("p1");
  });

  it("Esc fecha a gaveta", async () => {
    await abrir();
    await act(async () => { fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" }); });
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("teclado e virtualização (P-40)", () => {
  it("5 000 entradas: no máximo 80 linhas no DOM; setas movem o foco; Enter abre", () => {
    const muitas = Array.from({ length: 5000 }, (_, i) => entrada(`mem_${i}`, { conteudo: `entrada ${i}` }));
    const abrir = vi.fn();
    render(<TabelaMemoria itens={muitas} selecionadaId={null} aoAbrir={abrir} aoFim={() => undefined} alturaPadrao={1000} />);
    const grade = screen.getByRole("grid");
    expect(grade.getAttribute("aria-rowcount")).toBe("5001");
    const linhas = within(grade).getAllByRole("row");
    expect(linhas.length - 1).toBeLessThanOrEqual(80);
    expect(linhas.length).toBeGreaterThan(10);
    const primeira = grade.querySelector<HTMLElement>('[data-i="0"]')!;
    primeira.focus();
    fireEvent.keyDown(primeira, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-i")).toBe("1");
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(abrir).toHaveBeenCalledWith(expect.objectContaining({ id: "mem_1" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.getAttribute("data-i")).toBe("4999");
  });
});

describe("avisos de teto e chaves", () => {
  it("aviso de teto com ações; memória desligada explica que preserva e não coleta", async () => {
    await montar({ estado: async () => ({ ...ESTADO_MEMORIA, aviso_teto: true, tamanho_bytes: 450 * 1024 * 1024, config: { ...ESTADO_MEMORIA.config, ativa: false } }) });
    await screen.findByRole("grid");
    await waitFor(() => expect(screen.getByText(/perto do teto/)).toBeTruthy());
    expect(screen.getByText(/desligada neste projeto/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Memória deste projeto" }).getAttribute("aria-checked")).toBe("false");
  });

  it("o interruptor do projeto grava `ativa`", async () => {
    const gravarConfig = vi.fn(async (p: object) => ({ ...ESTADO_MEMORIA.config, ...p }));
    await montar({ gravarConfig: gravarConfig as never });
    await act(async () => { fireEvent.click(await screen.findByRole("switch", { name: "Memória deste projeto" })); });
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", ativa: false });
  });
});

describe("Preferências (anel 3)", () => {
  it("lista, valida limite de 300, grava, edita e remove com confirmação", async () => {
    const preferenciasGravar = vi.fn(async (p: { id: string | null; conteudo: string; importancia: number }) => entrada(p.id ?? "mem_n", { escopo: "usuario", anel: 3, tipo: "preferencia", fonte: "usuario", conteudo: p.conteudo }));
    const preferenciasRemover = vi.fn(async () => ({ ok: true }));
    await montar({ preferenciasGravar: preferenciasGravar as never, preferenciasRemover });
    await aba("Preferências");
    expect(await screen.findByText("Responder em português do Brasil")).toBeTruthy();
    expect(screen.getByText(/nunca são gravadas por agentes/)).toBeTruthy();
    const campo = screen.getByLabelText("Nova preferência");
    fireEvent.change(campo, { target: { value: "x".repeat(301) } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Adicionar" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/passa de 300/);
    expect(preferenciasGravar).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "Commits em português" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Adicionar" })); });
    expect(preferenciasGravar).toHaveBeenCalledWith({ id: null, conteudo: "Commits em português", importancia: 3 });
    await screen.findByText("Commits em português");
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[0]!); });
    const d = screen.getByRole("dialog", { name: "Remover a preferência?" });
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Remover" })); });
    expect(preferenciasRemover).toHaveBeenCalled();
  });

  it("limite de 50: recusa adicionar com o motivo", async () => {
    const cheias = Array.from({ length: 50 }, (_, i) => entrada(`mem_p${i}`, { escopo: "usuario", anel: 3, tipo: "preferencia", conteudo: `regra ${i}` }));
    const preferenciasGravar = vi.fn();
    await montar({ preferenciasListar: async () => cheias, preferenciasGravar });
    await aba("Preferências");
    await screen.findByText("regra 0");
    fireEvent.change(screen.getByLabelText("Nova preferência"), { target: { value: "mais uma" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Adicionar" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/Limite de 50/);
    expect(preferenciasGravar).not.toHaveBeenCalled();
  });

  it("vazio explica o próximo passo", async () => {
    await montar({ preferenciasListar: async () => [] });
    await aba("Preferências");
    expect(await screen.findByText("Nenhuma preferência ainda")).toBeTruthy();
  });
});

describe("Saúde (métricas, memox, exportar e apagar)", () => {
  it("mostra tamanho × teto, FTS5, métricas só numéricas e o cartão do memox", async () => {
    await montar();
    await aba("Saúde");
    const painel = await screen.findByRole("region", { name: "Saúde" });
    expect(within(painel).getByRole("progressbar", { name: "Uso do teto de tamanho" })).toBeTruthy();
    expect(within(painel).getByText(/FTS5 ativo/)).toBeTruthy();
    expect(within(painel).getByRole("list", { name: "Métricas de ciclo" }).textContent).toContain("fatias7");
    expect(within(painel).getByRole("region", { name: "Memória do método" })).toBeTruthy();
    expect(within(painel).getByText(/índice com 12 arquivos/)).toBeTruthy();
  });

  it("sem FTS5 explica o modo simples; sem memox explica como instalar", async () => {
    await montar({ estado: async () => ({ ...ESTADO_MEMORIA, fts5: false, memox: { instalado: false, texto: null } }) });
    await aba("Saúde");
    const painel = await screen.findByRole("region", { name: "Saúde" });
    expect(within(painel).getByText(/Modo simples \(sem FTS5\)/)).toBeTruthy();
    expect(within(painel).getByText(/expxdev add memox/)).toBeTruthy();
  });

  it("apagar exige digitar o nome do projeto; confere e chama purgar", async () => {
    const purgar = vi.fn(async () => ({ removidas: 4 }));
    await montar({ purgar });
    await aba("Saúde");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Apagar…" })); });
    const d = screen.getByRole("dialog", { name: "Apagar a memória deste projeto?" });
    const confirmar = within(d).getByRole("button", { name: "Apagar" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Digite o nome do projeto para confirmar"), { target: { value: "w1" } });
    expect(confirmar.disabled).toBe(false);
    await act(async () => { fireEvent.click(confirmar); });
    expect(purgar).toHaveBeenCalledWith({ workspace_id: "w1", escopo: "tudo", confirmacao: "w1" });
  });

  it("exportar chama o canal (o main abre o salvar)", async () => {
    const exportar = vi.fn(async () => ({ caminho_salvo: null }));
    await montar({ exportar });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Exportar memória" })); });
    expect(exportar).toHaveBeenCalledWith("w1", "tudo");
  });

  it("o cartão do memox só DIGITA o comando no terminal escolhido (nunca roda memox.py) e fica desabilitado sem painel", async () => {
    await montar();
    await aba("Saúde");
    const reindexar = await screen.findByRole("button", { name: "Reindexar" });
    expect((reindexar as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Abra um terminal com Claude Code ou OpenCode/)).toBeTruthy();
  });
});
