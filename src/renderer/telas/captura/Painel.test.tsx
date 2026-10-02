// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiCaptura, ItemCaptura } from "../../../compartilhado/captura";
import { Painel } from "./Painel";
import type { Falso } from "./tipos-teste";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const img = (id: string, extra: Partial<ItemCaptura> = {}): ItemCaptura => ({ id, tipo: "imagem", formato: "png", caminho: `.p/capturas/${id}.png`, bytes: 10, largura: 400, altura: 200, anotada: false, fps: null, quadros: null, criado_em: "2026-10-01T10:00:00Z", ...extra });
const quadros = (id: string): ItemCaptura => ({ ...img(id), tipo: "quadros", formato: null, caminho: `.p/capturas/quadros/${id.slice(2)}`, largura: null, altura: null, fps: 2, quadros: 10 });

function api(paginas: { itens: ItemCaptura[]; proximo: string | null }[]) {
  let i = 0;
  return {
    listar: vi.fn(async () => paginas[Math.min(i++, paginas.length - 1)]!),
    ler: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), tipo: "png" as const })),
    anexarAoPane: vi.fn(async () => ({ caminhos: [".p/a.png"], texto: ".p/a.png " })),
    anexarQuadrosAoPane: vi.fn(async () => ({ caminhos: [".p/q"], texto: "The folder .p/q contains 10 frames " })),
    copiarCaminho: vi.fn(async () => true),
    remover: vi.fn(async () => true),
  } as unknown as Falso<ApiCaptura>;
}

async function montar(a: ReturnType<typeof api>, pane: string | null = "sessao_1") {
  const aoAvisar = vi.fn();
  const aoEditar = vi.fn();
  const aoFechar = vi.fn();
  await act(async () => { render(<Painel api={a} workspaceId="ws_1" paneEmFoco={pane} aoFechar={aoFechar} aoEditar={aoEditar} aoAvisar={aoAvisar} versao={0} />); });
  return { aoAvisar, aoEditar, aoFechar };
}

describe("Painel de capturas", () => {
  it("estado vazio diz o próximo passo", async () => {
    await montar(api([{ itens: [], proximo: null }]));
    expect(screen.getByText(/Nenhuma captura ainda/).textContent).toMatch(/paleta/);
    expect(screen.getByText(/Ficam só neste computador/)).toBeTruthy();
  });

  it("erro ao listar vira alerta (e a lista não fica carregando para sempre)", async () => {
    const a = api([{ itens: [], proximo: null }]);
    a.listar.mockRejectedValueOnce(new Error("[disco_sem_escrita] Sem acesso à pasta."));
    await montar(a);
    expect(screen.getByRole("alert").textContent).toBe("Sem acesso à pasta.");
    expect(screen.queryByText("Carregando…")).toBeNull();
  });

  it("lista imagens e quadros, mostra miniaturas lidas por id e pagina por cursor", async () => {
    const a = api([{ itens: [img("2026-10-01_10-00-09"), quadros("q_2026-10-01_09-00-00")], proximo: "q_2026-10-01_09-00-00" }, { itens: [img("2026-10-01_08-00-00")], proximo: null }]);
    await montar(a);
    expect(screen.getByText("01/10 10:00:09")).toBeTruthy();
    expect(screen.getByText("01/10 09:00:00 · quadros")).toBeTruthy();
    expect(screen.getByText("10 quadros · 2 fps")).toBeTruthy();
    await vi.waitFor(() => expect(a.ler).toHaveBeenCalledWith("2026-10-01_10-00-09", "ws_1"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Carregar mais" })); });
    expect(a.listar).toHaveBeenLastCalledWith("ws_1", "q_2026-10-01_09-00-00");
    expect(screen.getByText("01/10 08:00:00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("anexa ao Pane em foco; desabilitado sem Pane", async () => {
    const a = api([{ itens: [img("2026-10-01_10-00-09")], proximo: null }]);
    const { aoAvisar } = await montar(a);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Anexar" })); });
    expect(a.anexarAoPane).toHaveBeenCalledWith("2026-10-01_10-00-09", "ws_1", "sessao_1");
    expect(aoAvisar).toHaveBeenCalledWith("Escrito no terminal: .p/a.png");
    cleanup();
    await montar(api([{ itens: [img("2026-10-01_10-00-09")], proximo: null }]), null);
    expect((screen.getByRole("button", { name: "Anexar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("quadros: 'Inserir prompt' usa o canal próprio e nunca sozinho", async () => {
    const a = api([{ itens: [quadros("q_2026-10-01_09-00-00")], proximo: null }]);
    await montar(a);
    expect(a.anexarQuadrosAoPane).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Inserir prompt" })); });
    expect(a.anexarQuadrosAoPane).toHaveBeenCalledWith("q_2026-10-01_09-00-00", "ws_1", "sessao_1");
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("remover pede confirmação inline antes de ir para a lixeira", async () => {
    const a = api([{ itens: [img("2026-10-01_10-00-09")], proximo: null }]);
    const { aoAvisar } = await montar(a);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Remover captura/ })); });
    expect(a.remover).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Não" })); });
    expect(a.remover).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Remover captura/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar" })); });
    expect(a.remover).toHaveBeenCalledWith("2026-10-01_10-00-09", "ws_1");
    expect(aoAvisar).toHaveBeenCalledWith("Enviada para a lixeira do sistema.");
    expect(screen.queryByText("01/10 10:00:09")).toBeNull();
  });

  it("Editar, copiar caminho e Esc/Fechar funcionam", async () => {
    const a = api([{ itens: [img("2026-10-01_10-00-09")], proximo: null }]);
    const { aoEditar, aoFechar } = await montar(a);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(aoEditar).toHaveBeenCalledWith("2026-10-01_10-00-09");
    await act(async () => { fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Copiar caminho" })); });
    expect(a.copiarCaminho).toHaveBeenCalledWith("2026-10-01_10-00-09", "ws_1");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});
