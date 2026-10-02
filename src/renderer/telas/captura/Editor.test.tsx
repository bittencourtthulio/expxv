// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCaptura } from "../../../compartilhado/captura";
import { AUTOSAVE_MS, Editor } from "./Editor";
import type { Falso } from "./tipos-teste";

const chamadasCanvas: string[] = [];
beforeEach(() => {
  chamadasCanvas.length = 0;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({}, { get: (_t, p: string) => (...a: unknown[]) => void chamadasCanvas.push(`${p}:${a.length}`), set: () => true })) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" })); };
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

function api() {
  return {
    ler: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), tipo: "png" as const })),
    salvarEdicao: vi.fn(async () => ({ ok: true as const })),
    anexarAoPane: vi.fn(async () => ({ caminhos: [".p/capturas/a.png"], texto: ".p/capturas/a.png " })),
    copiarCaminho: vi.fn(async () => true),
  } as unknown as Falso<ApiCaptura>;
}
const carregarImagem = async () => ({ width: 200, height: 100, origem: {} as CanvasImageSource });

async function montar(extra: { pane?: string | null } = {}) {
  const a = api();
  const aoFechar = vi.fn();
  const aoAvisar = vi.fn();
  await act(async () => { render(<Editor api={a} capturaId="2026-10-01_10-00-00" workspaceId={null} paneEmFoco={extra.pane === undefined ? "sessao_1" : extra.pane} aoFechar={aoFechar} aoAvisar={aoAvisar} carregarImagem={carregarImagem} />); });
  const canvas = document.querySelector("canvas") as HTMLCanvasElement;
  return { a, aoFechar, aoAvisar, canvas };
}
const rabiscar = (c: HTMLCanvasElement) => {
  fireEvent.pointerDown(c, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(c, { clientX: 60, clientY: 40, pointerId: 1 });
  fireEvent.pointerUp(c, { pointerId: 1 });
};

describe("Editor de anotação", () => {
  it("carrega a imagem do main pelo id (nunca por caminho) e mostra o canvas", async () => {
    const { a, canvas } = await montar();
    expect(a.ler).toHaveBeenCalledWith("2026-10-01_10-00-00", null);
    expect(canvas.hidden).toBe(false);
    expect(canvas.width).toBe(200);
  });

  it("copiar o caminho SEM mudança não regrava a imagem", async () => {
    const { a } = await montar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar caminho" })); });
    expect(a.salvarEdicao).not.toHaveBeenCalled();
    expect(a.copiarCaminho).toHaveBeenCalledTimes(1);
  });

  it("desenhar uma seta e copiar o caminho salva o PNG antes de copiar", async () => {
    const { a, canvas } = await montar();
    await act(async () => { rabiscar(canvas); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar caminho" })); });
    expect(a.salvarEdicao).toHaveBeenCalledTimes(1);
    const [id, ws, png] = a.salvarEdicao.mock.calls[0] as [string, string | null, Uint8Array];
    expect([id, ws]).toEqual(["2026-10-01_10-00-00", null]);
    expect(png).toBeInstanceOf(Uint8Array);
    expect(a.salvarEdicao.mock.invocationCallOrder[0]).toBeLessThan(a.copiarCaminho.mock.invocationCallOrder[0] as number);
    expect(chamadasCanvas).toContain("lineTo:2");
    // gravar de novo sem nova mudança não regrava
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar caminho" })); });
    expect(a.salvarEdicao).toHaveBeenCalledTimes(1);
  });

  it("desfazer volta ao estado anterior e o botão reflete se há o que desfazer/refazer", async () => {
    const { canvas } = await montar();
    const desfazer = screen.getByRole("button", { name: "Desfazer" }) as HTMLButtonElement;
    const refazer = screen.getByRole("button", { name: "Refazer" }) as HTMLButtonElement;
    expect(desfazer.disabled).toBe(true);
    await act(async () => { rabiscar(canvas); });
    expect(desfazer.disabled).toBe(false);
    await act(async () => { fireEvent.click(desfazer); });
    expect(desfazer.disabled).toBe(true);
    expect(refazer.disabled).toBe(false);
    await act(async () => { fireEvent.keyDown(document, { key: "z", metaKey: true, ctrlKey: true, shiftKey: true }); });
    expect(desfazer.disabled).toBe(false);
  });

  it("autosave a cada 10 s só se houver mudança", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { a, canvas } = await montar();
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS + 10); });
    expect(a.salvarEdicao).not.toHaveBeenCalled();
    await act(async () => { rabiscar(canvas); });
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS); });
    expect(a.salvarEdicao).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_MS * 2); });
    expect(a.salvarEdicao).toHaveBeenCalledTimes(1);
  });

  it("Esc e Fechar salvam a mudança pendente e fecham", async () => {
    const { a, aoFechar, canvas } = await montar();
    await act(async () => { rabiscar(canvas); });
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(a.salvarEdicao).toHaveBeenCalledTimes(1);
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("anexar ao Pane usa o Pane em foco e fica desabilitado sem ele", async () => {
    const { a } = await montar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Anexar ao Pane" })); });
    expect(a.anexarAoPane).toHaveBeenCalledWith("2026-10-01_10-00-00", null, "sessao_1");
    cleanup();
    await montar({ pane: null });
    expect((screen.getByRole("button", { name: "Anexar ao Pane" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("texto: abre o campo, adiciona e atalhos numéricos trocam a ferramenta", async () => {
    const { canvas } = await montar();
    await act(async () => { fireEvent.keyDown(document, { key: "4" }); });
    expect(screen.getByRole("button", { name: "Texto" }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => { fireEvent.pointerDown(canvas, { button: 0, clientX: 5, clientY: 5, pointerId: 1 }); });
    const campo = screen.getByLabelText("Texto da anotação");
    await act(async () => { fireEvent.change(campo, { target: { value: "bug aqui" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Adicionar" })); });
    expect((screen.getByRole("button", { name: "Desfazer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("erro ao abrir a captura vira alerta claro", async () => {
    const a = api();
    a.ler.mockRejectedValueOnce(new Error("[captura_inexistente] Captura inexistente."));
    await act(async () => { render(<Editor api={a} capturaId="2026-10-01_10-00-01" workspaceId={null} paneEmFoco={null} aoFechar={() => undefined} aoAvisar={() => undefined} carregarImagem={carregarImagem} />); });
    expect(screen.getByRole("alert").textContent).toBe("Captura inexistente.");
  });
});
