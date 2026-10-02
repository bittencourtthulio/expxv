// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiCaptura, ApiVoz, EstadoCaptura, EventoCapturaIpc } from "../../../compartilhado/captura";
import Fluxo from "./Fluxo";
import type { Falso } from "./tipos-teste";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ESTADO: EstadoCaptura = { tela: "concedida", janela_app: true, plataforma: "mac", aviso_visto: true, fps_padrao: 2, atalhos_globais: false, atalho_regiao: "CommandOrControl+Shift+5", atalho_quadros: "CommandOrControl+Shift+6", gravando_quadros: false, atalho_erro: null };

function api(estado: Partial<EstadoCaptura> = {}) {
  let ouvinte: ((e: EventoCapturaIpc) => void) | null = null;
  const a = {
    estado: vi.fn(async () => ({ ...ESTADO, ...estado })),
    configGravar: vi.fn(async () => ({ ...ESTADO, ...estado })),
    pedirTela: vi.fn(async () => ({ estado: "concedida" as const, reiniciar_app: false })),
    regiaoIniciar: vi.fn(async () => ({ ok: true as const, token: "a".repeat(32), imagem: new Uint8Array([0xff, 0xd8]), largura: 200, altura: 100, fator: 2 })),
    regiaoConfirmar: vi.fn(async () => ({ ok: true as const, captura_id: "2026-10-01_10-00-00" })),
    regiaoCancelar: vi.fn(async () => true),
    janelaInteira: vi.fn(async () => ({ ok: true as const, captura_id: "2026-10-01_10-00-01" })),
    quadrosIniciar: vi.fn(async () => ({ ok: true as const })),
    quadrosParar: vi.fn(async () => ({ captura_id: "q_2026-10-01_10-00-02" })),
    listar: vi.fn(async () => ({ itens: [], proximo: null })),
    ler: vi.fn(async () => ({ bytes: new Uint8Array([1]), tipo: "png" as const })),
    salvarEdicao: vi.fn(async () => ({ ok: true as const })),
    assinar: vi.fn((cb: (e: EventoCapturaIpc) => void) => { ouvinte = cb; return () => undefined; }),
  } as unknown as Falso<ApiCaptura>;
  const voz = { abrirAjustes: vi.fn(async () => true) } as unknown as Falso<ApiVoz>;
  return { a, voz, emitir: (e: EventoCapturaIpc) => act(() => ouvinte?.(e)) };
}

async function montar(x: ReturnType<typeof api>, pedido: Parameters<typeof Fluxo>[0]["pedido"]) {
  await act(async () => { render(<Fluxo pedido={pedido} serial={1} api={x.a} voz={x.voz} workspaceId={() => "ws_1"} />); });
}
const arrastar = async () => {
  const caixa = screen.getByRole("dialog", { name: /Selecionar região/ });
  await act(async () => {
    fireEvent.pointerDown(caixa, { button: 0, clientX: 0, clientY: 128, pointerId: 1 });
    fireEvent.pointerUp(caixa, { clientX: 512, clientY: 384, pointerId: 1 });
  });
};

describe("fluxo de captura", () => {
  it("região da tela: congela, seleciona em coordenadas lógicas e confirma com o token e o workspace", async () => {
    const x = api();
    await montar(x, "regiao-tela");
    await vi.waitFor(() => expect(screen.getByRole("dialog", { name: /Selecionar região/ })).toBeTruthy());
    expect(x.a.regiaoIniciar).toHaveBeenCalledWith("tela");
    await arrastar();
    expect(x.a.regiaoConfirmar).toHaveBeenCalledWith("a".repeat(32), { x: 0, y: 0, largura: 100, altura: 50 }, "ws_1");
    await vi.waitFor(() => expect(screen.getByRole("dialog", { name: "Editor de captura" })).toBeTruthy());
  });

  it("Esc no seletor cancela e libera a imagem congelada no main", async () => {
    const x = api();
    await montar(x, "regiao-tela");
    await vi.waitFor(() => screen.getByRole("dialog", { name: /Selecionar região/ }));
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(x.a.regiaoCancelar).toHaveBeenCalledWith("a".repeat(32));
    expect(x.a.regiaoConfirmar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /Selecionar região/ })).toBeNull();
  });

  it("primeira captura: aviso explica que fica local e que pode ter segredos; 'Agora não' não captura nada", async () => {
    const x = api({ aviso_visto: false });
    await montar(x, "regiao-tela");
    const d = await screen.findByRole("dialog", { name: "Antes da primeira captura" });
    expect(d.textContent).toMatch(/só neste computador/);
    expect(d.textContent).toMatch(/dados sensíveis/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Agora não" })); });
    expect(x.a.regiaoIniciar).not.toHaveBeenCalled();
    expect(x.a.configGravar).not.toHaveBeenCalled();
  });

  it("'Entendi' grava o aviso visto e segue para a captura", async () => {
    const x = api({ aviso_visto: false });
    await montar(x, "regiao-tela");
    await screen.findByRole("dialog", { name: "Antes da primeira captura" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Entendi" })); });
    expect(x.a.configGravar).toHaveBeenCalledWith({ aviso_visto: true });
    await vi.waitFor(() => expect(x.a.regiaoIniciar).toHaveBeenCalled());
  });

  it("macOS com permissão indeterminada: diálogo próprio ANTES de pedir ao SO; depois pede e orienta a reabrir o app", async () => {
    const x = api({ tela: "indeterminada" });
    x.a.pedirTela.mockResolvedValueOnce({ estado: "indeterminada", reiniciar_app: true });
    await montar(x, "regiao-tela");
    const d = await screen.findByRole("dialog", { name: "Permitir gravação de tela" });
    expect(d.textContent).toMatch(/O que não acontece/);
    expect(x.a.pedirTela).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continuar" })); });
    expect(x.a.pedirTela).toHaveBeenCalledTimes(1);
    const r = await screen.findByRole("dialog", { name: "Reabra o app depois de conceder" });
    expect(r.textContent).toMatch(/janela do app/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Abrir Ajustes do Sistema" })); });
    expect(x.voz.abrirAjustes).toHaveBeenCalledWith("tela");
    expect(x.a.regiaoIniciar).not.toHaveBeenCalled();
  });

  it("permissão negada: instrução clara e alternativa de capturar a janela do app (sem permissão)", async () => {
    const x = api({ tela: "negada" });
    await montar(x, "regiao-tela");
    const d = await screen.findByRole("dialog", { name: "Gravação de tela sem permissão" });
    expect(d.textContent).toMatch(/reabra o app/);
    expect(x.a.pedirTela).not.toHaveBeenCalled(); // sem laço de pedidos
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Capturar a janela do app" })); });
    await vi.waitFor(() => expect(x.a.regiaoIniciar).toHaveBeenCalledWith("janela_app"));
  });

  it("erro do main (instrução) vira toast, sem seletor", async () => {
    const x = api();
    x.a.regiaoIniciar.mockResolvedValueOnce({ ok: false, codigo: "permissao_tela_negada", instrucao: "Libere a Gravação de Tela e reabra o app." });
    await montar(x, "regiao-tela");
    await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe("Libere a Gravação de Tela e reabra o app."));
    expect(screen.queryByRole("dialog", { name: /Selecionar região/ })).toBeNull();
  });

  it("janela inteira abre o editor direto (sem permissão de tela)", async () => {
    const x = api({ tela: "negada" });
    await montar(x, "janela");
    await screen.findByRole("dialog", { name: "Editor de captura" });
    expect(x.a.janelaInteira).toHaveBeenCalledWith("ws_1");
    expect(x.a.regiaoIniciar).not.toHaveBeenCalled();
  });

  it("quadros: inicia com o fps padrão, avisa como parar, Esc para e o evento de fim informa", async () => {
    const x = api();
    await montar(x, "quadros-tela");
    await vi.waitFor(() => expect(x.a.quadrosIniciar).toHaveBeenCalledWith("tela", 2, "ws_1"));
    expect(screen.getByRole("status").textContent).toMatch(/Esc ou o mesmo atalho para parar/);
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(x.a.quadrosParar).toHaveBeenCalledTimes(1);
    await x.emitir({ tipo: "quadros_fim", captura_id: "q_2026-10-01_10-00-02", motivo: "parou", instrucao: null });
    expect(screen.getByRole("status").textContent).toMatch(/Gravação de quadros salva/);
  });

  it("pedir quadros durante uma gravação para (o mesmo atalho alterna)", async () => {
    const x = api({ gravando_quadros: true });
    await montar(x, "quadros-tela");
    await vi.waitFor(() => expect(x.a.quadrosParar).toHaveBeenCalledTimes(1));
    expect(x.a.quadrosIniciar).not.toHaveBeenCalled();
  });

  it("quadros: falha de permissão no primeiro quadro vira toast com a instrução", async () => {
    const x = api();
    x.a.quadrosIniciar.mockResolvedValueOnce({ ok: false, codigo: "permissao_tela_negada", instrucao: "Sem permissão de Gravação de Tela." });
    await montar(x, "quadros-tela");
    await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe("Sem permissão de Gravação de Tela."));
  });

  it("galeria abre o painel de capturas", async () => {
    const x = api();
    await montar(x, "galeria");
    await screen.findByRole("complementary", { name: "Capturas" });
    expect(x.a.listar).toHaveBeenCalledWith("ws_1", null);
  });

  it("quadros-parar sem gravação avisa", async () => {
    const x = api();
    x.a.quadrosParar.mockResolvedValueOnce({ captura_id: null });
    await montar(x, "quadros-parar");
    await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe("Não há gravação em andamento."));
  });
});
