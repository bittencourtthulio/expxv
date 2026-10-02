// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiVoz, EstadoVoz, EventoVozIpc } from "../../compartilhado/captura";
import type { OpcoesCaptura, SessaoAudio } from "./capturaAudio";
import { usarDitado } from "./usarDitado";

const ESTADO: EstadoVoz = {
  motor: "comando_local", comando_executavel: "/bin/x", comando_args: ["{wav}"], url: null, modelo: null, modelo_local: null, ociosidade_s: 120, idioma: "pt", disparo: "segurar", atalho: "Command+Shift+Space", alternar_global: false,
  motor_pronto: true, consentimento: true, host: null, tem_chave: false, microfone: "concedida", ditado: "ocioso", aviso_microfone_visto: true, plataforma: "mac", atalho_erro: null,
};

function montar(estado: Partial<EstadoVoz> = {}, sessaoId: string | null = "sessao_1") {
  let ouvinte: ((e: EventoVozIpc) => void) | null = null;
  const api = {
    estado: vi.fn(async () => ({ ...ESTADO, ...estado })),
    iniciar: vi.fn(async () => ({ ok: true, codigo: null })),
    parar: vi.fn(async () => ({ ok: true })),
    cancelar: vi.fn(async () => ({ ok: true })),
    audio: vi.fn(),
    configGravar: vi.fn(async () => ({ ...ESTADO, ...estado })),
    pedirMicrofone: vi.fn(async () => ({ estado: "concedida" as const })),
    assinar: vi.fn((cb: (e: EventoVozIpc) => void) => { ouvinte = cb; return () => undefined; }),
  } as unknown as ApiVoz & Record<string, ReturnType<typeof vi.fn>>;
  const tracks = { abertas: 0 };
  const aoAvisar = vi.fn();
  const aoConfigurar = vi.fn();
  let opcoesCaptura: OpcoesCaptura | null = null;
  const abrir = vi.fn(async (op: OpcoesCaptura): Promise<SessaoAudio> => {
    opcoesCaptura = op;
    tracks.abertas += 1;
    return { parar: async () => { tracks.abertas = 0; } };
  });
  const r = renderHook((p: { sessaoId: string | null }) => usarDitado({ sessaoId: p.sessaoId, api, abrir, mac: true, aoAvisar, aoConfigurar }), { initialProps: { sessaoId } });
  return { r, api, tracks, aoAvisar, aoConfigurar, abrir, emitir: (e: EventoVozIpc) => act(() => ouvinte?.(e)), blocos: () => opcoesCaptura };
}

const tecla = (tipo: "keydown" | "keyup", o: KeyboardEventInit & { code: string }) => document.dispatchEvent(new KeyboardEvent(tipo, { bubbles: true, cancelable: true, ...o }));
const ATALHO = { code: "Space", metaKey: true, shiftKey: true };

beforeEach(() => vi.useFakeTimers({ toFake: [] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ditado: segurar para falar", () => {
  it("segurar o atalho abre o microfone e soltar fecha ANTES de pedir a transcrição", async () => {
    const m = montar();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { tecla("keydown", ATALHO); await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(m.r.result.current.estado).toBe("gravando"));
    expect(m.api.iniciar).toHaveBeenCalledWith("sessao_1", "segurar");
    expect(m.tracks.abertas).toBe(1);
    m.blocos()?.aoBloco(0, new Uint8Array(4));
    expect(m.api.audio).toHaveBeenCalledWith(0, expect.any(Uint8Array));
    await act(async () => { tecla("keyup", { code: "Space" }); });
    await vi.waitFor(() => expect(m.api.parar).toHaveBeenCalledTimes(1));
    expect(m.tracks.abertas).toBe(0);
    expect(m.r.result.current.estado).toBe("processando");
  });

  it("auto-repeat do keydown não reinicia e o evento não chega ao xterm", async () => {
    const m = montar();
    await act(async () => { await Promise.resolve(); });
    const chegou = vi.fn();
    document.addEventListener("keydown", chegou); // ouvinte em bolha (o xterm): a captura do hook o corta
    await act(async () => { tecla("keydown", ATALHO); await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(m.api.iniciar).toHaveBeenCalledTimes(1));
    await act(async () => { tecla("keydown", { ...ATALHO, repeat: true }); tecla("keydown", { ...ATALHO, repeat: true }); });
    expect(m.api.iniciar).toHaveBeenCalledTimes(1);
    expect(chegou).not.toHaveBeenCalled();
    document.removeEventListener("keydown", chegou);
  });

  it("Esc cancela: microfone fechado, nada pedido ao motor", async () => {
    const m = montar();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { tecla("keydown", ATALHO); await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(m.r.result.current.estado).toBe("gravando"));
    await act(async () => { tecla("keydown", { code: "Escape", key: "Escape" }); });
    await vi.waitFor(() => expect(m.api.cancelar).toHaveBeenCalled());
    expect(m.tracks.abertas).toBe(0);
    expect(m.api.parar).not.toHaveBeenCalled();
    expect(m.r.result.current.estado).toBe("ocioso");
  });

  it.each([["blur", () => window.dispatchEvent(new Event("blur"))], ["pagehide", () => window.dispatchEvent(new Event("pagehide"))], ["pointercancel", () => document.dispatchEvent(new Event("pointercancel"))]])("%s cancela e fecha o microfone", async (_n, disparar) => {
    const m = montar();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { tecla("keydown", ATALHO); await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(m.r.result.current.estado).toBe("gravando"));
    await act(async () => { disparar(); });
    await vi.waitFor(() => expect(m.api.cancelar).toHaveBeenCalled());
    expect(m.tracks.abertas).toBe(0);
  });

  it("aba oculta cancela; trocar de Pane durante a fala cancela", async () => {
    const m = montar();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { tecla("keydown", ATALHO); await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(m.r.result.current.estado).toBe("gravando"));
    m.r.rerender({ sessaoId: "sessao_2" });
    await vi.waitFor(() => expect(m.api.cancelar).toHaveBeenCalledTimes(1));
    expect(m.tracks.abertas).toBe(0);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => { tecla("keydown", ATALHO); await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(m.r.result.current.estado).toBe("gravando"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await vi.waitFor(() => expect(m.api.cancelar).toHaveBeenCalledTimes(2));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(m.tracks.abertas).toBe(0);
  });

  it("desmontar fecha o microfone", async () => {
    const m = montar();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { tecla("keydown", ATALHO); await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(m.r.result.current.estado).toBe("gravando"));
    m.r.unmount();
    await vi.waitFor(() => expect(m.tracks.abertas).toBe(0));
  });
});

describe("ditado: pré-condições e erros", () => {
  it("sem motor: avisa, abre a configuração e NÃO grava nem abre microfone", async () => {
    const m = montar({ motor: "nenhum", motor_pronto: false });
    await act(async () => { await m.r.result.current.comecar(); });
    expect(m.aoConfigurar).toHaveBeenCalled();
    expect(m.aoAvisar).toHaveBeenCalledWith("Sem motor de voz. Configurar.");
    expect(m.api.iniciar).not.toHaveBeenCalled();
    expect(m.abrir).not.toHaveBeenCalled();
  });

  it("motor remoto sem consentimento leva à configuração", async () => {
    const m = montar({ motor: "http_compativel", motor_pronto: true, consentimento: false });
    await act(async () => { await m.r.result.current.comecar(); });
    expect(m.aoConfigurar).toHaveBeenCalled();
    expect(m.abrir).not.toHaveBeenCalled();
  });

  it("primeiro uso: mostra o aviso ANTES de qualquer pedido ao SO; 'Continuar' grava o aceite, pede o microfone e começa", async () => {
    const m = montar({ aviso_microfone_visto: false, microfone: "indeterminada" });
    await act(async () => { await m.r.result.current.comecar(); });
    expect(m.r.result.current.primeiroUso).toBe(true);
    expect(m.api.pedirMicrofone).not.toHaveBeenCalled();
    expect(m.abrir).not.toHaveBeenCalled();
    await act(async () => { await m.r.result.current.confirmarPrimeiroUso(); });
    expect(m.api.configGravar).toHaveBeenCalledWith({ aviso_microfone_visto: true });
    expect(m.api.pedirMicrofone).toHaveBeenCalledTimes(1);
    expect(m.api.iniciar).toHaveBeenCalledTimes(1);
    expect(m.r.result.current.primeiroUso).toBe(false);
  });

  it("'Agora não' fecha o aviso sem pedir nada", async () => {
    const m = montar({ aviso_microfone_visto: false, microfone: "indeterminada" });
    await act(async () => { await m.r.result.current.comecar(); });
    act(() => m.r.result.current.recusarPrimeiroUso());
    expect(m.r.result.current.primeiroUso).toBe(false);
    expect(m.api.pedirMicrofone).not.toHaveBeenCalled();
  });

  it("microfone negado: estado claro e configuração, sem laço de pedidos", async () => {
    const m = montar({ microfone: "negada" });
    await act(async () => { await m.r.result.current.comecar(); });
    expect(m.aoAvisar).toHaveBeenCalledWith(expect.stringContaining("Microfone bloqueado"));
    expect(m.api.pedirMicrofone).not.toHaveBeenCalled();
    expect(m.abrir).not.toHaveBeenCalled();
  });

  it("sem terminal em foco: aviso e nada começa", async () => {
    const m = montar({}, null);
    await act(async () => { await m.r.result.current.comecar(); });
    expect(m.aoAvisar).toHaveBeenCalledWith(expect.stringContaining("terminal"));
    expect(m.api.iniciar).not.toHaveBeenCalled();
  });

  it("falha ao abrir o microfone cancela no main e volta a ocioso", async () => {
    const m = montar();
    m.abrir.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "ErroAudio", codigo: "microfone_indisponivel" }));
    await act(async () => { await m.r.result.current.comecar(); });
    expect(m.api.cancelar).toHaveBeenCalled();
    expect(m.r.result.current.estado).toBe("ocioso");
    expect(m.aoAvisar).toHaveBeenCalled();
  });

  it("soltar enquanto o microfone ainda abre encerra assim que abrir", async () => {
    const m = montar();
    let liberar!: () => void;
    m.abrir.mockImplementationOnce(() => new Promise<SessaoAudio>((res) => { liberar = () => { m.tracks.abertas += 1; res({ parar: async () => { m.tracks.abertas = 0; } }); }; }));
    let p!: Promise<void>;
    await act(async () => { p = m.r.result.current.comecar(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await m.r.result.current.terminar(); });
    await act(async () => { liberar(); await p; });
    expect(m.api.parar).toHaveBeenCalledTimes(1);
    expect(m.tracks.abertas).toBe(0);
  });

  it("eventos do main: erro mostra toast; texto não injetado avisa; atalho global alterna", async () => {
    const m = montar();
    await m.emitir({ tipo: "erro", codigo: "fala_curta", estagio: "transcrevendo" });
    expect(m.aoAvisar).toHaveBeenCalledWith("Fala curta demais.");
    await m.emitir({ tipo: "erro", codigo: "motor_ausente", estagio: "transcrevendo" });
    expect(m.aoConfigurar).toHaveBeenCalled();
    await m.emitir({ tipo: "texto", fala_id: "f", injetada: false, palavras: 2, codigo: "sem_terminal_em_foco" });
    expect(m.aoAvisar).toHaveBeenCalledWith(expect.stringContaining("terminal"));
    await m.emitir({ tipo: "estado", sequencia: 1, ditado: "erro" });
    expect(m.r.result.current.estado).toBe("erro");
    await m.emitir({ tipo: "estado", sequencia: 2, ditado: "ocioso" });
    expect(m.r.result.current.estado).toBe("ocioso");
  });
});
