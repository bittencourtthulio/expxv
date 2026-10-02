// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiVoz, EstadoVoz, EventoVozIpc } from "../../../compartilhado/captura";
import type { SessaoAudio } from "../../voz/capturaAudio";
import { BotaoVoz } from "./BotaoVoz";

vi.mock("../../estado/navegacao", () => ({ pedirTela: vi.fn(), pedirConfiguracoes: vi.fn() }));
import { pedirConfiguracoes } from "../../estado/navegacao";

const ESTADO: EstadoVoz = {
  motor: "comando_local", comando_executavel: "/bin/x", comando_args: ["{wav}"], url: null, modelo: null, modelo_local: null, ociosidade_s: 120, idioma: "pt", disparo: "segurar", atalho: "Command+Shift+Space", alternar_global: false,
  motor_pronto: true, consentimento: true, host: null, tem_chave: false, microfone: "concedida", ditado: "ocioso", aviso_microfone_visto: true, plataforma: "mac", atalho_erro: null,
};

function api(estado: Partial<EstadoVoz> = {}) {
  let ouvinte: ((e: EventoVozIpc) => void) | null = null;
  const a = {
    estado: vi.fn(async () => ({ ...ESTADO, ...estado })),
    iniciar: vi.fn(async () => ({ ok: true, codigo: null })),
    parar: vi.fn(async () => ({ ok: true })),
    cancelar: vi.fn(async () => ({ ok: true })),
    audio: vi.fn(),
    configGravar: vi.fn(async () => ({ ...ESTADO, ...estado })),
    pedirMicrofone: vi.fn(async () => ({ estado: "concedida" as const })),
    assinar: vi.fn((cb: (e: EventoVozIpc) => void) => { ouvinte = cb; return () => undefined; }),
  } as unknown as ApiVoz & Record<string, ReturnType<typeof vi.fn>>;
  return { a, emitir: (e: EventoVozIpc) => act(() => ouvinte?.(e)) };
}
const abrir = vi.fn(async (): Promise<SessaoAudio> => ({ parar: async () => undefined }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function montar(estado: Partial<EstadoVoz> = {}, sessaoId: string | null = "sessao_1") {
  const x = api(estado);
  await act(async () => { render(<BotaoVoz sessaoId={sessaoId} opcoes={{ api: x.a, abrir, mac: true }} />); });
  return x;
}

describe("BotaoVoz", () => {
  it("fora do Electron (sem window.ade.voz e sem api) não renderiza nada", () => {
    const { container } = render(<BotaoVoz sessaoId="s" />);
    expect(container.innerHTML).toBe("");
  });

  it("ocioso: botão de 1 elemento com rótulo acessível e atalho legível; não é só cor", async () => {
    await montar();
    const b = screen.getByRole("button", { name: /Ditar por voz/ });
    expect(b.getAttribute("data-estado")).toBe("ocioso");
    expect(b.getAttribute("aria-pressed")).toBe("false");
    expect(b.querySelector("svg")).not.toBeNull(); // forma (contorno), não só cor
  });

  it("os 4 estados têm rótulo acessível distinto", async () => {
    const x = await montar();
    const rotulos = new Set<string>();
    const ler = () => rotulos.add(screen.getByRole("button", { name: /voz|Gravando|Transcrevendo|ditado/i }).getAttribute("aria-label") ?? "");
    ler();
    await x.emitir({ tipo: "estado", sequencia: 1, ditado: "gravando" });
    ler();
    await x.emitir({ tipo: "estado", sequencia: 2, ditado: "transcrevendo" });
    ler();
    await x.emitir({ tipo: "estado", sequencia: 3, ditado: "erro" });
    ler();
    expect(rotulos.size).toBe(4);
    expect(screen.getByRole("button", { name: /Erro no ditado/ }).textContent).toContain("!");
  });

  it("sem motor: o botão abre a configuração em vez de gravar", async () => {
    const x = await montar({ motor: "nenhum", motor_pronto: false });
    const b = screen.getByRole("button");
    await act(async () => { fireEvent.pointerDown(b, { button: 0 }); });
    expect(pedirConfiguracoes).toHaveBeenCalledWith("voz"); // abre Configurações já em "Voz e captura"
    expect(x.a.iniciar).not.toHaveBeenCalled();
    expect(abrir).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Sem motor de voz. Configurar.");
  });

  it("segurar o botão grava e soltar envia (pointerdown/pointerup)", async () => {
    const x = await montar();
    const b = screen.getByRole("button");
    await act(async () => { fireEvent.pointerDown(b, { button: 0 }); });
    await vi.waitFor(() => expect(b.getAttribute("data-estado")).toBe("gravando"));
    expect(b.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { fireEvent.pointerUp(b); });
    await vi.waitFor(() => expect(x.a.parar).toHaveBeenCalledTimes(1));
  });

  it("primeiro uso: diálogo próprio explica o que será usado e o que NÃO acontece, antes do diálogo do SO", async () => {
    const x = await montar({ aviso_microfone_visto: false, microfone: "indeterminada" });
    await act(async () => { fireEvent.pointerDown(screen.getByRole("button", { name: /Ditar/ }), { button: 0 }); });
    const d = screen.getByRole("dialog", { name: "Usar o microfone para ditar" });
    expect(d.textContent).toMatch(/nenhum áudio é gravado em disco/);
    expect(d.textContent).toMatch(/Como desfazer/);
    expect(x.a.pedirMicrofone).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continuar" })); });
    expect(x.a.configGravar).toHaveBeenCalledWith({ aviso_microfone_visto: true });
    expect(x.a.pedirMicrofone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'Agora não' fecha sem pedir nada; nenhum window.confirm é usado", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    const x = await montar({ aviso_microfone_visto: false, microfone: "indeterminada" });
    await act(async () => { fireEvent.pointerDown(screen.getByRole("button", { name: /Ditar/ }), { button: 0 }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Agora não" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(x.a.pedirMicrofone).not.toHaveBeenCalled();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("Enter no botão alterna sem precisar segurar", async () => {
    const x = await montar();
    const b = screen.getByRole("button");
    await act(async () => { fireEvent.keyDown(b, { key: "Enter" }); });
    await vi.waitFor(() => expect(b.getAttribute("data-estado")).toBe("gravando"));
    await act(async () => { fireEvent.keyDown(b, { key: "Enter" }); });
    await vi.waitFor(() => expect(x.a.parar).toHaveBeenCalledTimes(1));
  });

  it("o toast fica numa região viva e some sozinho", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const x = await montar();
      await x.emitir({ tipo: "erro", codigo: "fala_curta", estagio: "transcrevendo" });
      expect(screen.getByRole("status").textContent).toBe("Fala curta demais.");
      await act(async () => { vi.advanceTimersByTime(2_600); });
      expect(screen.getByRole("status").textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});
