// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiChat } from "../../../compartilhado/chat";
import { instalar, remover } from "../../a11y/ade-falso";
import { chatFalso, CONVERSA, mensagem, PERFIL_CHAT, PLANO } from "../../a11y/ade-falso-conhecimento";
import { criarStoreChat } from "../../estado/chat";
import { storeWorkspaces } from "../../estado/workspaces";
import { TelaChat } from "./Chat";

beforeEach(async () => { instalar(); await storeWorkspaces.iniciar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

async function montar(sobre: Partial<ApiChat> = {}) {
  const api = chatFalso(sobre);
  const store = criarStoreChat({ api: () => api, avisar: () => undefined, quadro: (f) => f() });
  await act(async () => { render(<TelaChat store={store} />); });
  return { api, store, emitir: (e: Parameters<typeof api.emitir>[0]) => act(async () => { api.emitir(e); }) };
}
const compositor = () => screen.getByRole("textbox", { name: /Mensagem para/ }) as HTMLTextAreaElement;
const digitar = async (t: string) => { await act(async () => { fireEvent.change(compositor(), { target: { value: t } }); }); };
const enter = async (extra: object = {}) => { await act(async () => { fireEvent.keyDown(compositor(), { key: "Enter", ...extra }); }); };
const clicar = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };
const modoOrquestrar = () => clicar(screen.getByRole("radio", { name: "Pedir ao orquestrador" }));

describe("Chat: estados e estrutura", () => {
  it("barra com alternador de modo, CLI/modelo/esforço/faixa; lista de conversas; composer", async () => {
    await montar();
    const barra = screen.getByRole("toolbar", { name: "Controles do chat" });
    expect(within(barra).getByRole("radiogroup", { name: "Modo do chat" })).toBeTruthy();
    expect(within(barra).getByRole("radio", { name: "Perguntar ao RAG" }).getAttribute("aria-checked")).toBe("true");
    for (const n of ["CLI do chat", "Modelo do chat", "Esforço do chat", "Faixa do chat"]) expect(within(barra).getByLabelText(n)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Conversas" })).toBeTruthy();
    expect(compositor()).toBeTruthy();
  });

  it("vazio ensina o que fazer em cada modo", async () => {
    await montar({ lerConversa: async () => ({ conversa: CONVERSA, mensagens: [], planos: [] }) });
    expect(await screen.findByText("Pergunte ao conhecimento do projeto")).toBeTruthy();
    await modoOrquestrar();
    expect(await screen.findByText("Peça ao orquestrador")).toBeTruthy();
  });

  it("carregando mostra aria-busy; erro tem 'Tentar de novo'", async () => {
    let soltar: (v: never) => void = () => undefined;
    await montar({ lerConversa: () => new Promise((r) => { soltar = r as never; }) });
    expect(screen.getByText("Carregando conversa…").getAttribute("aria-busy")).toBe("true");
    await act(async () => { soltar(null as never); });
    cleanup();
    const listar = vi.fn().mockRejectedValueOnce(new Error("banco travado")).mockResolvedValue([CONVERSA]);
    await montar({ listarConversas: listar });
    expect((await screen.findByRole("alert")).textContent).toContain("banco travado");
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("list", { name: "Mensagens da conversa" })).toBeTruthy();
  });

  it("sem CLI disponível: modo busca sem LLM com o motivo; CLIs indisponíveis aparecem desabilitadas com o motivo", async () => {
    await montar({ lerPerfil: async () => ({ perfil: null, clis: PERFIL_CHAT.clis.map((c) => ({ ...c, disponivel: false, motivo: c.motivo ?? "sem login" })) }) });
    expect(await screen.findByText(/Modo busca sem LLM: Nenhuma CLI disponível/)).toBeTruthy();
    const sel = screen.getByLabelText("CLI do chat");
    expect(within(sel).getByRole("option", { name: /codex — indisponível: não instalada/ }).hasAttribute("disabled")).toBe(true);
  });

  it("trocar a CLI grava o perfil; CLI indisponível não pode ser escolhida", async () => {
    const gravarPerfil = vi.fn(chatFalso().gravarPerfil);
    await montar({ gravarPerfil });
    await screen.findByRole("list", { name: "Mensagens da conversa" });
    expect(within(screen.getByLabelText("CLI do chat")).getByRole("option", { name: /codex — indisponível: não instalada/ }).hasAttribute("disabled")).toBe(true);
    await act(async () => { fireEvent.change(screen.getByLabelText("Faixa do chat"), { target: { value: "profundo" } }); });
    expect(gravarPerfil).toHaveBeenCalledWith({ workspace_id: "w1", cli: "claude", modelo: null, esforco: null, faixa: "profundo" });
    await act(async () => { fireEvent.change(screen.getByLabelText("CLI do chat"), { target: { value: "opencode" } }); });
    expect(gravarPerfil).toHaveBeenLastCalledWith(expect.objectContaining({ cli: "opencode" }));
  });

  it("criar e apagar conversas", async () => {
    const criarConversa = vi.fn(chatFalso().criarConversa);
    const apagarConversa = vi.fn(async () => ({ ok: true }));
    await montar({ criarConversa, apagarConversa });
    await screen.findByRole("list", { name: "Mensagens da conversa" });
    await clicar(screen.getByRole("button", { name: "Nova conversa" }));
    expect(criarConversa).toHaveBeenCalledWith({ workspace_id: "w1", modo: "perguntar", titulo: null, mission_alvo_id: null, indexar: false });
    await clicar(screen.getByRole("button", { name: "Apagar conversa Login" }));
    expect(apagarConversa).toHaveBeenCalledWith("cv1");
  });
});

describe("Chat: mensagens, citações e streaming", () => {
  it("mensagens e citações [n] clicáveis abrem a fonte com o trecho (como texto); número inexistente fica texto", async () => {
    const detalheDocumento = vi.fn(async () => ({ fonte: {} as never, chunks: [{ id: "c", trecho: "<b>trecho</b> da fonte" }], aprendizado: null, arestas: [] }));
    (globalThis as unknown as { ade: { conhecimento: { detalheDocumento: typeof detalheDocumento } } }).ade.conhecimento.detalheDocumento = detalheDocumento;
    await montar({ lerConversa: async () => ({ conversa: CONVERSA, mensagens: [mensagem("m1", { papel: "usuario", texto: "Existe?" }), mensagem("m2", { texto: "Sim [1] e talvez [9].", citacoes: [{ n: 1, documento_id: "d1", titulo: "Relatório", origem: "docs/r.md", tipo: "relatorio", ocorrido_em: "2026-09-30T10:00:00Z" }] })], planos: [] }) });
    const lista = await screen.findByRole("list", { name: "Mensagens da conversa" });
    expect(lista.querySelectorAll(".chat-msg")).toHaveLength(2);
    expect(within(lista).getByText(/talvez \[9\]\./)).toBeTruthy();
    expect(within(lista).queryByRole("button", { name: /Fonte 9/ })).toBeNull();
    await clicar(within(lista).getByRole("button", { name: "Fonte 1: Relatório" }));
    const fonte = await within(lista).findByRole("region", { name: "Fonte 1" });
    await waitFor(() => expect(fonte.textContent).toContain("<b>trecho</b> da fonte"));
    expect(fonte.querySelector("b")).toBeNull();
    expect(detalheDocumento).toHaveBeenCalledWith("w1", "d1");
  });

  it("streaming: tokens acumulam, o leitor de tela ouve um aviso educado só no começo e no fim", async () => {
    const m = await montar();
    await screen.findByRole("list", { name: "Mensagens da conversa" });
    await m.emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem("m7", { texto: "", estado: "transmitindo" }) } });
    for (const d of ["Estou ", "pensando ", "[1]"]) await m.emitir({ canal: "chat:token", payload: { mensagem_id: "m7", delta: d } });
    const lista = screen.getByRole("list", { name: "Mensagens da conversa" });
    expect(lista.getAttribute("aria-live")).toBe("off");
    expect(lista.getAttribute("aria-busy")).toBe("true");
    expect(within(lista).getByText(/Estou pensando/).closest(".chat-cursor")).not.toBeNull();
    const status = screen.getAllByRole("status").find((s) => s.className.includes("chat-sr")) as HTMLElement;
    expect(status.textContent).toBe("Assistente respondendo…");
    await m.emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem("m7", { texto: "Estou pensando", estado: "completa" }) } });
    expect(status.textContent).toContain("Assistente respondeu: Estou pensando");
  });

  it("1000 mensagens: só as visíveis existem no DOM", async () => {
    const muitas = Array.from({ length: 1000 }, (_, i) => mensagem(`m${i}`, { texto: `mensagem ${i}`, criado_em: `2026-10-01T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` }));
    await montar({ lerConversa: async () => ({ conversa: CONVERSA, mensagens: muitas, planos: [] }) });
    const lista = await screen.findByRole("list", { name: "Mensagens da conversa" });
    expect(lista.getAttribute("data-total")).toBe("1000");
    expect(lista.querySelectorAll(".chat-msg").length).toBeLessThan(40);
  });
});

describe("Chat: composer", () => {
  it("Enter envia (perguntar), Shift+Enter não envia, a caixa limpa e a resposta com citação chega", async () => {
    const m = await montar();
    const spy = vi.spyOn(m.api, "enviar");
    await screen.findByRole("list", { name: "Mensagens da conversa" });
    await digitar("o login existe?");
    await enter({ shiftKey: true });
    expect(spy).not.toHaveBeenCalled();
    await enter();
    expect(spy).toHaveBeenCalledWith({ conversa_id: "cv1", texto: "o login existe?", modo: "perguntar", mission_alvo_id: null });
    expect(compositor().value).toBe("");
    await waitFor(() => expect(screen.getByText(/Resposta/)).toBeTruthy());
  });

  it("limite de 8000 caracteres: botão desabilitado e aviso", async () => {
    await montar();
    await digitar("a".repeat(8001));
    expect((screen.getByRole("button", { name: "Perguntar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Máximo de 8000");
    await digitar("   ");
    expect((screen.getByRole("button", { name: "Perguntar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Esc interrompe a resposta em andamento", async () => {
    let soltar: (v: { mensagem_id: string }) => void = () => undefined;
    const parar = vi.fn(async () => ({ ok: true }));
    await montar({ enviar: () => new Promise((r) => { soltar = r; }), parar });
    await screen.findByRole("list", { name: "Mensagens da conversa" });
    await digitar("oi");
    await enter();
    expect(screen.getByRole("button", { name: "Parar" })).toBeTruthy();
    await act(async () => { soltar({ mensagem_id: "m-parcial" }); });
    await act(async () => { fireEvent.keyDown(compositor(), { key: "Escape" }); });
    expect(parar).toHaveBeenCalledWith("m-parcial");
  });

  it("comandos rápidos: '/' lista; '/orquestrar' + Enter troca o modo sem enviar", async () => {
    const m = await montar();
    const spy = vi.spyOn(m.api, "enviar");
    await digitar("/");
    expect(screen.getByRole("list", { name: "Comandos rápidos" })).toBeTruthy();
    await digitar("/orquestrar");
    await enter();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Pedir ao orquestrador" }).getAttribute("aria-checked")).toBe("true");
    expect(compositor().value).toBe("");
  });
});

describe("Chat: plano do orquestrador", () => {
  async function pedir() {
    const m = await montar();
    await screen.findByRole("list", { name: "Mensagens da conversa" });
    await modoOrquestrar();
    await digitar("preciso implementar X");
    await enter();
    const plano = await screen.findByRole("region", { name: /Plano: Implementar X/ });
    return { ...m, plano };
  }

  it("'preciso implementar X' devolve o plano: resumo, passos, prompt colapsável, critérios, arquivos e ações humanas", async () => {
    const { plano } = await pedir();
    expect(within(plano).getByText("Criar a Missão “Implementar X”")).toBeTruthy();
    expect(within(plano).getByText(/Digitar \/expx:sprintx X/)).toBeTruthy();
    const detalhes = plano.querySelector("details") as HTMLDetailsElement;
    expect(detalhes.open).toBe(false);
    expect(within(plano).getByText("Testes passam")).toBeTruthy();
    expect(within(plano).getByText("src/x.ts")).toBeTruthy();
    expect(within(plano).getByRole("heading", { name: "Ficam com você (D-21)" })).toBeTruthy();
    expect(within(plano).getByText("Aprovar o merge")).toBeTruthy();
    for (const b of ["Aprovar", "Editar", "Cancelar"]) expect(within(plano).getByRole("button", { name: b })).toBeTruthy();
  });

  it("Aprovar chama o main e o foco vai para o cartão; Cancelar também decide", async () => {
    const m = await pedir();
    const decidir = vi.spyOn(m.api, "decidirPlano");
    await clicar(within(m.plano).getByRole("button", { name: "Aprovar" }));
    expect(decidir).toHaveBeenCalledWith({ plano_id: "pl1", decisao: "aprovar" });
    await waitFor(() => expect(within(screen.getByRole("region", { name: /Plano:/ })).getByText("aprovado")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("region", { name: /Plano:/ }));
  });

  it("Editar: CLI, modelo, esforço e prompt (≤ 20000); prompt acima do limite bloqueia", async () => {
    const m = await pedir();
    const decidir = vi.spyOn(m.api, "decidirPlano");
    await clicar(within(m.plano).getByRole("button", { name: "Editar" }));
    const edicao = within(m.plano).getByRole("group", { name: "Editar o plano" });
    expect(within(edicao).getByRole("option", { name: /codex \(indisponível\)/ }).hasAttribute("disabled")).toBe(true);
    await act(async () => { fireEvent.change(within(edicao).getByLabelText("Modelo"), { target: { value: "opus" } }); });
    await act(async () => { fireEvent.change(within(edicao).getByLabelText("Esforço"), { target: { value: "alto" } }); });
    await act(async () => { fireEvent.change(within(edicao).getByLabelText(/Prompt/), { target: { value: "x".repeat(20_001) } }); });
    const aplicar = within(edicao).getByRole("button", { name: "Aplicar edição" }) as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    expect(within(edicao).getByRole("alert").textContent).toContain("20000");
    await act(async () => { fireEvent.change(within(edicao).getByLabelText(/Prompt/), { target: { value: "novo prompt" } }); });
    await clicar(aplicar);
    expect(decidir).toHaveBeenCalledWith({ plano_id: "pl1", decisao: "editar", ajuste: { cli: "claude", modelo: "opus", esforco: "alto", prompt: "novo prompt" } });
  });

  it("quando o plano não exige aprovação não há botão Aprovar, mas dá para editar e cancelar", async () => {
    const m2 = await montar();
    await m2.emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem("m-r", { texto: "plano", plano_id: PLANO.id }) } });
    await m2.emitir({ canal: "chat:plano", payload: { plano: { ...PLANO, exige_aprovacao: false } } });
    const plano = await screen.findByRole("region", { name: /Plano:/ });
    expect(within(plano).queryByRole("button", { name: "Aprovar" })).toBeNull();
    expect(within(plano).getByText(/roda direto/)).toBeTruthy();
    expect(within(plano).getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(within(plano).getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("progresso por terminal, link para abrir os terminais/Missão e parar plano", async () => {
    const m = await pedir();
    const parar = vi.spyOn(m.api, "pararPlano");
    await m.emitir({ canal: "chat:plano", payload: { plano: { ...PLANO, estado: "executando", pane_ids: ["p1"], mission_id: "m1" } } });
    await m.emitir({ canal: "chat:progresso", payload: { plano_id: "pl1", pane_id: "p1", estado: "executando", resumo: "executor trabalhando" } });
    const plano = screen.getByRole("region", { name: /Plano:/ });
    expect(within(plano).getByRole("status", { name: "Progresso do plano" }).textContent).toContain("Terminal p1: executando — executor trabalhando");
    expect(within(plano).getByRole("button", { name: "Abrir terminais" })).toBeTruthy();
    expect(within(plano).getByRole("button", { name: "Ver Missão" })).toBeTruthy();
    await clicar(within(plano).getByRole("button", { name: "Parar plano" }));
    expect(parar).toHaveBeenCalledWith("pl1");
  });

  it("texto do plano vem como texto: HTML no resumo/prompt/passos não vira elemento", async () => {
    const m = await montar();
    await m.emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem("m-x", { texto: "ok", plano_id: "pl1" }) } });
    await m.emitir({ canal: "chat:plano", payload: { plano: { ...PLANO, resumo: "<img src=x onerror=alert(1)>", prompt: "<script>alert(2)</script>", criterios_aceite: ["<b>negrito</b>"] } } });
    const plano = await screen.findByRole("region", { name: /Plano:/ });
    expect(plano.querySelector("img, script, b")).toBeNull();
    expect(plano.textContent).toContain("<script>alert(2)</script>");
  });
});
