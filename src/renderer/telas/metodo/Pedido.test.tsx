// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComandoSugerido, ResultadoDisparo } from "../../../compartilhado/dominio";
import { criarStoreExecucaoMetodo, type StoreExecucaoMetodo } from "../../estado/execucao-metodo";
import { criarStoreGeracao } from "../../estado/contexto-geracao";
import { estadoSuite, WS, criarStoreFalso } from "../../estado/suite-fixtures";
import { Pedido } from "./Pedido";
import { faseLegivel } from "./util";
import { indice, tk, trabalho } from "./fabrica";

const LIVRE: ComandoSugerido = { comando: "/expx:sprintx exportar pdf", pane_separado: false, somente_humano: false, motivo_bloqueio: null };
let ir: Mock<(s: string) => void>; let term: Mock<() => void>; let ex: StoreExecucaoMetodo; let mem: Map<string, string>;

function instalar(res: ResultadoDisparo | (() => Promise<ResultadoDisparo>) = { ok: true, pane_id: "p1", comando: LIVRE.comando, motivo: null, sessao_id: "s1", estado: "entregue", entrega: "prompt_inicial" }, sug: ComandoSugerido = LIVRE) {
  const disparar = vi.fn(typeof res === "function" ? res : async () => res);
  const comandoSugerido = vi.fn(async () => sug);
  (globalThis as unknown as { ade: unknown }).ade = { metodo: { comandoSugerido, disparar } };
  return { disparar, comandoSugerido };
}
const campo = () => screen.getByRole("textbox", { name: /O que você quer construir ou corrigir/ }) as HTMLTextAreaElement;
const escrever = (t: string) => fireEvent.change(campo(), { target: { value: t } });
const montar = (extra: Partial<Parameters<typeof Pedido>[0]> = {}) => render(<Pedido workspaceId={WS} indice={null} execucao={ex} {...extra} />);

beforeEach(() => {
  ir = vi.fn<(s: string) => void>(); term = vi.fn<() => void>(); mem = new Map();
  ex = criarStoreExecucaoMetodo({ irParaSessao: ir, irParaTerminais: term, irParaMetodo: vi.fn(), config: () => undefined, armazem: () => ({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }) });
});
afterEach(() => { cleanup(); delete (globalThis as { ade?: unknown }).ade; });

describe("Pedido: gesto e botão", () => {
  it("o rótulo do botão primário e o comando previsto mudam com o gesto escolhido", () => {
    instalar();
    montar();
    expect(screen.getByRole("button", { name: "Criar feature" })).toBeTruthy();
    expect(screen.getByTestId("comando-previsto").textContent).toBe("/expx:sprintx <seu pedido>");
    fireEvent.click(screen.getByRole("radio", { name: /Corrigir um bug/ }));
    expect(screen.getByRole("button", { name: "Corrigir bug" })).toBeTruthy();
    expect(screen.getByTestId("comando-previsto").textContent).toContain("/expx:runx");
    fireEvent.click(screen.getByRole("button", { name: /^Mais$/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Gerar convenções/ }));
    expect(screen.getByRole("button", { name: "Gerar convenções" })).toBeTruthy();
    expect(screen.getByTestId("comando-previsto").textContent).toBe("/expx:stackx-detectar");
  });
  it("exemplos clicáveis preenchem o campo e escolhem o gesto", () => {
    instalar();
    montar();
    fireEvent.click(screen.getByRole("button", { name: /Botão Salvar não responde/ }));
    expect(campo().value).toMatch(/Salvar não responde quando/);
    expect((screen.getByRole("radio", { name: /Corrigir um bug/ }) as HTMLInputElement).checked).toBe(true);
  });
  it("pedido vazio: pede o texto e não dispara", async () => {
    const f = instalar();
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Criar feature" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Descreva o pedido/);
    expect(f.disparar).not.toHaveBeenCalled();
  });
});

describe("Pedido: ir ao terminal", () => {
  it("sucesso leva ao terminal na sessão certa, anuncia e guarda a faixa", async () => {
    const f = instalar();
    montar();
    escrever("exportar pdf");
    fireEvent.click(screen.getByRole("button", { name: "Criar feature" }));
    await waitFor(() => expect(f.disparar).toHaveBeenCalledWith({ workspace_id: WS, trabalho_id: null, gesto: "nova_feature", argumento: "exportar pdf", pane_id: null }));
    await waitFor(() => expect(ir).toHaveBeenCalledWith("s1"));
    expect(screen.getByText("Comando enviado; abrindo o terminal")).toBeTruthy();
    expect(ex.obter().execucao).toMatchObject({ rotulo: "Nova feature", resumo: "exportar pdf" });
  });
  it("falha não navega e mostra o motivo na própria tela", async () => {
    instalar({ ok: false, pane_id: "p1", comando: null, motivo: "A CLI claude saiu antes de receber o comando. Abra o Pane e confira.", sessao_id: "s1", estado: "falhou", entrega: null });
    montar();
    escrever("x");
    fireEvent.click(screen.getByRole("button", { name: "Criar feature" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/saiu antes de receber/);
    expect(ir).not.toHaveBeenCalled(); expect(term).not.toHaveBeenCalled();
    expect(ex.obter().execucao).toBeNull();
  });
  it("sem CLI: aviso com caminho para Provedores", async () => {
    instalar({ ok: false, pane_id: null, comando: null, motivo: "Nenhuma CLI compatível está instalada: instale o Claude Code ou OpenCode." });
    montar();
    escrever("x");
    fireEvent.click(screen.getByRole("button", { name: "Criar feature" }));
    expect(await screen.findByRole("button", { name: "Abrir Provedores" })).toBeTruthy();
  });
  it("preferência desligada: dispara e fica; o menu 'Disparar e ir' vence a preferência", async () => {
    instalar();
    await ex.definirIrAoTerminal(false);
    montar();
    escrever("a");
    fireEvent.click(screen.getByRole("button", { name: "Criar feature" }));
    await waitFor(() => expect(ex.obter().execucao).not.toBeNull());
    expect(ir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mais formas de disparar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Disparar e ir para o terminal/ }));
    await waitFor(() => expect(ir).toHaveBeenCalledWith("s1"));
  });
  it("atalhos: Ctrl+Enter dispara e vai; Ctrl+Shift+Enter dispara e fica", async () => {
    instalar();
    montar();
    escrever("a");
    fireEvent.keyDown(campo(), { key: "Enter", shiftKey: true, ctrlKey: true });
    await waitFor(() => expect(ex.obter().execucao).not.toBeNull());
    expect(ir).not.toHaveBeenCalled();
    fireEvent.keyDown(campo(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(ir).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(campo(), { key: "Enter" });
    await act(async () => {});
    expect(ir).toHaveBeenCalledTimes(1);
  });
  it("a preferência é um checkbox rotulado", async () => {
    instalar();
    montar();
    const caixa = screen.getByRole("checkbox", { name: "Ir para o terminal ao disparar" }) as HTMLInputElement;
    expect(caixa.checked).toBe(true);
    fireEvent.click(caixa);
    expect(ex.obter().irAoTerminal).toBe(false);
  });
});

describe("Pedido: rascunho", () => {
  it("salva por workspace e restaura ao montar de novo (Voltar ao Método não perde o texto)", async () => {
    vi.useFakeTimers();
    try {
      instalar();
      const a = montar();
      escrever("meu pedido");
      fireEvent.click(screen.getByRole("radio", { name: /Novo projeto/ }));
      await act(async () => { vi.advanceTimersByTime(400); });
      a.unmount();
      montar();
      expect(campo().value).toBe("meu pedido");
      expect((screen.getByRole("radio", { name: /Novo projeto/ }) as HTMLInputElement).checked).toBe(true);
      cleanup();
      render(<Pedido workspaceId="outro" indice={null} execucao={ex} />);
      expect(campo().value).toBe("");
    } finally { vi.useRealTimers(); }
  });
});

describe("Pedido: primeiro uso e avisos", () => {
  it("suíte instalada e sem trabalhos: checklist com contexto por gerar; 'Gerar agora' usa a pipeline do contexto", async () => {
    instalar();
    const m = criarStoreFalso(estadoSuite("completa"));
    m.store.ligar();
    await m.store.garantirEstado(WS, true); await m.store.garantirModulos(WS, true);
    const g = criarStoreGeracao({ disparar: vi.fn(async () => ({ ok: true, pane_id: "p", comando: "/expx:stackx-detectar", motivo: null })), aoEnviar: vi.fn() });
    const iniciar = vi.spyOn(g, "iniciar");
    localStorage.setItem(`${(await import("../../../nucleo/produto")).PRODUTO.id}.metodo.gerar_contexto_confirmado`, "1");
    montar({ suite: m.store, geracao: g, indice: indice([]) });
    expect(await screen.findByRole("region", { name: "Primeiros passos" })).toBeTruthy();
    expect(screen.getByText("Suíte instalada")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar agora" }));
    expect(iniciar).toHaveBeenCalled();
    expect(screen.getByText("Escrever o primeiro pedido")).toBeTruthy();
    localStorage.clear();
  });
  it("com trabalho existente o checklist some", async () => {
    instalar();
    const m = criarStoreFalso(estadoSuite("completa"));
    m.store.ligar();
    await m.store.garantirEstado(WS, true);
    montar({ suite: m.store, indice: indice([trabalho([tk("T-1")])]) });
    await act(async () => {});
    expect(screen.queryByRole("region", { name: "Primeiros passos" })).toBeNull();
  });
  it("suíte ausente: aviso com botão Instalar e disparo desabilitado", async () => {
    instalar();
    const m = criarStoreFalso(estadoSuite("ausente"));
    m.store.ligar();
    await m.store.garantirEstado(WS, true);
    montar({ suite: m.store });
    expect(await screen.findByRole("button", { name: "Instalar a suíte" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Criar feature" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("status legível dos trabalhos", () => {
  const base = trabalho([tk("T-1")]);
  it("planejando, executando, aguardando você e concluído", () => {
    expect(faseLegivel({ ...base, estagio: "f3", status: "em_andamento" })).toBe("planejando");
    expect(faseLegivel({ ...base, estagio: "f6", status: "em_andamento" })).toBe("executando");
    expect(faseLegivel({ ...base, estagio: "f6", status: "bloqueado" })).toBe("aguardando");
    expect(faseLegivel({ ...base, estagio: "p5", status: "em_andamento", prodx: { veredito: "fazer", assinado: false, briefing: false } })).toBe("aguardando");
    expect(faseLegivel({ ...base, status: "concluido" })).toBe("concluido");
  });
});

function simularMedia(estreito: boolean) {
  const antes = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: estreito && /max-width/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  return () => { window.matchMedia = antes; };
}

describe("Pedido: conversa", () => {
  it("estado vazio convida a pedir e mostra exemplos; sem mensagens ainda", () => {
    instalar();
    montar();
    expect(screen.getByRole("heading", { name: /Peça, e o agente começa/ })).toBeTruthy();
    expect(screen.queryByTestId("mensagem-pedido")).toBeNull();
  });
  it("o composer envia e a conversa mostra o pedido (bolha) e a resposta do ADE com o comando exato e o atalho ao terminal", async () => {
    instalar();
    await ex.definirIrAoTerminal(false);
    montar();
    escrever("exportar pdf com filtro");
    fireEvent.click(screen.getByRole("button", { name: "Criar feature" }));
    const bolha = await screen.findByTestId("mensagem-pedido");
    expect(bolha.textContent).toContain("exportar pdf com filtro");
    expect(bolha.textContent).toContain("Nova feature");
    const resposta = screen.getByRole("article", { name: /Resposta do ADE ao pedido Nova feature/ });
    expect(resposta.textContent).toContain("Enviado ao agente em Pane p1");
    expect(resposta.textContent).toContain("entregue");
    expect(resposta.textContent).toContain(LIVRE.comando);
    fireEvent.click(screen.getByRole("button", { name: "Ir para o terminal" }));
    expect(ir).toHaveBeenCalledWith("s1");
    // o próximo pedido empilha, sem apagar o anterior
    escrever("outro");
    fireEvent.click(screen.getByRole("button", { name: "Criar feature" }));
    await waitFor(() => expect(screen.getAllByTestId("mensagem-pedido")).toHaveLength(2));
  });
  it("a conversa é do workspace: outro workspace começa vazio", async () => {
    instalar();
    await ex.definirIrAoTerminal(false);
    const a = montar();
    escrever("a");
    fireEvent.click(screen.getByRole("button", { name: "Criar feature" }));
    await screen.findByTestId("mensagem-pedido");
    a.unmount();
    render(<Pedido workspaceId="outro" indice={null} execucao={ex} />);
    expect(screen.queryByTestId("mensagem-pedido")).toBeNull();
  });
});

describe("Pedido: lateral de gestos", () => {
  it("escolher o gesto na lateral ajusta o botão, o comando e o campo (gesto sem pedido desabilita o texto)", () => {
    instalar();
    montar();
    const lateral = screen.getByRole("complementary", { name: "Gestos do método" });
    expect(lateral.textContent).toContain("O que você quer fazer?");
    expect(lateral.textContent).toContain("/expx:sprintx");
    fireEvent.click(screen.getByRole("radio", { name: /Novo projeto/ }));
    expect(screen.getByRole("button", { name: "Criar projeto" })).toBeTruthy();
    expect(screen.getByTestId("comando-previsto").textContent).toContain("/expx:buildx");
    fireEvent.click(screen.getByRole("button", { name: /^Mais$/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Indexar a memória/ }));
    expect((screen.getByRole("textbox", { name: /Indexar a memória: não precisa de pedido/ }) as HTMLTextAreaElement).disabled).toBe(true);
  });
  it("'Novo pedido' vindo de Trabalhos: o composer adota o gesto pedido e consome o pedido", async () => {
    instalar();
    montar();
    act(() => ex.abrirComGesto("nova_ocorrencia"));
    await waitFor(() => expect((screen.getByRole("radio", { name: /Corrigir um bug/ }) as HTMLInputElement).checked).toBe(true));
    expect(ex.obter().gestoSolicitado).toBeNull();
  });
  it("no estreito (< 1100 px) a coluna vira faixa acima do composer e abre sob demanda", () => {
    const restaurar = simularMedia(true);
    try {
      instalar();
      montar();
      expect(screen.queryByRole("complementary", { name: "Gestos do método" })).toBeNull();
      expect(screen.queryByRole("radio", { name: /Corrigir um bug/ })).toBeNull();
      const faixa = screen.getByRole("button", { name: /O que você quer fazer\?.*Nova feature/ });
      expect(faixa.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(faixa);
      fireEvent.click(screen.getByRole("radio", { name: /Corrigir um bug/ }));
      expect(screen.getByRole("button", { name: "Corrigir bug" })).toBeTruthy();
      expect(screen.queryByRole("radio", { name: /Corrigir um bug/ })).toBeNull();
      expect(screen.getByRole("button", { name: /O que você quer fazer\?.*Corrigir um bug/ })).toBeTruthy();
    } finally { restaurar(); }
  });
});
