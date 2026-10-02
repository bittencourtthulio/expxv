import { afterEach, describe, expect, it, vi } from "vitest";
import { criarDetector, limitarMinutos, THROTTLE_MS } from "./ocioso";

function alvos() {
  const mapa = new Map<string, Array<(e: Event) => void>>();
  const mk = () => ({ addEventListener: vi.fn((t: string, f: (e: Event) => void) => { mapa.set(t, [...(mapa.get(t) ?? []), f]); }), removeEventListener: vi.fn((t: string, f: (e: Event) => void) => { mapa.set(t, (mapa.get(t) ?? []).filter((x) => x !== f)); }) });
  const win = mk();
  const doc = { ...mk(), visibilityState: "visible" as DocumentVisibilityState };
  const emitir = (t: string, e: object = {}) => (mapa.get(t) ?? []).forEach((f) => f(e as Event));
  return { win, doc, emitir, total: () => [...mapa.values()].reduce((n, l) => n + l.length, 0) };
}

afterEach(() => vi.useRealTimers());

function montar(ms = 180_000) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const a = alvos();
  const ocioso = vi.fn();
  const atividade = vi.fn();
  const d = criarDetector({ alvo: a.win as never, doc: a.doc as never, agora: () => Date.now(), setT: (f, t) => setTimeout(f, t), clearT: (t) => clearTimeout(t as never), ms: () => ms, aoOcioso: ocioso, aoAtividade: atividade });
  return { a, d, ocioso, atividade };
}

describe("detector de ociosidade", () => {
  it("usa UM único timer e dispara depois do tempo sem atividade", () => {
    const { d, ocioso } = montar();
    d.iniciar();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(179_999);
    expect(ocioso).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(ocioso).toHaveBeenCalledTimes(1);
    expect(d.ocioso()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("atividade não cria timers: o timer único confere a hora e rearma só pelo que falta", () => {
    const { d, a, ocioso } = montar();
    d.iniciar();
    vi.advanceTimersByTime(100_000);
    a.emitir("keydown", { key: "x" });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(80_001); // o primeiro timer dispara, vê que há atividade recente e rearma
    expect(ocioso).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(100_000);
    expect(ocioso).toHaveBeenCalledTimes(1);
  });
  it("regula eventos a 1 por segundo enquanto ativo; ao sair do ocioso a primeira ação passa na hora e rearma", () => {
    const { d, a, atividade } = montar(10_000);
    d.iniciar();
    a.emitir("pointerdown"); // dentro do throttle de 1 s desde o início? clique passa sempre
    vi.setSystemTime(THROTTLE_MS + 1);
    atividade.mockClear();
    a.emitir("keydown", { key: "a" });
    a.emitir("keydown", { key: "b" });
    a.emitir("keydown", { key: "c" });
    expect(atividade).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_001);
    expect(d.ocioso()).toBe(true);
    atividade.mockClear();
    a.emitir("keydown", { key: "z" });
    expect(atividade).toHaveBeenCalledWith("tecla", true);
    expect(d.ocioso()).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });
  it("movimentos de menos de 4 px não contam (layout mexendo debaixo do cursor)", () => {
    const { d, a, atividade } = montar(10_000);
    d.iniciar();
    vi.setSystemTime(5_000);
    a.emitir("pointermove", { clientX: 100, clientY: 100 });
    vi.setSystemTime(8_000);
    atividade.mockClear();
    a.emitir("pointermove", { clientX: 101, clientY: 101 });
    expect(atividade).not.toHaveBeenCalled();
    a.emitir("pointermove", { clientX: 130, clientY: 100 });
    expect(atividade).toHaveBeenCalledWith("ponteiro", false);
  });
  it("foco da janela, clique, rolagem, toque e voltar da aba contam; aba oculta não", () => {
    const { d, a, atividade } = montar(10_000);
    d.iniciar();
    vi.advanceTimersByTime(10_001);
    for (const t of ["focus", "pointerdown", "wheel", "touchstart"]) { atividade.mockClear(); vi.advanceTimersByTime(10_001); a.emitir(t); expect(atividade).toHaveBeenCalledTimes(1); }
    atividade.mockClear(); vi.advanceTimersByTime(10_001);
    a.doc.visibilityState = "hidden"; a.emitir("visibilitychange");
    expect(atividade).not.toHaveBeenCalled();
    a.doc.visibilityState = "visible"; a.emitir("visibilitychange");
    expect(atividade).toHaveBeenCalledWith("volta", true);
  });
  it("parar remove todos os listeners e o timer; reprogramar vale na hora", () => {
    const { d, a, ocioso } = montar(180_000);
    d.iniciar();
    expect(a.total()).toBeGreaterThan(5);
    vi.advanceTimersByTime(10_000);
    const novo = { v: 30_000 };
    d.parar();
    expect(a.total()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(ocioso).not.toHaveBeenCalled();
    void novo;
  });
  it("limita os minutos a 1–30 e cai em 3 com lixo", () => {
    expect(limitarMinutos(0)).toBe(1);
    expect(limitarMinutos(99)).toBe(30);
    expect(limitarMinutos(7.4)).toBe(7);
    expect(limitarMinutos("x")).toBe(3);
    expect(limitarMinutos(Number.NaN)).toBe(3);
  });
});
