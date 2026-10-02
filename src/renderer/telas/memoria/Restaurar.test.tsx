// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiMemoria, ResultadoRestaurar } from "../../../compartilhado/memoria";
import { memoriaFalso } from "../../a11y/ade-falso-memoria";
import { instalar, remover } from "../../a11y/ade-falso";
import { storeAvisos } from "../../estado/avisos";
import { criarStoreMemoria } from "../../estado/memoria";
import { criarEventosMemoria } from "../../estado/memoria-eventos";
import { storeMissoes } from "../../estado/missoes";
import { storeWorkspaces } from "../../estado/workspaces";
import { ControlesRestaurar, DialogoPreviaBrief, IndicadorBrief } from "./ControlesRestaurar";
import { RestaurarPainel } from "./RestaurarPainel";

beforeEach(() => { instalar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

const OK: ResultadoRestaurar = { pane_id: "p9", sessao_id: "s9", modo: "brief", brief_injetado: true, truncado: false, ja_existia: false };
const loja = (sobre: Partial<ApiMemoria> = {}) => criarStoreMemoria({ api: () => memoriaFalso(sobre), avisar: () => undefined, quadro: (f) => f() });

describe("Restaurar no Pane (AC-08.08 na UI)", () => {
  it("duplo clique = UMA chamada ao main; o botão fica desabilitado enquanto roda", async () => {
    let soltar: (r: ResultadoRestaurar) => void = () => undefined;
    const restaurar = vi.fn(() => new Promise<ResultadoRestaurar>((r) => { soltar = r; }));
    render(<ControlesRestaurar paneId="p1" rotulo="#1 · Claude" store={loja({ restaurar })} />);
    const botao = screen.getByRole("button", { name: "Restaurar #1 · Claude com a memória" }) as HTMLButtonElement;
    fireEvent.click(botao);
    fireEvent.click(botao);
    fireEvent.doubleClick(botao);
    expect(restaurar).toHaveBeenCalledTimes(1);
    expect(restaurar).toHaveBeenCalledWith("p1", "auto");
    await act(async () => { await Promise.resolve(); });
    expect(botao.disabled).toBe(true);
    expect(botao.textContent).toBe("Restaurando…");
    await act(async () => { soltar(OK); });
    expect(botao.disabled).toBe(false);
  });

  it("o modo escolhido vai ao canal (com brief / retomar) e o resultado vira aviso honesto", async () => {
    const restaurar = vi.fn(async () => ({ ...OK, ja_existia: true }));
    const store = criarStoreMemoria({ api: () => memoriaFalso({ restaurar }), avisar: () => undefined, quadro: (f) => f() });
    const aoRestaurado = vi.fn();
    render(<ControlesRestaurar paneId="p1" rotulo="#1" store={store} aoRestaurado={aoRestaurado} />);
    fireEvent.change(screen.getByLabelText("Modo de restauração de #1"), { target: { value: "retomar" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Restaurar #1/ })); });
    expect(restaurar).toHaveBeenCalledWith("p1", "retomar");
    expect(aoRestaurado).toHaveBeenCalledWith("p9");
    expect(storeAvisos.obter().some((a) => /nada foi duplicado/.test(a.texto))).toBe(true);
  });

  it("Prévia do brief mostra o markdown COMO TEXTO, o modo e o tamanho", async () => {
    const briefPrevia = vi.fn(async () => ({ markdown: "<memoria_restaurada>\n# Contexto\n<img src=x onerror=alert(1)>\n</memoria_restaurada>", caracteres: 77, truncado: true, modo: "missao" as const }));
    await act(async () => { render(<DialogoPreviaBrief paneId="p1" store={loja({ briefPrevia })} aoFechar={() => undefined} />); });
    const d = screen.getByRole("dialog", { name: "Prévia do brief" });
    const pre = within(d).getByLabelText("Texto do brief");
    expect(pre.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(d.querySelector("img")).toBeNull();
    expect(within(d).getByText(/77 caracteres/)).toBeTruthy();
    expect(within(d).getByText(/resumido/)).toBeTruthy();
    expect(briefPrevia).toHaveBeenCalledWith("p1");
  });

  it("prévia vazia explica; erro do canal mostra alerta", async () => {
    await act(async () => { render(<DialogoPreviaBrief paneId="p1" store={loja({ briefPrevia: async () => ({ markdown: "", caracteres: 0, truncado: false, modo: "off" }) })} aoFechar={() => undefined} />); });
    expect(screen.getByText(/Sem brief/)).toBeTruthy();
    cleanup();
    await act(async () => { render(<DialogoPreviaBrief paneId="p1" store={criarStoreMemoria({ api: () => memoriaFalso({ briefPrevia: async () => { throw new Error("x"); } }), avisar: () => undefined })} aoFechar={() => undefined} />); });
    expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível montar a prévia/);
  });
});

describe("indicador 'brief carregado'", () => {
  it("só aparece depois do evento, mostra tamanho e truncamento no title e abre a prévia", async () => {
    // o indicador lê o módulo de eventos global: injeta o evento pelo `ligar` da instância de teste
    const { eventosMemoria } = await import("../../estado/memoria-eventos");
    let emitir: (e: never) => void = () => undefined;
    const ev = criarEventosMemoria({ api: () => memoriaFalso({ assinar: (cb) => { emitir = cb as never; return () => undefined; } }), avisar: () => undefined });
    expect(ev.obter()).toEqual({});
    const { container } = render(<IndicadorBrief paneId="p-sem-brief" store={loja()} />);
    expect(container.textContent).toBe("");
    // injeta direto no store global (é ele que o componente lê)
    const g = eventosMemoria;
    const api = memoriaFalso({ assinar: (cb) => { emitir = cb as never; return () => undefined; } });
    (globalThis as unknown as { ade: { memoria: ApiMemoria } }).ade.memoria = api;
    const desligar = g.ligar();
    await act(async () => { emitir({ canal: "memoria:brief_montado", payload: { pane_id: "p-com", caracteres: 5400, truncado: true } } as never); });
    cleanup();
    render(<IndicadorBrief paneId="novo" respawnDe="p-com" store={loja()} />);
    const ind = screen.getByRole("button", { name: /Brief de memória carregado: 5400 caracteres \(resumido\)/ });
    expect(ind.hasAttribute("data-truncado")).toBe(true);
    await act(async () => { fireEvent.click(ind); });
    expect(await screen.findByRole("dialog", { name: "Prévia do brief" })).toBeTruthy();
    desligar();
  });
});

describe("Memória: restaurar painel (paleta)", () => {
  it("lista Panes encerrados das Missões recentes e restaura pelo mesmo controle", async () => {
    await storeWorkspaces.iniciar();
    await storeMissoes.definirWorkspace("w1");
    const base = (globalThis as unknown as { ade: { missoes: { detalhe: (id: string) => Promise<unknown> } } }).ade.missoes;
    const original = base.detalhe;
    base.detalhe = async (id: string) => {
      const d = (await original(id)) as { panes: Array<Record<string, unknown>> };
      return { ...d, panes: [...d.panes, { ...d.panes[0], id: "p-fim", display_id: 8, estado: "encerrado", eh_piloto: false, papel: "executor", tipo: "cli" }] };
    };
    const restaurar = vi.fn(async () => OK);
    (globalThis as unknown as { ade: { memoria: ApiMemoria } }).ade.memoria = memoriaFalso({ restaurar });
    await act(async () => { render(<RestaurarPainel aoFechar={() => undefined} />); });
    const lista = await screen.findByRole("list", { name: "Painéis encerrados" });
    expect(within(lista).getAllByRole("listitem").length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(within(lista).getAllByRole("button", { name: /^Restaurar #8/ })[0]!); });
    expect(restaurar).toHaveBeenCalledWith("p-fim", "auto");
  });

  it("sem painel encerrado explica o que acontece", async () => {
    await act(async () => { render(<RestaurarPainel aoFechar={() => undefined} />); });
    expect(await screen.findByText(/Nenhum painel encerrado/)).toBeTruthy();
  });
});
