// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estadoOpenRouter, modelosOpenRouter, openrouterFalso } from "../../a11y/ade-falso-harness";
import { SecaoOpenRouter } from "./OpenRouter";

afterEach(() => { cleanup(); });
const SENTINELA = "sk-or-v1-SENTINELA-0123456789";

async function montar(extra: Record<string, unknown> = {}, estado = estadoOpenRouter()) {
  const api = { ...openrouterFalso(estado), ...extra };
  const espiada = Object.fromEntries(Object.entries(api).map(([k, v]) => [k, vi.fn(v as (...a: never[]) => unknown)]));
  await act(async () => { render(<SecaoOpenRouter api={espiada as never} />); });
  return espiada as Record<string, ReturnType<typeof vi.fn>>;
}

describe("OpenRouter: desligado e consentimento", () => {
  it("desligado não dispara nenhuma chamada de rede e oferece só 'Ativar'", async () => {
    const api = await montar({}, estadoOpenRouter({ habilitado: false, contas: [] }));
    expect(screen.getByText("Desligado")).toBeTruthy();
    expect(screen.queryByLabelText("Chave do OpenRouter")).toBeNull();
    expect(screen.queryByRole("button", { name: "Atualizar lista" })).toBeNull();
    expect(api.listarModelos).not.toHaveBeenCalled();
    expect(api.testar).not.toHaveBeenCalled();
    expect(api.atualizarSaldo).not.toHaveBeenCalled();
  });
  it("ativar abre o diálogo com o texto claro e só consente ao confirmar", async () => {
    const api = await montar({}, estadoOpenRouter({ habilitado: false, contas: [] }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ativar OpenRouter" })); });
    const d = screen.getByRole("dialog");
    expect(within(d).getByText(/prompts e código/)).toBeTruthy();
    expect(api.consentir).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(d).getByRole("button", { name: "Entendi, ativar" })); });
    expect(api.consentir).toHaveBeenCalledWith(expect.stringMatching(/^openrouter-/));
    await waitFor(() => expect(screen.getByText("Ativo")).toBeTruthy());
  });
  it("cancelar não consente", async () => {
    const api = await montar({}, estadoOpenRouter({ habilitado: false, contas: [] }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ativar OpenRouter" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); });
    expect(api.consentir).not.toHaveBeenCalled();
  });
});

describe("OpenRouter: chave", () => {
  it("campo mascarado; salvar envia ao cofre, limpa o campo e nunca põe a chave no DOM", async () => {
    const api = await montar({}, estadoOpenRouter({ contas: [] }));
    const campo = screen.getByLabelText("Chave do OpenRouter") as HTMLInputElement;
    expect(campo.type).toBe("password");
    fireEvent.change(screen.getByLabelText("Rótulo da conta OpenRouter"), { target: { value: "pessoal" } });
    fireEvent.change(campo, { target: { value: SENTINELA } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar no cofre" })); });
    expect(api.gravarChave).toHaveBeenCalledWith("pessoal", SENTINELA);
    expect((screen.getByLabelText("Chave do OpenRouter") as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML).not.toContain(SENTINELA);
  });
  it("testar sem salvar usa a chave uma vez (sem gravar) e mostra o resultado", async () => {
    const api = await montar({}, estadoOpenRouter({ contas: [] }));
    fireEvent.change(screen.getByLabelText("Chave do OpenRouter"), { target: { value: SENTINELA } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Testar sem salvar" })); });
    expect(api.testar).toHaveBeenCalledWith({ chave: SENTINELA });
    expect(api.gravarChave).not.toHaveBeenCalled();
    expect(screen.getByText(/Chave válida \(conta paga\)/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(SENTINELA);
  });
  it("chave vazia ou com espaço é recusada com o motivo, sem chamar a API", async () => {
    const api = await montar({}, estadoOpenRouter({ contas: [] }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Testar sem salvar" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/Cole a chave/);
    expect(api.testar).not.toHaveBeenCalled();
  });
  it("recusa do núcleo vira texto com próximo passo", async () => {
    await montar({ gravarChave: async () => { throw new Error("chave_invalida: o OpenRouter recusou a chave"); } }, estadoOpenRouter({ contas: [] }));
    fireEvent.change(screen.getByLabelText("Rótulo da conta OpenRouter"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Chave do OpenRouter"), { target: { value: SENTINELA } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar no cofre" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/recusou a chave/);
  });
  it("conta existente: só máscara + últimos 4, saldo e limite; testar, saldo e apagar com confirmação", async () => {
    const api = await montar();
    expect(screen.getByText("sk-or-••••ab12")).toBeTruthy();
    expect(screen.getByText("saldo US$ 7,10")).toBeTruthy();
    expect(screen.getByText("limite US$ 20,00")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Atualizar saldo" })); });
    expect(api.atualizarSaldo).toHaveBeenCalledWith("or1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Testar" })); });
    expect(api.testar).toHaveBeenCalledWith({ conta_id: "or1" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apagar" })); });
    expect(api.apagarChave).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apagar" })); });
    expect(api.apagarChave).toHaveBeenCalledWith("or1");
  });
});

describe("OpenRouter: modelos e CLIs", () => {
  it("lista com preço em US$/Mtok, 'sem preço' sem zero, e habilita por checkbox", async () => {
    const api = await montar();
    await screen.findByLabelText("Habilitar Claude X");
    expect(screen.getByText("US$ 3,00 / US$ 15,00")).toBeTruthy();
    expect(screen.getByText("sem preço")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByLabelText("Habilitar Claude X")); });
    expect(api.gravarModelo).toHaveBeenCalledWith(expect.objectContaining({ id: "anthropic/claude-x", habilitado: true }));
  });
  it("faixa/ordem sugeridas só valem ao aceitar", async () => {
    const api = await montar();
    await screen.findByLabelText("Habilitar Claude X");
    expect(api.gravarModelo).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aceitar Alto #1" })); });
    expect(api.gravarModelo).toHaveBeenCalledWith({ id: "anthropic/claude-x", habilitado: false, faixa: "alto", tipos_permitidos: [], ordem: 1 });
    expect((screen.getByLabelText("Faixa de Claude X") as HTMLSelectElement).value).toBe("alto");
  });
  it("Atualizar lista só por clique e mostra 'N novos, M removidos'", async () => {
    const api = await montar();
    await screen.findByLabelText("Habilitar Claude X");
    expect(api.atualizarModelos).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Atualizar lista" })); });
    expect(api.atualizarModelos).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 novos, 0 removidos/)).toBeTruthy();
  });
  it("sem conta a atualização fica bloqueada e o vazio explica o próximo passo", async () => {
    await montar({ listarModelos: async () => ({ itens: [], proximo: null, total: 0 }) }, estadoOpenRouter({ contas: [], modelos: { total: 0, habilitados: 0, atualizados_em: null } }));
    expect((screen.getByRole("button", { name: "Atualizar lista" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText(/Grave uma chave e clique em/)).toBeTruthy();
  });
  it("erro ao listar aparece como alerta", async () => {
    await montar({ listarModelos: async () => { throw new Error("indisponivel: o OpenRouter não respondeu"); } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Não foi possível ler os modelos/);
  });
  it("CLIs: verificada, a verificar e desligada explicadas; CLI preferida", async () => {
    await montar();
    const g = screen.getByRole("group", { name: "CLIs compatíveis" });
    expect(within(g).getByText("CLI preferida: opencode")).toBeTruthy();
    expect(within(g).getByText("Verificada")).toBeTruthy();
    expect(within(g).getByText("A verificar")).toBeTruthy();
    expect(within(g).getByText("Desligada")).toBeTruthy();
    expect(within(g).getByText(/ainda não validado/i)).toBeTruthy();
  });
});

describe("OpenRouter: indisponível e erro", () => {
  it("sem API (fora do app) mostra 'indisponível', sem erro", async () => {
    await act(async () => { render(<SecaoOpenRouter api={undefined} />); });
    expect(screen.getByRole("status").textContent).toMatch(/indisponível/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("canal ausente no main vira indisponível", async () => {
    await montar({ estado: async () => { throw new Error("No handler registered for 'provedores:openrouter_estado'"); } });
    expect(screen.getByRole("status").textContent).toMatch(/indisponível/);
  });
  it("falha de leitura mostra erro e 'Tentar de novo'", async () => {
    await montar({ estado: async () => { throw new Error("boom"); } });
    expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível ler o estado/);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
});

void modelosOpenRouter;

import { pedirOpenRouter } from "../../estado/openrouter-acoes";
describe("OpenRouter: pedido da paleta", () => {
  it("foca o campo da chave quando a paleta pede 'chave'", async () => {
    await montar({}, estadoOpenRouter({ contas: [] }));
    await act(async () => { pedirOpenRouter("chave"); });
    expect(document.activeElement).toBe(screen.getByLabelText("Chave do OpenRouter"));
  });
});
